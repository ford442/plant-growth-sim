/**
 * Host-cell invasion through the moving junction.
 *
 * Research §6 and §12.5. Invasion is an active, strictly ordered sequence — not
 * phagocytosis — which is why the resulting parasitophorous vacuole carries no
 * host endocytic markers:
 *
 *   1. glide into contact; micronemes release MICs (TgMIC1 ↔ sialyl glycans)
 *   2. reorient so the apical complex faces the host membrane
 *   3. rhoptry *neck* discharges RON2/4/5/8 into the host; RON2's hairpin
 *      presents its D3/D4 loops on the host side
 *   4. parasite-surface AMA1 binds RON2 D3 in its hydrophobic groove
 *      (Trp353, Trp354, Tyr230) → the junction ring closes
 *   5. the glideosome drives the parasite through the ring
 *   6. the PV seals and the rhoptry *bulb* effectors (ROP16, ROP18/ROP5) are
 *      already in the host cytosol
 *
 * Failure modes are real: TgROM4/5 constitutively shed free AMA1, so a parasite
 * that dawdles between RON discharge and junction closure loses its receptor;
 * and without traction (ΔMIC2) there is nothing to pull it through the ring.
 */

import { clamp01, fires, nextFloat, type Rng } from './math'

export type MjPhase =
  | 'contact'
  | 'microneme'
  | 'reorient'
  | 'rhoptryNeck'
  | 'junction'
  | 'penetrating'
  | 'vacuoleSealed'
  | 'failed'

export const MJ_PHASES: MjPhase[] = [
  'contact',
  'microneme',
  'reorient',
  'rhoptryNeck',
  'junction',
  'penetrating',
  'vacuoleSealed',
]

export interface MjPhaseDef {
  id: MjPhase
  name: string
  /** Nominal duration in action seconds. */
  duration: number
  note: string
}

/** Durations sum to ~26 action seconds, matching observed 15–30 s invasions. */
export const MJ_PHASE_DEFS: Record<MjPhase, MjPhaseDef> = {
  contact: { id: 'contact', name: 'Contact', duration: 1.5, note: 'Glideosome brings the parasite onto the host surface.' },
  microneme: { id: 'microneme', name: 'Microneme release', duration: 2.5, note: 'MIC complexes engage host surface glycans.' },
  reorient: { id: 'reorient', name: 'Apical reorientation', duration: 3, note: 'Conoid end swings onto the membrane.' },
  rhoptryNeck: { id: 'rhoptryNeck', name: 'RON injection', duration: 1.5, note: 'RON2/4/5/8 delivered; RON2 D3/D4 exposed host-side.' },
  junction: { id: 'junction', name: 'AMA1–RON2 ring', duration: 2.5, note: 'AMA1 groove binds RON2 D3; the junction closes.' },
  penetrating: { id: 'penetrating', name: 'Through the junction', duration: 14, note: 'Traction pulls the parasite through a fixed ring.' },
  vacuoleSealed: { id: 'vacuoleSealed', name: 'PV sealed', duration: 0, note: 'Vacuole closed; ROP effectors already in the cytosol.' },
  failed: { id: 'failed', name: 'Aborted', duration: 0, note: 'Junction never formed, or traction failed mid-ring.' },
}

export interface MjState {
  phase: MjPhase
  /** Action seconds spent in the current phase. */
  elapsed: number
  /** 0–1 progress through the current phase. */
  progress: number
  /** Ring diameter as a fraction of the parasite's width, 1 → 0 while entering. */
  ringFraction: number
  /** Free (uncleaved) AMA1 available on the surface, 0–1. */
  ama1: number
  /** Host-side RON2 delivered, 0–1. */
  ron2: number
  /** Why the attempt aborted, if it did. */
  failure: MjFailure | null
  /** Id of the cell being entered. */
  cellId: number
}

export type MjFailure = 'ama1Shed' | 'noTraction' | 'hostResisted' | 'detached'

export const MJ_FAILURE_LABEL: Record<MjFailure, string> = {
  ama1Shed: 'ROM4/5 shed free AMA1 before the ring closed',
  noTraction: 'No adhesin traction — stalled in the junction',
  hostResisted: 'Host cell cleared the nascent vacuole',
  detached: 'Lost contact with the host surface',
}

/** AMA1 shedding rate by TgROM4/5 while the junction is still open, per second. */
const AMA1_SHED_RATE = 0.055

/**
 * Host clearance hazard for a nascent vacuole, per hour at full pressure.
 * Invasion only lasts ~26 action seconds (0.007 h), so the rate has to be this
 * large for pressure to matter at all on that timescale: at pressure 1 it gives
 * roughly even odds of the attempt being aborted.
 */
const ABORT_RATE_PER_HOUR = 95

export function beginInvasion(cellId: number): MjState {
  return {
    phase: 'contact',
    elapsed: 0,
    progress: 0,
    ringFraction: 1,
    ama1: 1,
    ron2: 0,
    failure: null,
    cellId,
  }
}

