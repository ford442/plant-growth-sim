/**
 * Life-stage definitions and the parasite-mode time base.
 *
 * Every number here traces to `docs/research/toxoplasma-gondii-parameters.md`
 * (section numbers in the comments). Units are micrometres and *simulation*
 * hours/seconds; nothing in this module touches Three.js or the store.
 */

export type Compartment =
  /** soil / water: oocysts only, no host */
  | 'environment'
  /** extra-intestinal tissue of an intermediate host: the asexual game */
  | 'intermediateTissue'
  /** enterocytes of a felid definitive host: the sexual endgame */
  | 'felidGut'

export const COMPARTMENTS: Compartment[] = ['environment', 'intermediateTissue', 'felidGut']

export const COMPARTMENT_LABEL: Record<Compartment, string> = {
  environment: 'Soil & water',
  intermediateTissue: 'Intermediate host',
  felidGut: 'Felid gut',
}

/**
 * Every morphology the sim can draw (research §2, quick stage table).
 * `tissueCyst` is a structure rather than a single cell, but it carries a
 * dimension entry so the views can scale it against the others honestly.
 */
export type LifeStage =
  | 'tachyzoite'
  | 'bradyzoite'
  | 'tissueCyst'
  | 'unsporulatedOocyst'
  | 'sporulatedOocyst'
  | 'sporozoite'
  | 'merozoite'

/** The subset a single mobile/replicative agent can occupy. */
export type AgentStage = Extract<LifeStage, 'tachyzoite' | 'bradyzoite' | 'sporozoite' | 'merozoite'>

export interface StageDef {
  id: LifeStage
  name: string
  /** Long axis, µm. */
  length: number
  /** Short axis, µm (cyst/oocyst: second diameter). */
  width: number
  /** Peak gliding speed, µm/s — 0 for sessile stages (research §5). */
  speed: number
  /** Where this morphology exists. */
  compartments: Compartment[]
  /** UI colour; stays inside the dark-microscopy palette. */
  color: string
  /** One-line description for the info panel. */
  note: string
}

/** Research §2.1–2.3 + quick stage table. */
export const STAGE_DEFS: Record<LifeStage, StageDef> = {
  tachyzoite: {
    id: 'tachyzoite',
    name: 'Tachyzoite',
    length: 6,
    width: 2,
    speed: 3,
    compartments: ['intermediateTissue', 'felidGut'],
    color: '#5eead4',
    note: 'Crescent, central nucleus. Endodyogeny every ~7 h inside a parasitophorous vacuole.',
  },
  bradyzoite: {
    id: 'bradyzoite',
    name: 'Bradyzoite',
    length: 7,
    width: 1.5,
    speed: 0.2,
    compartments: ['intermediateTissue', 'felidGut'],
    color: '#a78bfa',
    note: 'Slender, posterior nucleus, amylopectin-loaded. Latent inside a tissue cyst.',
  },
  tissueCyst: {
    id: 'tissueCyst',
    name: 'Tissue cyst',
    length: 70,
    width: 70,
    speed: 0,
    compartments: ['intermediateTissue'],
    color: '#8b5cf6',
    note: 'Glycosylated PVM derivative, wall <0.5 µm. 5 µm / 2 bradyzoites → 70 µm / >1000.',
  },
  unsporulatedOocyst: {
    id: 'unsporulatedOocyst',
    name: 'Unsporulated oocyst',
    length: 12,
    width: 11,
    speed: 0,
    compartments: ['environment'],
    color: '#64748b',
    note: 'Two-layered wall, single sporont. Shed non-infectious; needs O₂ to mature.',
  },
  sporulatedOocyst: {
    id: 'sporulatedOocyst',
    name: 'Sporulated oocyst',
    length: 13,
    width: 11,
    speed: 0,
    compartments: ['environment'],
    color: '#fbbf24',
    note: '2 sporocysts × 4 sporozoites. ~350 nm micropyle; viable months in moist soil.',
  },
  sporozoite: {
    id: 'sporozoite',
    name: 'Sporozoite',
    length: 6,
    width: 2,
    speed: 2.4,
    compartments: ['intermediateTissue', 'felidGut'],
    color: '#fcd34d',
    note: 'Excysts through the micropyle under bile salts + trypsin, then converts to tachyzoite.',
  },
  merozoite: {
    id: 'merozoite',
    name: 'Merozoite',
    length: 7,
    width: 2,
    speed: 1.5,
    compartments: ['felidGut'],
    color: '#f472b6',
    note: 'Felid enterocyte stage. Endopolygeny into ~30 daughters, then gametogony.',
  },
}

export const AGENT_STAGES: AgentStage[] = ['tachyzoite', 'bradyzoite', 'sporozoite', 'merozoite']

