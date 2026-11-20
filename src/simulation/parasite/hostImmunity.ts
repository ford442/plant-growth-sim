/**
 * Host-side pressure fields and tissue niches — the parasite-mode analogue of
 * the plant weather model. Pure state in, pure state out.
 *
 * Research: `docs/research/toxoplasma-gondii-parameters.md` §§2.2, 7, 12.7.
 */

import { clamp01 } from './math'

// ---------------------------------------------------------------------------
// Tissue niches (research §2.2 tropism row)
// ---------------------------------------------------------------------------

export type NicheId =
  | 'skeletalMuscle'
  | 'cardiacMuscle'
  | 'retina'
  | 'cnsCortex'
  | 'cnsAmygdala'

export interface NicheDef {
  id: NicheId
  name: string
  /** Relative cyst-seeding preference once latency starts (sums ≈ 1). */
  tropism: number
  /**
   * How much of the systemic IFN-γ/IRG field actually reaches this tissue.
   * Immune-privileged sites (retina, CNS) shelter cysts — which is exactly why
   * chronic infection lives there.
   */
  immunePrivilege: number
  /** Contribution to host health loss when tissue here is destroyed. */
  fragility: number
  color: string
  note: string
}

export const NICHE_DEFS: Record<NicheId, NicheDef> = {
  skeletalMuscle: {
    id: 'skeletalMuscle',
    name: 'Skeletal muscle',
    tropism: 0.3,
    immunePrivilege: 0.25,
    fragility: 0.4,
    color: '#f87171',
    note: 'Bulk reservoir for carnivory transmission. Patrolled, but cheap to lose.',
  },
  cardiacMuscle: {
    id: 'cardiacMuscle',
    name: 'Cardiac muscle',
    tropism: 0.12,
    immunePrivilege: 0.3,
    fragility: 1.6,
    color: '#fb7185',
    note: 'Same myocyte tropism as skeletal muscle, far less forgiving of lysis.',
  },
  retina: {
    id: 'retina',
    name: 'Retina',
    tropism: 0.12,
    immunePrivilege: 0.75,
    fragility: 0.7,
    color: '#fbbf24',
    note: 'Immune-privileged. Classic site of reactivated chorioretinal lesions.',
  },
  cnsCortex: {
    id: 'cnsCortex',
    name: 'CNS — cortex',
    tropism: 0.31,
    immunePrivilege: 0.8,
    fragility: 1.1,
    color: '#60a5fa',
    note: 'Behind the blood–brain barrier: the dominant long-term cyst compartment.',
  },
  cnsAmygdala: {
    id: 'cnsAmygdala',
    name: 'CNS — amygdala',
    tropism: 0.15,
    immunePrivilege: 0.85,
    fragility: 1.3,
    color: '#a78bfa',
    note: 'Reported medial/basolateral predilection; the host-behaviour objective target.',
  },
}

export const NICHES: NicheId[] = [
  'skeletalMuscle',
  'cardiacMuscle',
  'retina',
  'cnsCortex',
  'cnsAmygdala',
]

// ---------------------------------------------------------------------------
// Immune fields
// ---------------------------------------------------------------------------

export interface ImmuneFields {
  /** Innate myeloid alarm → drives IFN-γ. */
  il12: number
  /** The master anti-*Toxoplasma* cytokine. */
  ifnGamma: number
  /** Immunity-related GTPases: the effector that actually strips a PV. */
  irg: number
  /** iNOS product; stresses the parasite and pushes bradyzoite conversion. */
  no: number
  /** Reactive oxygen species from activated macrophages. */
  ros: number
}

export const QUIESCENT_FIELDS: ImmuneFields = { il12: 0.04, ifnGamma: 0.03, irg: 0.02, no: 0.02, ros: 0.05 }

/** Secreted effectors the player can switch on (research §7). */
export interface EffectorFlags {
  /** ROP16: STAT3/6 phosphorylation → M2 macrophages, ↓IL-12, ↓NO, ↓ROS. */
  rop16: boolean
  /** ROP18 + ROP5: block IRG oligomerisation on the PVM. */
  rop18rop5: boolean
  /** TgIST: nuclear Mi-2/NuRD recruitment → represses STAT1/IFN-γ programs. */
  tgist: boolean
}

