/**
 * Gliding on a substrate — the sandbox's version of the glideosome.
 *
 * Research §5 / §12.4: *T. gondii* glides only on a surface. There is no
 * swimming: a tachyzoite in suspension runs its motor and goes nowhere. So the
 * parasite here first *sediments* onto the dish (passive, no traction), and the
 * motor only moves it once it is in contact.
 *
 * On contact the motion reuses the glideosome's model rather than a free
 * `pos += v·dt`:
 *
 *  - speed follows the same stop-start power stroke ({@link strokeProfile}),
 *    peaking at {@link PEAK_SPEED} ≈ 3 µm/s (research §5) with full adhesion;
 *  - the path is the same helix as `glideosome.ts` ({@link HELIX_TWIST},
 *    {@link HELIX_PITCH}) seen against a flat substrate: the heading swings
 *    ±HELIX_PITCH about the helix axis once per twist, which traces the
 *    sinuous, corkscrew trail of helical gliding on a 2D surface (§5
 *    "circular twists + forward roll"); the body rolls with the twist;
 *  - the helix axis steers toward the host cell, so a seeded run always
 *    arrives (a sandbox choice, not chemotaxis biology).
 *
 * **RNG2 loss** (research §4, conoid table): the conoid detaches from the
 * apical polar ring and the parasite is immotile. The motor never turns over,
 * so the cycle phase freezes and nothing moves except passive sedimentation.
 */

import { HELIX_PITCH, HELIX_TWIST, PEAK_SPEED, TRACTION_FREQUENCY, strokeProfile } from '../glideosome'
import { clamp01, nextFloat, TAU, vec3, type Rng, type Vec3 } from '../math'
import { STAGE_DEFS } from '../stages'

/** Tachyzoite body, µm (research §2.1 / §12.2: rigid crescent 6 × 2 µm). */
export const BODY_LENGTH = STAGE_DEFS.tachyzoite.length
export const BODY_WIDTH = STAGE_DEFS.tachyzoite.width
export const HALF_LENGTH = BODY_LENGTH / 2
/** Height of the body's centre line when lying on the substrate. */
export const REST_HEIGHT = BODY_WIDTH / 2

/** Conoid, µm (research §4: ~400 nm base, ~250 nm long). */
export const CONOID_DIAMETER = 0.4
export const CONOID_LENGTH = 0.25

/**
 * Sinking speed through the medium before contact, µm/s. A sandbox value
 * chosen so the drop is visible but short; the research doc has no figure.
 */
export const SEDIMENT_SPEED = 1.2

/** Adhesin engagement reached on a gripworthy surface (host-coated dish). */
export const SUBSTRATE_GRIP = 0.92

/** How quickly the helix axis turns toward the target, per µm of path. */
const STEER_PER_UM = 0.16

export interface SubstrateZoite {
  /** Body centre, µm. y is height above the substrate. */
  pos: Vec3
  /** Apex direction (always in the substrate plane once landed). */
  heading: Vec3
  /** Gap between the body and the substrate, µm (0 = in contact). */
  gap: number
  contact: boolean
  /** Helix axis angle in the substrate (x–z) plane, radians. */
  axis: number
  /** Phase along the helix, radians; the body rolls with it. */
  twist: number
  helixSign: 1 | -1
  /** Traction cycle position, 0–1. */
  cyclePhase: number
  /** Engaged adhesin fraction, 0–1. */
  adhesion: number
  /** Instantaneous speed, µm/s. */
  speed: number
  /** Path length travelled on the substrate, µm. */
  distance: number
  /** Conoid still tethered to the apical polar ring (false = RNG2 loss). */
  conoid: boolean
}

export const dirFromAngle = (a: number): Vec3 => vec3(Math.cos(a), 0, Math.sin(a))

/** Wrap an angle to (−π, π]. */
export function wrapAngle(a: number): number {
  const w = ((((a + Math.PI) % TAU) + TAU) % TAU) - Math.PI
  return w === -Math.PI ? Math.PI : w
}

export function createSubstrateZoite(pos: Vec3, axis: number, gap: number, rng: Rng, conoid = true): SubstrateZoite {
  return {
    pos: vec3(pos.x, REST_HEIGHT + gap, pos.z),
    heading: dirFromAngle(axis),
    gap,
    contact: gap <= 0,
    axis,
    twist: nextFloat(rng) * TAU,
    helixSign: nextFloat(rng) < 0.5 ? -1 : 1,
    cyclePhase: nextFloat(rng),
    adhesion: 0,
    speed: 0,
    distance: 0,
    conoid,
  }
}

export interface SubstrateGlideInputs {
  /** Action seconds. */
  dt: number
  /** Where the helix axis steers toward (x–z), µm. */
  target: Vec3
  /** RNG2 present? `false` = immotile (research §4). */
  motile: boolean
}

/** One step. Pure: returns a new zoite and leaves `z` untouched. */
export function stepSubstrateGlide(z: SubstrateZoite, input: SubstrateGlideInputs): SubstrateZoite {
  const dt = Math.max(0, input.dt)
  if (dt === 0) return z

  // Before contact: sinking, no grip, no displacement from the motor.
  if (!z.contact) {
    const gap = Math.max(0, z.gap - SEDIMENT_SPEED * dt)
    const cyclePhase = input.motile ? (z.cyclePhase + TRACTION_FREQUENCY * 0.45 * dt) % 1 : z.cyclePhase
    return { ...z, gap, contact: gap <= 0, pos: { ...z.pos, y: REST_HEIGHT + gap }, cyclePhase, speed: 0 }
  }

  // MIC2 engages the surface whether or not the motor can use it.
  const adhesion = z.adhesion + (SUBSTRATE_GRIP - z.adhesion) * clamp01(dt * 4)
  if (!input.motile) return { ...z, adhesion, speed: 0 }

  const frequency = TRACTION_FREQUENCY * (0.45 + 0.55 * adhesion)
  let cyclePhase = z.cyclePhase + frequency * dt
  cyclePhase -= Math.floor(cyclePhase)

  // same velocity profile as the 3D glideosome: displacement only while gripping
  const speed = PEAK_SPEED * strokeProfile(z.cyclePhase) * adhesion
  const ds = speed * dt

  const pos = vec3(z.pos.x + z.heading.x * ds, REST_HEIGHT, z.pos.z + z.heading.z * ds)
  const toTarget = Math.atan2(input.target.z - pos.z, input.target.x - pos.x)
  const axis = z.axis + wrapAngle(toTarget - z.axis) * clamp01(STEER_PER_UM * ds)
  const twist = z.twist + HELIX_TWIST * ds * z.helixSign
  const heading = dirFromAngle(axis + HELIX_PITCH * Math.sin(twist))

  return { ...z, pos, heading, axis, twist, cyclePhase, adhesion, speed, distance: z.distance + ds }
}
