/**
 * The life-cycle graph — every stage transition in one declarative table.
 *
 * Mirrors the FSM in research §12.1:
 *
 *   ENVIRONMENT: UnsporulatedOocyst --[1–5 d, O₂ + temperature]--> SporulatedOocyst
 *   HOST_GUT:    SporulatedOocyst --[micropyle + bile/trypsin]--> Sporozoite --> Tachyzoite
 *   INTRACELL:   Tachyzoite --[endodyogeny ~7 h in PV]--> Tachyzoite ×2
 *                Tachyzoite --[stress + BFD1 lock]--> Bradyzoite
 *                Bradyzoite --[immunity ≈ 0 / wall rupture]--> Tachyzoite
 *   FELID_GUT:   Bradyzoite --> Merozoite --[endopolygeny]--> gametes --> Oocyst
 *
 * Keeping it declarative means the graph can be rendered in the UI and tested
 * transition by transition without running the whole world.
 */

import { isCommitted, isLocked, REACTIVATION_IMMUNITY, type BfdState } from './bfdSwitch'
import type { Modifiers } from './modifiers'
import { SPORULATION_MIN_HOURS, type Compartment, type LifeStage } from './stages'

export type TransitionId =
  | 'sporulation'
  | 'excystation'
  | 'sporozoiteToTachyzoite'
  | 'tachyzoiteToBradyzoite'
  | 'bradyzoiteReactivation'
  | 'bradyzoiteToMerozoite'
  | 'gametogony'

export interface TransitionContext {
  stage: LifeStage
  compartment: Compartment
  /** Lesion hours spent in the current stage. */
  hoursInStage: number
  bfd: BfdState
  /** Effective host immunity, 0–1. */
  immunity: number
  modifiers: Modifiers
  /** Environment: dissolved O₂ / aeration, 0–1 (sporulation needs it). */
  oxygen?: number
  /** Environment: temperature, °C (sporulation stalls when cold). */
  temperature?: number
  /** Gut: bile salts + trypsin activity, 0–1 (drives excystation). */
  bile?: number
  /** Is the parasite inside a parasitophorous vacuole? */
  inVacuole?: boolean
  /** Has the cyst wall been breached? */
  cystRuptured?: boolean
}

export interface Transition {
  id: TransitionId
  from: LifeStage
  to: LifeStage
  name: string
  /** Compartments this transition can happen in; empty means anywhere. */
  compartments: Compartment[]
  /** Research cross-reference, shown in the UI. */
  note: string
  /** Pure guard: is this transition allowed right now? */
  test: (ctx: TransitionContext) => boolean
}

export const LIFE_CYCLE: Transition[] = [
  {
    id: 'sporulation',
    from: 'unsporulatedOocyst',
    to: 'sporulatedOocyst',
    name: 'Sporulation',
    compartments: ['environment'],
    note: '1–5 days with oxygen and a workable temperature; yields 2 sporocysts × 4 sporozoites.',
    test: (ctx) =>
      ctx.hoursInStage >= SPORULATION_MIN_HOURS &&
      (ctx.oxygen ?? 1) > 0.2 &&
      (ctx.temperature ?? 22) > 4 &&
      (ctx.temperature ?? 22) < 45,
  },
  {
    id: 'excystation',
    from: 'sporulatedOocyst',
    to: 'sporozoite',
    name: 'Excystation',
    compartments: ['intermediateTissue', 'felidGut'],
    note: 'Sporozoites leave through the ~350 nm micropyle under bile salts and trypsin.',
    test: (ctx) => (ctx.bile ?? 0) > 0.35,
  },
  {
    id: 'sporozoiteToTachyzoite',
    from: 'sporozoite',
    to: 'tachyzoite',
    name: 'Sporozoite → tachyzoite',
    compartments: ['intermediateTissue', 'felidGut'],
    note: 'Converts within the first vacuoles of the intestinal epithelium.',
    test: (ctx) => ctx.inVacuole === true && ctx.hoursInStage >= 6,
  },
  {
    id: 'tachyzoiteToBradyzoite',
    from: 'tachyzoite',
    to: 'bradyzoite',
    name: 'Tachyzoite → bradyzoite',
    compartments: ['intermediateTissue'],
    note: 'Stress opens BFD1 translation; the BFD1↔BFD2 loop then latches the program.',
    test: (ctx) => !ctx.modifiers.deltaBfd1 && isCommitted(ctx.bfd),
  },
  {
    id: 'bradyzoiteReactivation',
    from: 'bradyzoite',
    to: 'tachyzoite',
    name: 'Reactivation',
    compartments: ['intermediateTissue'],
    note: 'Only when immunity has effectively collapsed; the wall ruptures and recrudescence follows.',
    test: (ctx) =>
      !ctx.modifiers.lockedLatency &&
      ctx.immunity <= REACTIVATION_IMMUNITY &&
      (ctx.cystRuptured === true || !isLocked(ctx.bfd)),
  },
  {
    id: 'bradyzoiteToMerozoite',
    from: 'bradyzoite',
    to: 'merozoite',
    name: 'Bradyzoite → merozoite',
    compartments: ['felidGut'],
    note: 'Ingested cysts release bradyzoites that enter felid enterocytes and switch to schizogony.',
    test: (ctx) => ctx.hoursInStage >= 4,
  },
  {
    id: 'gametogony',
    from: 'merozoite',
    to: 'unsporulatedOocyst',
    name: 'Gametogony → oocyst',
    compartments: ['felidGut'],
    note: 'Endopolygeny into ~30 daughters, then micro/macrogametes, zygote and a shed oocyst.',
    test: (ctx) => ctx.hoursInStage >= 36,
  },
]

/** Index for quick lookups by source stage. */
export const TRANSITIONS_FROM: Record<LifeStage, Transition[]> = LIFE_CYCLE.reduce(
  (acc, t) => {
    ;(acc[t.from] ||= []).push(t)
    return acc
  },
  {} as Record<LifeStage, Transition[]>,
)

/**
 * The first allowed transition out of `ctx.stage`, or null. Order in
 * `LIFE_CYCLE` is the priority order.
 */
export function nextTransition(ctx: TransitionContext): Transition | null {
  for (const t of LIFE_CYCLE) {
    if (t.from !== ctx.stage) continue
    if (t.compartments.length > 0 && !t.compartments.includes(ctx.compartment)) continue
    if (t.test(ctx)) return t
  }
  return null
}

/** Convenience wrapper: the stage after applying any allowed transition. */
export function nextStage(ctx: TransitionContext): LifeStage {
  return nextTransition(ctx)?.to ?? ctx.stage
}

/** Can this stage replicate, and on what period? Research §12.2. */
export function replicates(stage: LifeStage, inVacuole: boolean): boolean {
  if (stage === 'tachyzoite') return inVacuole
  if (stage === 'bradyzoite') return true
  if (stage === 'merozoite') return true
  return false
}