// ---------------------------------------------------------------------------
// Time base — the "two gears" decision (docs/design/parasite-mode.md §3)
// ---------------------------------------------------------------------------

/**
 * *T. gondii* spans ~7 decades of time: a traction pulse lasts ~0.1 s, an
 * oocyst stays infectious for 18 months. One linear clock cannot show both, so
 * parasite mode runs two gears off the shared speed slider:
 *
 *  - **action seconds** — gliding, moving-junction assembly, egress.
 *  - **lesion hours** — replication, cyst maturation, sporulation, immunity.
 *
 * Both scale with `timeStore.speed`, normalised so the plant default (0.5 d/s)
 * is "1×". They are deliberately inconsistent with each other: a 3-second glide
 * burns 12 action-seconds but also ~2.7 lesion-hours. The HUD shows both clocks
 * so the abstraction is visible rather than hidden.
 */
export const REFERENCE_SPEED = 0.5

/** Lesion hours advanced per real second at 1×. 7 h endodyogeny ≈ 7.8 s of play. */
export const LESION_HOURS_PER_SECOND = 0.9

/** Action seconds advanced per real second at 1×. A 30 µm cell crossing ≈ 2.5 s. */
export const ACTION_SECONDS_PER_SECOND = 4

/**
 * Oocyst shelf life (research §2.3: up to 18 months) compressed against the
 * lesion clock so the endurance objective fits one session: 18 months of
 * viability decays in ~6 minutes of play at 1×.
 */
export const OOCYST_AGEING = 90

export interface Clocks {
  /** Biomechanical time step, simulation seconds. */
  action: number
  /** Developmental time step, simulation hours. */
  lesion: number
}

/**
 * Convert a real frame delta into both gears. `speed` is the shared
 * `timeStore.speed` in plant-equivalent days per second.
 */
export function advanceClocks(dtSeconds: number, speed: number): Clocks {
  const k = Math.max(0, speed) / REFERENCE_SPEED
  return {
    action: dtSeconds * ACTION_SECONDS_PER_SECOND * k,
    lesion: dtSeconds * LESION_HOURS_PER_SECOND * k,
  }
}

// ---------------------------------------------------------------------------
// Developmental constants (research §2, §12.2)
// ---------------------------------------------------------------------------

/** Endodyogeny period, lesion hours — only ticks inside a PV. */
export const ENDODYOGENY_HOURS = 7

/** Bradyzoites divide far more slowly inside a mature cyst. */
export const BRADYZOITE_DIVISION_HOURS = 24

/** A PV rosette lyses its host cell around here (research §10 egress trigger). */
export const PV_CAPACITY = 64

/** Cyst geometry: 5 µm at 2 bradyzoites → ~70 µm past 1000 (research §2.2). */
export const CYST_MIN_DIAMETER = 5
export const CYST_MAX_DIAMETER = 70
export const CYST_MAX_BRADYZOITES = 1024
export const CYST_WALL_MAX = 0.5

/** Sporulation window, lesion hours (research §2.3: 1–5 days, needs O₂). */
export const SPORULATION_MIN_HOURS = 24
export const SPORULATION_MAX_HOURS = 120

/** Sporozoites per sporulated oocyst: 2 sporocysts × 4. */
export const SPOROZOITES_PER_OOCYST = 8

/** Oocysts a felid sheds per completed sexual cycle (millions in reality). */
export const OOCYSTS_PER_SHED = 2_000_000

/**
 * Power-law exponent fitted to the two documented anchors — 5 µm at 2
 * bradyzoites and ~70 µm past 1000. It lands near 0.42 rather than the 1/3 of
 * pure sphere packing, because a maturing cyst expands its wall and displaces
 * host cytoplasm as well as simply holding more parasites.
 */
export const CYST_PACKING_EXPONENT =
  Math.log(CYST_MAX_DIAMETER / CYST_MIN_DIAMETER) / Math.log(CYST_MAX_BRADYZOITES / 2)

/** Cyst diameter for a bradyzoite count, through both documented anchors. */
export function cystDiameter(bradyzoites: number): number {
  const n = Math.min(CYST_MAX_BRADYZOITES, Math.max(2, bradyzoites))
  return CYST_MIN_DIAMETER * (n / 2) ** CYST_PACKING_EXPONENT
}

/** Wall thickens as the cyst matures but never passes the measured 0.5 µm. */
export function cystWallThickness(bradyzoites: number): number {
  const t = Math.min(1, Math.log2(Math.max(2, bradyzoites)) / Math.log2(CYST_MAX_BRADYZOITES))
  return 0.12 + (CYST_WALL_MAX - 0.12) * t
}
