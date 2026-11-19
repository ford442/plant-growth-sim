/**
 * Egress — the end of the lytic cycle.
 *
 * Research §10 and §12.6. Egress is a staged cascade, not a burst:
 *
 *   1. **FNT1/FNT2** dump lactate and pyruvate out of the parasite, which
 *      acidifies the vacuolar space (pH ~7.2 → ~5.8).
 *   2. That low pH is where **TgPLP1** is maximally active, and it also arms
 *      host calpains.
 *   3. A cytosolic **Ca²⁺** spike discharges micronemes.
 *   4. TgPLP1 (MACPF + APC-β) oligomerises into hexameric rings on membranes
 *      enriched in PE/PS — the inner leaflets — punching ~100 Å pores.
 *   5. The PV membrane and then the host plasma membrane fail; tachyzoites
 *      glide out.
 *
 * Δplp1 parasites stay trapped: the lesion resolves by host inflammatory
 * destruction instead, which — counter-intuitively but per the research — lets
 * the host mount *earlier* protective immunity rather than the cytokine storm
 * that wild-type egress provokes.
 */

import { clamp01, type Rng, fires } from './math'

export type EgressPhase =
  | 'quiescent'
  | 'acidifying'
  | 'calciumSpike'
  | 'perforating'
  | 'ruptured'
  | 'trapped'

export const EGRESS_PHASE_LABEL: Record<EgressPhase, string> = {
  quiescent: 'Vacuole stable',
  acidifying: 'FNT1/2 acidifying the PV',
  calciumSpike: 'Cytosolic Ca²⁺ spike',
  perforating: 'TgPLP1 pores forming',
  ruptured: 'PV and host membrane breached',
  trapped: 'Δplp1 — trapped in the vacuole',
}

/** Resting vacuolar pH. */
export const PV_PH_RESTING = 7.2
/** pH at which TgPLP1 is maximally active. */
export const PV_PH_PERMISSIVE = 5.8
/** Pores needed to breach both membranes. */
export const PORES_TO_RUPTURE = 24
/** Pore diameter, ångström (research §10). */
export const PLP1_PORE_DIAMETER = 100

export interface EgressState {
  phase: EgressPhase
  /** Vacuolar pH. */
  ph: number
  /** Cytosolic Ca²⁺, 0–1 (relative to the spike peak). */
  calcium: number
  /** Assembled TgPLP1 hexameric rings. */
  pores: number
  /** Action seconds since the cascade started. */
  elapsed: number
  /** Host-cell inflammatory damage accumulated while trapped, 0–1. */
  inflammation: number
}

export function createEgressState(): EgressState {
  return {
    phase: 'quiescent',
    ph: PV_PH_RESTING,
    calcium: 0.02,
    pores: 0,
    elapsed: 0,
    inflammation: 0,
  }
}

export interface EgressInputs {
  /** Action seconds for this step. */
  dtSeconds: number
  /**
   * Has the cascade been triggered? In play this is PV crowding, nutrient
   * exhaustion, or the player's manual trigger.
   */
  triggered: boolean
  /** Δplp1: no perforin, so the vacuole never opens from the inside. */
  deltaPlp1?: boolean
  /** Local immune pressure, which accelerates inflammatory lysis when trapped. */
  pressure?: number
  rng: Rng
}

const ACIDIFY_RATE = 0.42 // pH units per action second
const CALCIUM_RISE = 1.8
const PORE_RATE = 7 // rings per action second at permissive pH

/** One step of the egress cascade. Terminal phases are fixed points. */
export function stepEgress(state: EgressState, input: EgressInputs): EgressState {
  const dt = Math.max(0, input.dtSeconds)
  if (dt === 0) return state
  if (state.phase === 'ruptured') return state

  if (state.phase === 'trapped') {
    // The lesion still resolves, just slowly and by the host's own hand.
    const pressure = clamp01(input.pressure ?? 0)
    const inflammation = clamp01(state.inflammation + (0.004 + 0.02 * pressure) * dt)
    return { ...state, inflammation, elapsed: state.elapsed + dt }
  }

  if (!input.triggered) {
    // relax back toward resting pH if the trigger was withdrawn
    const ph = Math.min(PV_PH_RESTING, state.ph + 0.15 * dt)
    const calcium = Math.max(0.02, state.calcium - 0.6 * dt)
    return {
      ...state,
      phase: ph > PV_PH_RESTING - 0.05 ? 'quiescent' : 'acidifying',
      ph,
      calcium,
      pores: Math.max(0, state.pores - 2 * dt),
      elapsed: 0,
    }
  }

  const elapsed = state.elapsed + dt
  const ph = Math.max(PV_PH_PERMISSIVE, state.ph - ACIDIFY_RATE * dt)
  const permissive = clamp01((PV_PH_RESTING - ph) / (PV_PH_RESTING - PV_PH_PERMISSIVE))

  // Ca²⁺ only spikes once the compartment has acidified enough to arm it.
  const calcium =
    permissive > 0.6
      ? clamp01(state.calcium + CALCIUM_RISE * dt)
      : Math.max(0.02, state.calcium - 0.2 * dt)

  if (input.deltaPlp1) {
    // Everything upstream still happens — the parasite just has no perforin.
    const stuck = permissive > 0.9 && calcium > 0.8 && elapsed > 2
    return {
      ...state,
      phase: stuck ? 'trapped' : 'acidifying',
      ph,
      calcium,
      pores: 0,
      elapsed,
    }
  }

  // PLP1 inserts preferentially into PE/PS-rich inner leaflets, and only at
  // low pH with micronemes discharged.
  const poreRate = PORE_RATE * permissive * clamp01(calcium)
  const pores = state.pores + poreRate * dt

  let phase: EgressPhase = 'acidifying'
  if (pores >= PORES_TO_RUPTURE) phase = 'ruptured'
  else if (pores > 0.5) phase = 'perforating'
  else if (calcium > 0.35) phase = 'calciumSpike'

  // a little variance in exactly when the membrane gives way
  if (phase === 'perforating' && pores > PORES_TO_RUPTURE * 0.75 && fires(input.rng, 900, dt / 3600)) {
    phase = 'ruptured'
  }

  return { phase, ph, calcium, pores, elapsed, inflammation: state.inflammation }
}

export const egressComplete = (s: EgressState) => s.phase === 'ruptured'
export const egressTrapped = (s: EgressState) => s.phase === 'trapped'

/** 0–1 progress through the cascade, for the UI. */
export function egressProgress(state: EgressState): number {
  if (state.phase === 'ruptured') return 1
  if (state.phase === 'trapped') return clamp01(state.inflammation)
  const acid = clamp01((PV_PH_RESTING - state.ph) / (PV_PH_RESTING - PV_PH_PERMISSIVE))
  const pore = clamp01(state.pores / PORES_TO_RUPTURE)
  return clamp01(acid * 0.4 + clamp01(state.calcium) * 0.2 + pore * 0.4)
}

/**
 * Should a vacuole start egressing on its own? Crowding is the dominant cue;
 * a starved or heavily pressured vacuole bails out early.
 */
export function shouldTriggerEgress(
  parasites: number,
  capacity: number,
  pressure: number,
  starvation: number,
): boolean {
  const crowding = parasites / Math.max(1, capacity)
  return crowding >= 1 || (crowding > 0.4 && (pressure > 0.65 || starvation > 0.7))
}
