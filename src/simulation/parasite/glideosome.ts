/**
 * Gliding motility — the glideosome.
 *
 * Research §5 and §12.4. *T. gondii* has no cilium, flagellum or pseudopod. It
 * moves by **periodic inward traction**: MyoA walks rearward along apically
 * nucleated F-actin, GAC couples that filament to the tails of surface adhesins
 * (MIC2), and the parasite pulls itself through an annular constriction that
 * stays fixed in the lab frame while travelling apex→posterior along the body.
 * The result is a corkscrew path, not a forward thrust.
 *
 * So the model is explicitly *not* `pos += heading * speed * dt`:
 *
 *  - a traction cycle runs a ring from apex (s=0) to posterior (s=1);
 *  - displacement only accumulates during the power stroke, while the ring is
 *    gripping, and the instantaneous speed peaks at ~3 µm/s;
 *  - between strokes the ring releases and resets, giving the measured
 *    stop-start velocity profile rather than constant motion;
 *  - heading curves and the body rolls, so the trajectory is helical;
 *  - without adhesin engagement the ring slips: traction produces no net
 *    displacement and the parasite twitches in place (the ΔMIC2 phenotype).
 */

import {
  clamp01,
  crossV,
  normalizeV,
  nextDirection,
  nextFloat,
  perpendicularTo,
  rotateAround,
  scaleV,
  addV,
  vec3,
  type Rng,
  type Vec3,
} from './math'

/** Peak instantaneous speed during a power stroke, µm/s (research §5). */
export const PEAK_SPEED = 3

/** Traction cycles per second at full drive. */
export const TRACTION_FREQUENCY = 1.8

/** Power stroke occupies this fraction of the cycle; the rest is re-attachment. */
const STROKE_START = 0.08
const STROKE_END = 0.86

/**
 * Helical geometry. The heading precesses about a fixed axis at a constant rate
 * per unit *path length*, which is what gives a true helix — constant curvature
 * and constant torsion — rather than a wobble that averages back to a straight
 * line. Pitch angle and precession rate together set the helix radius
 * (sin θ / ω ≈ 0.7 µm here, matching the sub-micron amplitude of real helical
 * gliding).
 */
export const HELIX_TWIST = 0.6 // rad per µm of path
export const HELIX_PITCH = 0.42 // rad between heading and helix axis
const BODY_ROLL = 0.9 // rad per µm, the parasite's own spin about its long axis

/** Adhesion below this and the ring slips instead of gripping. */
export const SLIP_THRESHOLD = 0.25

export interface GlideState {
  pos: Vec3
  /** Unit vector along the body's long axis, apex forward. */
  heading: Vec3
  /** Unit vector perpendicular to `heading`; carries the roll of the body. */
  up: Vec3
  /** Axis the corkscrew winds around; the net direction of travel. */
  helixAxis: Vec3
  /** Position within the traction cycle, 0–1. */
  cyclePhase: number
  /** Annular constriction position along the body, 0 = apex, 1 = posterior. */
  ringS: number
  /** Engaged adhesin fraction, 0–1. */
  adhesion: number
  /** Instantaneous speed, µm/s. */
  speed: number
  /** Path length travelled, µm. */
  distance: number
  /** Traction is producing no net displacement. */
  slipping: boolean
  /** Handedness of the helix for this individual. */
  helixSign: 1 | -1
  /** Completed traction cycles. */
  cycles: number
}

export function createGlideState(pos: Vec3, rng: Rng): GlideState {
  const helixAxis = nextDirection(rng)
  // tilt the body off the axis by the pitch angle so the path winds around it
  const heading = normalizeV(rotateAround(helixAxis, perpendicularTo(helixAxis), HELIX_PITCH))
  return {
    pos,
    heading,
    up: perpendicularTo(heading),
    helixAxis,
    cyclePhase: nextFloat(rng),
    ringS: 0,
    adhesion: 0.8,
    speed: 0,
    distance: 0,
    slipping: false,
    helixSign: nextFloat(rng) < 0.5 ? -1 : 1,
    cycles: 0,
  }
}

export interface GlideInputs {
  /** Action seconds for this step. */
  dtSeconds: number
  /**
   * How gripworthy the local substrate is, 0–1. Extracellular matrix and cell
   * surfaces are high; free fluid is low (and gliding is substrate-dependent,
   * so a parasite in suspension goes nowhere).
   */
  substrate: number
  /**
   * MIC2 / adhesin function. `false` is the ΔMIC2 phenotype: the motor still
   * runs but the force never reaches the substrate (research §5).
   */
  adhesin: boolean
  /** Motor output scale, 0–1 — energy, temperature, drug effects. */
  motor?: number
  rng: Rng
  /** Optional unit vector the parasite biases toward (chemotaxis-like). */
  bias?: Vec3
  /** 0–1 strength of that bias. */
  biasStrength?: number
}

/**
 * Fraction of the cycle spent gripping, and the force profile within it, 0–1.
 * Exported so other kinematics (the lytic sandbox's substrate glide) share the
 * same stop-start velocity profile instead of re-deriving it.
 */