export const DEFAULT_EFFECTORS: EffectorFlags = { rop16: true, rop18rop5: true, tgist: false }

export interface HostState {
  /** 1 = well, 0 = dead. Lose condition for most objectives. */
  health: number
  fields: ImmuneFields
  /** ROP16-driven M2 polarisation, 0–1. */
  m2: number
  /** Lesion hours since the host first saw parasite antigen. */
  antigenHours: number
  /** 0 = intact immunity, 1 = fully suppressed (the reactivation lever). */
  immunosuppression: number
  /** Smoothed systemic parasite burden that drives the innate response. */
  perceivedLoad: number
  /** Cumulative cells destroyed, for the scoreboard. */
  cellsLysed: number
  /** True once adaptive immunity has effectively failed → cysts can reactivate. */
  collapsed: boolean
}

export function createHostState(immunosuppression = 0): HostState {
  return {
    health: 1,
    fields: { ...QUIESCENT_FIELDS },
    m2: 0,
    antigenHours: 0,
    immunosuppression,
    perceivedLoad: 0,
    cellsLysed: 0,
    collapsed: false,
  }
}

/** Environmental stressors the player dials in (research §9 trigger list). */
export interface StressLevers {
  /** Alkaline shift; 0 maps to pH 7.0, 1 to pH 8.2. */
  alkaline: number
  /** Nutrient (arginine/glutamine) deprivation. */
  starvation: number
  /** Heat shock, 0 at 37 °C → 1 at 43 °C. */
  heatShock: number
}

export const DEFAULT_STRESS: StressLevers = { alkaline: 0, starvation: 0, heatShock: 0 }

/** Player-facing pH readout for the alkaline lever. */
export const PH_MIN = 7.0
export const PH_MAX = 8.2
export const leverToPh = (alkaline: number) => PH_MIN + (PH_MAX - PH_MIN) * clamp01(alkaline)

export interface ImmuneInputs {
  /** Extracellular + intracellular parasites currently in the compartment. */
  load: number
  /** Host cells destroyed since the last step. */
  lysedThisStep: number
  effectors: EffectorFlags
  /** Lesion hours elapsed. */
  dtHours: number
}

/**
 * Advance the host. Innate alarm tracks load and lysis; adaptive IFN-γ ramps in
 * after a delay and is then throttled by M2 polarisation, TgIST and the
 * immunosuppression lever. IRG — the effector that actually clears a vacuole —
 * follows IFN-γ.
 */
