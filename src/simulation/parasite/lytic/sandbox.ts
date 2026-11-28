/**
 * The lytic-cycle sandbox: one tachyzoite, one host cell, one complete loop.
 *
 *   glide → attach → invade → PV → endodyogeny → egress → lysis
 *
 * This is the v0 acceptance loop of `weekly_plan.md` played at single-cell
 * scale, with no player input. It composes the existing pure pieces rather than
 * re-implementing them:
 *
 *  - gliding: `substrateGlide.ts` (glideosome stroke profile + helix, on a dish)
 *  - attach / invade: `invasion.ts` (`stepInvasion`, the moving-junction FSM;
 *    contact + microneme = attach, reorient → penetrating = invade)
 *  - replication: endodyogeny every {@link ENDODYOGENY_HOURS} lesion hours,
 *    laid out as a rosette by `rosette.ts`
 *  - egress: `egress.ts` (`stepEgress`, FNT acidification → Ca²⁺ → TgPLP1
 *    pores), triggered by crowding through `shouldTriggerEgress`
 *
 * Two gears, as everywhere in parasite mode (docs/design/parasite-mode.md §3):
 * motion, the junction and egress run on action seconds; endodyogeny runs on
 * lesion hours, which is the sandbox's time compression (7 h ≈ 7.8 s at 1×).
 *
 * Pure and deterministic: `stepLytic` returns a new state, never mutates its
 * input, and draws only from a fork of `state.rng`. A run is a function of
 * (seed, flags, step count).
 *
 * Challenge flags:
 *  - **ΔPLP1** — acidification and the Ca²⁺ spike still happen, but no pores:
 *    the vacuole is trapped and the host is never lysed (research §10).
 *  - **RNG2 loss** — conoid detaches, the parasite is immotile (research §4):
 *    it lands on the dish and never reaches the host.
 */

import { createEgressState, shouldTriggerEgress, stepEgress, type EgressState } from '../egress'
import { beginInvasion, stepInvasion, type MjPhase, type MjState } from '../invasion'
import { addV, clamp01, createRng, lerp, nextFloat, normalizeV, scaleV, TAU, vec3, type Rng, type Vec3 } from '../math'
import { ENDODYOGENY_HOURS, type Clocks } from '../stages'
import { PEAK_SPEED, strokeProfile } from '../glideosome'
import { pvRadius, rosettePose } from './rosette'
import {
  createSubstrateZoite,
  dirFromAngle,
  HALF_LENGTH,
  REST_HEIGHT,
  stepSubstrateGlide,
  SUBSTRATE_GRIP,
  type SubstrateZoite,
} from './substrateGlide'

// ---------------------------------------------------------------------------
// Scene constants (µm). Host geometry is a sandbox choice: a spread, cultured
// fibroblast-like cell, a low dome on the dish.
// ---------------------------------------------------------------------------

export const HOST_RADIUS = 24
export const HOST_HEIGHT = 8
/** Where the parasite starts, from the host's centre. */
export const START_RADIUS = 40
/** It starts this far above the dish and sediments down. */
const START_GAP = 3
/** Horizontal distance from the host centre at which the vacuole settles. */
export const PV_REST_RADIUS = 10

/** Endodyogeny rounds before the crowded vacuole egresses: 2⁵ = 32 parasites. */
export const SANDBOX_ROUNDS = 5
export const SANDBOX_CAPACITY = 2 ** SANDBOX_ROUNDS
/** ± spread on each round's period, so rounds are not metronomic. */
const PERIOD_JITTER = 0.08

/** PV formation (dense-granule remodelling, GRA2/6) before division, action s. */
export const VACUOLE_SECONDS = 4
/** Give up on reaching the host after this long, action s. */
export const STALL_SECONDS = 40
/** How long a finished run keeps animating before it settles, action s. */
export const TERMINAL_HOLD = 12
/** Spread of the daughters' escape directions about their radial lines, radians. */
const RELEASE_SCATTER = 0.9
/** Host membrane fade after rupture, action s. */
const LYSIS_SECONDS = 3

// ---------------------------------------------------------------------------

export type LyticPhase =
  | 'glide'
  | 'attach'
  | 'invade'
  | 'vacuole'
  | 'replicate'
  | 'egress'
  | 'lysed'
  /** never reached the host (RNG2 loss: immotile) */
  | 'stalled'
  /** ΔPLP1: egress cascade fired but no pores */
  | 'trapped'
  /** the moving junction failed */
  | 'aborted'

/** The successful loop, in order. */
export const LYTIC_ORDER: LyticPhase[] = ['glide', 'attach', 'invade', 'vacuole', 'replicate', 'egress', 'lysed']

export const LYTIC_TERMINAL: LyticPhase[] = ['lysed', 'stalled', 'trapped', 'aborted']