export interface MjInputs {
  /** Action seconds for this step. */
  dtSeconds: number
  /** Traction available from the glideosome, 0–1 (0 = ΔMIC2 / slipping). */
  traction: number
  /** Local immune pressure on this cell, 0–1 — can abort a nascent vacuole. */
  pressure: number
  rng: Rng
  /** ΔMIC2: adhesins non-functional, so the ring can never be traversed. */
  deltaMic2?: boolean
}

const ORDER: MjPhase[] = ['contact', 'microneme', 'reorient', 'rhoptryNeck', 'junction', 'penetrating']

/**
 * Advance the junction one step. Terminal phases (`vacuoleSealed`, `failed`)
 * are fixed points, so callers can step freely without special-casing.
 */
export function stepInvasion(state: MjState, input: MjInputs): MjState {
  if (state.phase === 'vacuoleSealed' || state.phase === 'failed') return state
  const dt = Math.max(0, input.dtSeconds)
  if (dt === 0) return state

  const traction = input.deltaMic2 ? 0 : clamp01(input.traction)
  const def = MJ_PHASE_DEFS[state.phase]

  let ama1 = state.ama1
  let ron2 = state.ron2
  let failure: MjFailure | null = null

  // ROM4/5 shed any AMA1 not yet clamped by RON2. Once the ring has closed the
  // bound AMA1 resists cleavage, so shedding only matters in this window.
  if (state.phase === 'rhoptryNeck' || state.phase === 'junction') {
    ama1 = Math.max(0, ama1 - AMA1_SHED_RATE * dt)
  }
  if (state.phase === 'rhoptryNeck') {
    ron2 = clamp01(ron2 + dt / Math.max(0.001, MJ_PHASE_DEFS.rhoptryNeck.duration))
  }

  // Reorientation and penetration are both powered by the glideosome.
  const motorPhases = state.phase === 'reorient' || state.phase === 'penetrating'
  const rate = motorPhases ? 0.15 + 0.85 * traction : 1
  const elapsed = state.elapsed + dt * rate
  const progress = def.duration > 0 ? clamp01(elapsed / def.duration) : 1

  // Host clearance of the nascent vacuole (full IRG/ROP accounting lives in
  // hostImmunity; here it is a hazard rate).
  if (input.pressure > 0.2 && fires(input.rng, input.pressure * ABORT_RATE_PER_HOUR, dt / 3600)) {
    failure = 'hostResisted'
  }
  // A parasite with no traction cannot cross the ring; it stalls and detaches.
  if (!failure && state.phase === 'penetrating' && traction < 0.05 && elapsed > 3) {
    failure = 'noTraction'
  }
  if (!failure && state.phase === 'junction' && ama1 < 0.2) {
    failure = 'ama1Shed'
  }

  if (failure) {
    return { ...state, phase: 'failed', elapsed, progress: 1, ama1, ron2, failure }
  }

  const ringFraction = state.phase === 'penetrating' ? 1 - progress : state.phase === 'junction' ? 1 : 1

  if (progress < 1) {
    return { ...state, elapsed, progress, ringFraction, ama1, ron2 }
  }

  // phase complete → advance
  const next = ORDER[ORDER.indexOf(state.phase) + 1]
  if (!next) {
    return { ...state, phase: 'vacuoleSealed', elapsed: 0, progress: 1, ringFraction: 0, ama1, ron2 }
  }

  // Junction closure needs enough intact AMA1 to engage the delivered RON2.
  if (next === 'junction' && ama1 * Math.max(ron2, 0.2) < 0.25) {
    return { ...state, phase: 'failed', elapsed, progress: 1, ama1, ron2, failure: 'ama1Shed' }
  }

  return { ...state, phase: next, elapsed: 0, progress: 0, ringFraction, ama1, ron2 }
}

export const invasionSucceeded = (state: MjState) => state.phase === 'vacuoleSealed'
export const invasionFailed = (state: MjState) => state.phase === 'failed'
export const invasionActive = (state: MjState) => !invasionSucceeded(state) && !invasionFailed(state)

/** Overall 0–1 progress across the whole sequence, for the UI. */
export function invasionProgress(state: MjState): number {
  if (state.phase === 'vacuoleSealed') return 1
  if (state.phase === 'failed') return 1
  const total = ORDER.reduce((sum, p) => sum + MJ_PHASE_DEFS[p].duration, 0)
  let done = 0
  for (const p of ORDER) {
    if (p === state.phase) break
    done += MJ_PHASE_DEFS[p].duration
  }
  return clamp01((done + state.progress * MJ_PHASE_DEFS[state.phase].duration) / total)
}

/**
 * Should this parasite commit to invading the cell it just touched? Gives the
 * sim some variance without an explicit decision tree.
 */
export function willAttempt(rng: Rng, substrate: number, adhesin: boolean): boolean {
  if (!adhesin) return nextFloat(rng) < 0.15
  return nextFloat(rng) < 0.45 + 0.5 * clamp01(substrate)
}