export function stepHost(host: HostState, input: ImmuneInputs): HostState {
  const { load, lysedThisStep, effectors, dtHours } = input
  const dt = Math.max(0, dtHours)
  const f = host.fields

  // perceived load lags the true load (antigen presentation takes time)
  const perceivedLoad = approach(host.perceivedLoad, load, 0.12, dt)
  const alarm = clamp01(perceivedLoad / 40 + lysedThisStep * 0.08)

  const antigenHours = perceivedLoad > 0.5 || host.antigenHours > 0 ? host.antigenHours + dt : 0
  // adaptive arm needs ~72 lesion hours to come up, then saturates
  const adaptive = clamp01((antigenHours - 24) / 72)

  // ROP16 drives M2: arginase up, iNOS down, IL-12 down (research §7)
  const m2Target = effectors.rop16 ? clamp01(0.25 + 0.6 * clamp01(perceivedLoad / 25)) : 0
  const m2 = approach(host.m2, m2Target, 0.1, dt)

  const suppression = clamp01(host.immunosuppression)
  const istFactor = effectors.tgist ? 0.45 : 1
  const openness = (1 - suppression) * (1 - 0.55 * m2)

  const il12 = approach(f.il12, clamp01(alarm * openness), 0.08, dt)
  const ifnGamma = approach(
    f.ifnGamma,
    clamp01((0.25 * il12 + 0.9 * adaptive * alarm) * openness * istFactor),
    0.06,
    dt,
  )
  // IRG oligomerisation is what strips the PVM; ROP18/ROP5 is handled per-PV
  const irg = approach(f.irg, clamp01(ifnGamma * 0.95) * (1 - 0.3 * suppression), 0.1, dt)
  const no = approach(f.no, clamp01(ifnGamma * (1 - 0.8 * m2)), 0.09, dt)
  const ros = approach(f.ros, clamp01((0.3 * alarm + 0.6 * il12) * (1 - 0.75 * m2)), 0.14, dt)

  // health: acute lysis burden, modulated by how inflamed the host already is
  const inflammation = 0.5 * ifnGamma + 0.3 * no + 0.2 * ros
  const damage = lysedThisStep * 0.0014 * (1 + inflammation) + perceivedLoad * 1.5e-5 * dt
  const repair = 0.0009 * dt * (1 - 0.6 * inflammation)
  const health = clamp01(host.health - damage + repair)

  // "Collapsed" means the host *had* control and lost it. A naive host simply
  // has no fields up yet, which is not a collapse — otherwise every fresh
  // infection would reactivate its own cysts the moment they formed.
  const effectiveImmunity = clamp01(ifnGamma * 0.6 + irg * 0.4)
  const collapsed =
    antigenHours > 48 && effectiveImmunity < 0.06 && (suppression > 0.6 || health < 0.25)

  return {
    health,
    fields: { il12, ifnGamma, irg, no, ros },
    m2,
    antigenHours,
    immunosuppression: host.immunosuppression,
    perceivedLoad,
    cellsLysed: host.cellsLysed + lysedThisStep,
    collapsed,
  }
}

/**
 * Pressure actually felt by a vacuole in a given niche: the systemic IRG/ROS
 * field filtered by immune privilege, then by the ROP18/ROP5 shield.
 *
 * Research §7: ROP18+ROP5 sit on the cytosolic face of the PVM and block IRG
 * oligomerisation, so the shield is multiplicative on the IRG term only.
 */
export function vacuolePressure(
  host: HostState,
  niche: NicheId,
  effectors: EffectorFlags,
): number {
  const privilege = NICHE_DEFS[niche].immunePrivilege
  const reach = 1 - privilege
  const shield = effectors.rop18rop5 ? 0.18 : 1
  const irgTerm = host.fields.irg * shield
  const oxidative = host.fields.ros * 0.35 + host.fields.no * 0.45
  return clamp01((irgTerm * 0.75 + oxidative * 0.5) * reach)
}

/**
 * Total stress on a parasite: immune oxidative burst plus the player's
 * alkaline / starvation / heat levers. This is the input to the BFD1 switch
 * (research §9 trigger list).
 */
export function parasiteStress(
  host: HostState,
  niche: NicheId,
  stress: StressLevers,
  effectors: EffectorFlags,
): number {
  const immune = vacuolePressure(host, niche, effectors) * 0.8 + host.fields.no * 0.5
  const lever = clamp01(stress.alkaline) * 0.9 + clamp01(stress.starvation) * 0.6 + clamp01(stress.heatShock) * 0.5
  return clamp01(immune + lever)
}

/** First-order approach toward a target, stable for any dt. */
function approach(current: number, target: number, rate: number, dt: number): number {
  const a = 1 - Math.exp(-Math.max(0, rate) * Math.max(0, dt))
  return current + (target - current) * a
}

/** Weighted niche pick for cyst seeding; `rand` is a 0–1 draw. */
export function pickNiche(rand: number, weights?: Partial<Record<NicheId, number>>): NicheId {
  const w = NICHES.map((id) => Math.max(0, weights?.[id] ?? NICHE_DEFS[id].tropism))
  const total = w.reduce((a, b) => a + b, 0)
  if (total <= 0) return 'cnsCortex'
  let r = rand * total
  for (let i = 0; i < NICHES.length; i++) {
    r -= w[i]
    if (r <= 0) return NICHES[i]
  }
  return NICHES[NICHES.length - 1]
}