export const LYTIC_PHASE_DEFS: Record<LyticPhase, { name: string; note: string }> = {
  glide: { name: 'Glide', note: 'Sediments onto the dish, then glides by inward traction — only while in contact.' },
  attach: { name: 'Attach', note: 'Contact, then microneme MICs engage host surface glycans.' },
  invade: { name: 'Invade', note: 'Apex onto the membrane, RON2 injected, AMA1–RON2 ring closes and slides down the body.' },
  vacuole: { name: 'PV', note: 'Junction pinches shut behind the posterior; dense granules remodel the vacuole.' },
  replicate: { name: 'Endodyogeny', note: 'Two daughters bud inside each mother every ~7 h; the rosette doubles.' },
  egress: { name: 'Egress', note: 'FNT1/2 acidify the PV, Ca²⁺ spikes, TgPLP1 rings perforate the membranes.' },
  lysed: { name: 'Lysis', note: 'Host cell breached; the daughters glide away to find new cells.' },
  stalled: { name: 'Immotile', note: 'RNG2 loss: the conoid detached and the parasite cannot glide to the host.' },
  trapped: { name: 'Trapped', note: 'ΔPLP1: acidified and Ca²⁺-primed, but no perforin — the host is never lysed.' },
  aborted: { name: 'Aborted', note: 'The moving junction failed before the vacuole sealed.' },
}

export interface LyticFlags {
  /** ΔPLP1 — egress blocked (research §10). */
  deltaPlp1: boolean
  /** RNG2 loss — conoid detached, immotile (research §4). */
  rng2Loss: boolean
}

export const DEFAULT_LYTIC_FLAGS: LyticFlags = { deltaPlp1: false, rng2Loss: false }

export interface Vacuole {
  /** Centre, µm. */
  center: Vec3
  /** Where it formed (just inside the junction) and where it settles. */
  origin: Vec3
  rest: Vec3
  parasites: number
  /** Completed endodyogeny rounds. */
  round: number
  /** 0–1 through the current round. */
  division: number
  /** This round's period, lesion hours. */
  period: number
  /** Fan axis of the rosette (x–z angle), radians. */
  axis: number
  egress: EgressState
}

export interface ReleasedZoite {
  pos: Vec3
  /** Horizontal escape direction. */
  heading: Vec3
  cyclePhase: number
  speed: number
}

export interface LyticState {
  seed: number
  flags: LyticFlags
  rng: Rng
  phase: LyticPhase
  /** Phases entered, in order (starts with 'glide'). */
  history: LyticPhase[]
  /** Action seconds spent in the current phase. */
  phaseTime: number
  /** Totals on both gears. */
  actionSeconds: number
  lesionHours: number
  zoite: SubstrateZoite
  /** Moving junction, from contact until the vacuole seals. */
  mj: MjState | null
  /** Junction site on the host membrane and the inward normal there. */
  entry: Vec3 | null
  inward: Vec3 | null
  /** Heading when contact was made (reorientation swings away from it). */
  contactHeading: Vec3 | null
  pv: Vacuole | null
  released: ReleasedZoite[]
  /** Host membrane breakdown after rupture, 0–1. */
  lysis: number
}

/** Edge of the host dome at height `y`, µm from the host centre. */
export function hostEdgeRadius(y: number): number {
  return HOST_RADIUS * Math.sqrt(Math.max(0, 1 - (y / HOST_HEIGHT) ** 2))
}

export function createLytic(seed: number, flags: LyticFlags = DEFAULT_LYTIC_FLAGS): LyticState {
  const rng = createRng(seed)
  const angle = nextFloat(rng) * TAU
  const pos = vec3(Math.cos(angle) * START_RADIUS, 0, Math.sin(angle) * START_RADIUS)
  // pointed roughly at the host, up to ±50° off, so the glide has to steer
  const axis = angle + Math.PI + (nextFloat(rng) - 0.5) * 1.75
  return {
    seed,
    flags: { ...flags },
    rng,
    phase: 'glide',
    history: ['glide'],
    phaseTime: 0,
    actionSeconds: 0,
    lesionHours: 0,
    zoite: createSubstrateZoite(pos, axis, START_GAP, rng, !flags.rng2Loss),
    mj: null,
    entry: null,
    inward: null,
    contactHeading: null,
    pv: null,
    released: [],
    lysis: 0,
  }
}

export const lyticTerminal = (s: LyticState) => LYTIC_TERMINAL.includes(s.phase)

/** A finished run that has played out its closing animation. */
export const lyticSettled = (s: LyticState) => lyticTerminal(s) && s.phaseTime >= TERMINAL_HOLD

function enter(s: LyticState, phase: LyticPhase, patch: Partial<LyticState> = {}): LyticState {
  return { ...s, ...patch, phase, phaseTime: 0, history: [...s.history, phase] }
}