export function strokeProfile(phase: number): number {
  if (phase < STROKE_START || phase > STROKE_END) return 0
  const t = (phase - STROKE_START) / (STROKE_END - STROKE_START)
  // smooth rise and fall: traction builds as the ring engages and fades as it
  // reaches the basal complex
  return Math.sin(Math.PI * t) ** 1.4
}

/**
 * One step of gliding. Pure with respect to `state` (returns a new object); the
 * RNG is advanced in place, which is what makes a seeded run reproducible.
 */
export function stepGlide(state: GlideState, input: GlideInputs): GlideState {
  const dt = Math.max(0, input.dtSeconds)
  if (dt === 0) return state

  const substrate = clamp01(input.substrate)
  const motor = clamp01(input.motor ?? 1)

  // Adhesin engagement tracks the substrate; MyoC/GAP80 at the basal ring gives
  // a little residual traction, but nothing like a functioning MIC2 coat.
  const adhesionTarget = input.adhesin ? substrate : substrate * 0.12
  const adhesion = state.adhesion + (adhesionTarget - state.adhesion) * clamp01(dt * 4)
  const slipping = adhesion < SLIP_THRESHOLD

  // advance the traction cycle; the ring rides the cycle apex→posterior
  const frequency = TRACTION_FREQUENCY * motor * (0.45 + 0.55 * adhesion)
  let cyclePhase = state.cyclePhase + frequency * dt
  const completed = Math.floor(cyclePhase)
  cyclePhase -= completed

  const grip = strokeProfile(state.cyclePhase)
  // Peak speed is only reached with a fully engaged coat on good substrate.
  const speed = slipping
    ? PEAK_SPEED * grip * motor * 0.06
    : PEAK_SPEED * grip * motor * adhesion

  const ds = speed * dt

  // Helical path: precess the heading about the helix axis and roll the body
  // about its own long axis, both per unit path length so the helix geometry is
  // a property of the parasite rather than of the frame rate.
  let heading = state.heading
  let up = state.up
  let helixAxis = state.helixAxis
  if (ds > 0) {
    heading = normalizeV(rotateAround(heading, helixAxis, HELIX_TWIST * ds * state.helixSign))
    up = normalizeV(rotateAround(up, heading, BODY_ROLL * ds * state.helixSign))
    // keep the frame orthogonal against accumulated float drift
    up = normalizeV(crossV(heading, crossV(up, heading)))
  }

  // Steering turns the whole corkscrew, so the parasite still arrives somewhere
  // instead of circling its axis forever.
  if (input.bias && (input.biasStrength ?? 0) > 0) {
    const b = normalizeV(input.bias)
    const w = clamp01(input.biasStrength ?? 0) * clamp01(dt * 2)
    helixAxis = normalizeV(addV(scaleV(helixAxis, 1 - w), scaleV(b, w)))
    heading = normalizeV(addV(scaleV(heading, 1 - w * 0.5), scaleV(b, w * 0.5)))
    up = normalizeV(crossV(heading, crossV(up, heading)))
  }

  // A slipping parasite flails: without traction the heading wanders and the
  // path degenerates into inefficient random motion.
  if (slipping) {
    const jitter = nextDirection(input.rng)
    const w = clamp01(dt * 0.9)
    heading = normalizeV(addV(scaleV(heading, 1 - w), scaleV(jitter, w)))
    helixAxis = heading
    up = perpendicularTo(heading)
  }

  return {
    pos: addV(state.pos, scaleV(state.heading, ds)),
    heading,
    up,
    helixAxis,
    cyclePhase,
    ringS: cyclePhase,
    adhesion,
    speed,
    distance: state.distance + ds,
    slipping,
    helixSign: state.helixSign,
    cycles: state.cycles + completed,
  }
}

/**
 * Inward traction magnitude at the constriction right now, 0–1 — what the view
 * draws as the annular "pinch" travelling down the body.
 */
export function tractionForce(state: GlideState): number {
  return strokeProfile(state.cyclePhase) * state.adhesion
}

/** Mean speed over a full cycle at the given adhesion, µm/s. */
export function meanSpeed(adhesion: number, motor = 1): number {
  // ∫ sin(πt)^1.4 dt over the stroke window, times the stroke duty cycle
  const dutyIntegral = 0.6 * (STROKE_END - STROKE_START)
  return PEAK_SPEED * dutyIntegral * clamp01(adhesion) * clamp01(motor)
}

/** Body-frame position of the constriction ring, µm from the apex. */
export function ringOffset(state: GlideState, bodyLength: number): number {
  return state.ringS * bodyLength
}

/** A fresh glide state winding around `axis` (tests, respawns). */
export function glideAt(pos: Vec3, axis: Vec3 = vec3(0, 0, 1)): GlideState {
  const a = normalizeV(axis)
  const h = normalizeV(rotateAround(a, perpendicularTo(a), HELIX_PITCH))
  return {
    pos,
    heading: h,
    up: perpendicularTo(h),
    helixAxis: a,
    cyclePhase: 0,
    ringS: 0,
    adhesion: 0.8,
    speed: 0,
    distance: 0,
    slipping: false,
    helixSign: 1,
    cycles: 0,
  }
}