const ATTACH_MJ: MjPhase[] = ['contact', 'microneme']

const smooth = (t: number) => {
  const c = clamp01(t)
  return c * c * (3 - 2 * c)
}

const lerpV = (a: Vec3, b: Vec3, t: number): Vec3 => vec3(lerp(a.x, b.x, t), lerp(a.y, b.y, t), lerp(a.z, b.z, t))

/**
 * Where the body is during the junction. The apex stays pinned on the entry
 * point while it reorients, then the body slides through the *fixed* ring.
 */
function junctionPose(z: SubstrateZoite, mj: MjState, entry: Vec3, inward: Vec3, contactHeading: Vec3): SubstrateZoite {
  let heading = inward
  if (mj.phase === 'contact' || mj.phase === 'microneme') heading = contactHeading
  else if (mj.phase === 'reorient') heading = normalizeV(lerpV(contactHeading, inward, smooth(mj.progress)))
  const depth = mj.phase === 'penetrating' ? mj.progress : 0
  // apex at the ring before penetration; body centre crosses it as depth → 1
  const pos = addV(entry, scaleV(heading, (depth - 0.5) * 2 * HALF_LENGTH))
  return { ...z, pos, heading, speed: mj.phase === 'penetrating' ? 2 * HALF_LENGTH * 0.06 : 0 }
}

function newPeriod(rng: Rng): number {
  return ENDODYOGENY_HOURS * (1 + (nextFloat(rng) - 0.5) * 2 * PERIOD_JITTER)
}

/** Vacuole centre height: it sits on the cell's floor and grows upward. */
const pvHeight = (pv: Pick<Vacuole, 'parasites' | 'division'>) =>
  pvRadius(pv.parasites * 2 ** pv.division) + 0.3

/** Advance the sandbox by one pair of gear steps. */
export function stepLytic(state: LyticState, clocks: Clocks): LyticState {
  const dt = Math.max(0, clocks.action)
  const dh = Math.max(0, clocks.lesion)
  if (dt === 0 && dh === 0) return state

  // never draw from state.rng: nextFloat advances an Rng in place
  const rng: Rng = { ...state.rng }
  const s: LyticState = {
    ...state,
    rng,
    phaseTime: state.phaseTime + dt,
    actionSeconds: state.actionSeconds + dt,
    lesionHours: state.lesionHours + dh,
  }

  switch (s.phase) {
    case 'glide': {
      const zoite = stepSubstrateGlide(s.zoite, { dt, target: vec3(), motile: !s.flags.rng2Loss })
      const apex = addV(zoite.pos, scaleV(zoite.heading, HALF_LENGTH))
      const r = Math.hypot(apex.x, apex.z)
      if (zoite.contact && r <= hostEdgeRadius(REST_HEIGHT)) {
        const outward = normalizeV(vec3(apex.x, 0, apex.z))
        const entry = vec3(outward.x * hostEdgeRadius(REST_HEIGHT), REST_HEIGHT, outward.z * hostEdgeRadius(REST_HEIGHT))
        return enter(s, 'attach', {
          zoite: { ...zoite, speed: 0 },
          mj: beginInvasion(0),
          entry,
          inward: scaleV(outward, -1),
          contactHeading: zoite.heading,
        })
      }
      if (s.phaseTime > STALL_SECONDS) return enter(s, 'stalled', { zoite })
      return { ...s, zoite }
    }

    case 'attach':
    case 'invade': {
      if (!s.mj || !s.entry || !s.inward || !s.contactHeading) return s
      const mj = stepInvasion(s.mj, {
        dtSeconds: dt,
        traction: clamp01(s.zoite.adhesion / SUBSTRATE_GRIP),
        pressure: 0,
        rng,
      })
      const zoite = junctionPose(s.zoite, mj, s.entry, s.inward, s.contactHeading)
      if (mj.phase === 'failed') return enter(s, 'aborted', { mj, zoite })
      if (mj.phase === 'vacuoleSealed') {
        const origin = addV(s.entry, scaleV(s.inward, HALF_LENGTH + 0.6))
        const rest = scaleV(s.inward, -PV_REST_RADIUS)
        const pv: Vacuole = {
          center: vec3(origin.x, Math.max(REST_HEIGHT, origin.y), origin.z),
          origin,
          rest,
          parasites: 1,
          round: 0,
          division: 0,
          period: newPeriod(rng),
          axis: Math.atan2(s.inward.z, s.inward.x),
          egress: createEgressState(),
        }
        return enter(s, 'vacuole', { mj, zoite, pv })
      }
      if (s.phase === 'attach' && !ATTACH_MJ.includes(mj.phase)) return enter(s, 'invade', { mj, zoite })
      return { ...s, mj, zoite }
    }

    case 'vacuole': {
      if (!s.pv) return s
      const t = smooth(s.phaseTime / VACUOLE_SECONDS)
      const flat = lerpV(s.pv.origin, s.pv.rest, t)
      const center = vec3(flat.x, lerp(s.pv.origin.y, pvHeight(s.pv), t), flat.z)
      const pv = { ...s.pv, center }
      const zoite = { ...s.zoite, pos: center, speed: 0 }
      if (s.phaseTime >= VACUOLE_SECONDS) return enter(s, 'replicate', { pv, zoite })
      return { ...s, pv, zoite }
    }

    case 'replicate': {
      if (!s.pv) return s
      let { parasites, round, division, period } = s.pv
      division += dh / period
      if (division >= 1) {
        // endodyogeny: every mother is consumed by her two daughters
        parasites *= 2
        round += 1
        division -= 1
        period = newPeriod(rng)
      }
      const crowded = shouldTriggerEgress(parasites, SANDBOX_CAPACITY, 0, 0)
      if (crowded) division = 0
      const pv: Vacuole = { ...s.pv, parasites, round, division, period }
      pv.center = { ...pv.center, y: pvHeight(pv) }
      if (crowded) return enter(s, 'egress', { pv })
      return { ...s, pv }
    }

    case 'egress': {
      if (!s.pv) return s
      const egress = stepEgress(s.pv.egress, { dtSeconds: dt, triggered: true, deltaPlp1: s.flags.deltaPlp1, pressure: 0, rng })
      const pv = { ...s.pv, egress }
      if (egress.phase === 'trapped') return enter(s, 'trapped', { pv })
      if (egress.phase === 'ruptured') return enter(s, 'lysed', { pv, released: release(pv, rng) })
      return { ...s, pv }
    }

    case 'lysed': {
      if (s.phaseTime > TERMINAL_HOLD) return s
      return {
        ...s,
        released: s.released.map((z) => stepReleased(z, dt)),
        lysis: clamp01(s.lysis + dt / LYSIS_SECONDS),
      }
    }

    case 'trapped': {
      if (!s.pv || s.phaseTime > TERMINAL_HOLD) return s
      // the cascade keeps running: host inflammation builds instead of lysis
      const egress = stepEgress(s.pv.egress, { dtSeconds: dt, triggered: true, deltaPlp1: true, pressure: 0, rng })
      return { ...s, pv: { ...s.pv, egress } }
    }

    case 'stalled': {
      // sedimentation still finishes; the motor never turns over
      return { ...s, zoite: stepSubstrateGlide(s.zoite, { dt, target: vec3(), motile: false }) }
    }

    case 'aborted':
      return s
  }
}

/** The rosette breaks up: each daughter leaves along its own radial line. */
function release(pv: Vacuole, rng: Rng): ReleasedZoite[] {
  const out: ReleasedZoite[] = []
  for (let i = 0; i < pv.parasites; i++) {
    const pose = rosettePose(pv.parasites, i, 1, pv.axis)
    const flat = Math.hypot(pose.heading.x, pose.heading.z)
    const radial = flat > 0.05 ? Math.atan2(pose.heading.z, pose.heading.x) : pv.axis + i
    // each one sets off a little off its radial line
    const heading = dirFromAngle(radial + (nextFloat(rng) - 0.5) * RELEASE_SCATTER)
    out.push({ pos: addV(pv.center, pose.offset), heading, cyclePhase: nextFloat(rng), speed: 0 })
  }
  return out
}

/**
 * A freed daughter: it sinks through the debris to the dish and glides off with
 * the same stroke profile. It moves while touching membrane remnants or the
 * dish, never by free flight.
 */
function stepReleased(z: ReleasedZoite, dt: number): ReleasedZoite {
  const speed = PEAK_SPEED * strokeProfile(z.cyclePhase) * SUBSTRATE_GRIP
  const ds = speed * dt
  const y = Math.max(REST_HEIGHT, z.pos.y - 2 * dt)
  return {
    ...z,
    pos: vec3(z.pos.x + z.heading.x * ds, y, z.pos.z + z.heading.z * ds),
    cyclePhase: (z.cyclePhase + 1.8 * dt) % 1,
    speed,
  }
}

/** The loop's overall progress, 0–1, for the timeline. */
export function lyticProgress(s: LyticState): number {
  const i = LYTIC_ORDER.indexOf(s.phase)
  if (i < 0) return 0
  if (s.phase === 'lysed') return 1
  let within = 0
  if (s.phase === 'replicate' && s.pv) within = (s.pv.round + s.pv.division) / SANDBOX_ROUNDS
  else if (s.phase === 'vacuole') within = clamp01(s.phaseTime / VACUOLE_SECONDS)
  else if (s.mj && (s.phase === 'attach' || s.phase === 'invade')) within = s.mj.progress
  return (i + within) / (LYTIC_ORDER.length - 1)
}
