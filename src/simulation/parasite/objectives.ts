/**
 * Objectives — the sim-game layer.
 *
 * Research §12.7 lists eight objective seeds; five are implemented here. Each
 * is a pure predicate over `ParasiteWorld`, so the store just evaluates them
 * once per tick and the UI renders the result.
 *
 * The locked v0 objective is `latentPassage` ("encyst without killing the
 * host"), per the C0 design decision in `docs/design/parasite-mode.md`.
 */

import { clamp01 } from './math'
import type { Modifiers } from './modifiers'
import type { Compartment } from './stages'
import { MATURE_CYST_BRADYZOITES, type ParasiteConfig, type ParasiteWorld } from './world'

export type ObjectiveId =
  | 'latentPassage'
  | 'amygdalaGarden'
  | 'completeCycle'
  | 'oocystWinter'
  | 'runaway'

export type ObjectiveStatus = 'active' | 'won' | 'lost'

export interface ObjectiveProgress {
  status: ObjectiveStatus
  /** 0–1 toward the win condition. */
  progress: number
  /** Headline readout, e.g. "5 / 8 mature cysts". */
  metric: string
  /** Supporting readouts for the panel. */
  detail: string[]
  /** Why it was won or lost. */
  reason?: string
}

export interface ObjectiveDef {
  id: ObjectiveId
  name: string
  /** One-line framing. */
  brief: string
  /** What the player actually does. */
  how: string
  /** Where the run should start. */
  startCompartment: Compartment
  /** Modifiers this scenario forces on. */
  modifiers?: Partial<Modifiers>
  /** Pure evaluation against world state. */
  evaluate: (world: ParasiteWorld, cfg: ParasiteConfig) => ObjectiveProgress
}

/** Mature cysts needed for the primary objective. */
export const LATENT_TARGET = 8
/** Amygdala cysts needed for the tropism objective. */
export const AMYGDALA_TARGET = 5
/**
 * Shelf-life days a sporulated oocyst must endure. Scored on the oocyst's own
 * weathering clock (research puts the ceiling at ~18 months in moist soil), not
 * on the lesion clock.
 */
export const WINTER_TARGET_DAYS = 365
/** Lytic cycles that count as "the host never got on top of it". */
export const RUNAWAY_TARGET = 30
/** Host health below which the primary objective is considered failed. */
export const HOST_FLOOR = 0.2

const pct = (x: number) => `${Math.round(clamp01(x) * 100)}%`

export const OBJECTIVES: Record<ObjectiveId, ObjectiveDef> = {
  latentPassage: {
    id: 'latentPassage',
    name: 'Quiet tenant',
    brief: 'Establish lasting latency without killing the host that carries you.',
    how: `Invade, replicate, then push stress (alkaline pH, NO) high enough to open BFD1 translation. Bank ${LATENT_TARGET} mature cysts while the host stays above ${Math.round(HOST_FLOOR * 100)}% health.`,
    startCompartment: 'intermediateTissue',
    evaluate: (world) => {
      const mature = world.tally.matureCysts
      const progress = clamp01(mature / LATENT_TARGET)
      const detail = [
        `Host health ${pct(world.host.health)}`,
        `${world.tally.cysts} cyst${world.tally.cysts === 1 ? '' : 's'}, ${world.tally.bradyzoitesInCysts} bradyzoites`,
        `${world.tally.cellsLysed} host cells lysed`,
      ]
      if (world.host.health <= 0) {
        return { status: 'lost', progress, metric: `${mature} / ${LATENT_TARGET} mature cysts`, detail, reason: 'The host died. A dead host transmits nothing.' }
      }
      if (mature >= LATENT_TARGET && world.host.health > HOST_FLOOR) {
        return { status: 'won', progress: 1, metric: `${mature} / ${LATENT_TARGET} mature cysts`, detail, reason: 'Latency established. The host will carry these cysts for life.' }
      }
      if (world.host.health <= HOST_FLOOR) {
        return { status: 'lost', progress, metric: `${mature} / ${LATENT_TARGET} mature cysts`, detail, reason: 'Host health collapsed below the floor — acute disease, not latency.' }
      }
      return { status: 'active', progress, metric: `${mature} / ${LATENT_TARGET} mature cysts`, detail }
    },
  },

  amygdalaGarden: {
    id: 'amygdalaGarden',
    name: 'Amygdala garden',
    brief: 'Concentrate latency in the reported medial/basolateral amygdala niche.',
    how: `Set the niche focus to the amygdala and convert there. ${AMYGDALA_TARGET} intact cysts in that niche wins.`,
    startCompartment: 'intermediateTissue',
    evaluate: (world) => {
      const amy = world.tally.cystsByNiche.cnsAmygdala
      const progress = clamp01(amy / AMYGDALA_TARGET)
      const detail = [
        `Cortex ${world.tally.cystsByNiche.cnsCortex} · retina ${world.tally.cystsByNiche.retina}`,
        `Muscle ${world.tally.cystsByNiche.skeletalMuscle + world.tally.cystsByNiche.cardiacMuscle}`,
        `Host health ${pct(world.host.health)}`,
      ]
      if (world.host.health <= 0) {
        return { status: 'lost', progress, metric: `${amy} / ${AMYGDALA_TARGET} amygdala cysts`, detail, reason: 'Host died before the niche filled.' }
      }
      if (amy >= AMYGDALA_TARGET) {
        return { status: 'won', progress: 1, metric: `${amy} / ${AMYGDALA_TARGET} amygdala cysts`, detail, reason: 'The privileged niche is occupied.' }
      }
      return { status: 'active', progress, metric: `${amy} / ${AMYGDALA_TARGET} amygdala cysts`, detail }
    },
  },

  completeCycle: {
    id: 'completeCycle',
    name: 'Close the loop',
    brief: 'Run the whole facultatively heteroxenous cycle: tissue → felid → soil → new host.',
    how: 'Encyst, get eaten by a cat, shed oocysts, let them sporulate, then infect a new intermediate host.',
    startCompartment: 'intermediateTissue',
    evaluate: (world) => {
      const shed = world.tally.oocystsShed > 0
      const sporulated = world.tally.sporulatedOocysts > 0
      const reinfected = shed && world.compartment === 'intermediateTissue' && world.tally.cysts > 0
      const stages = [world.tally.cysts > 0 || shed, shed, sporulated, reinfected]
      const progress = stages.filter(Boolean).length / stages.length
      const detail = [
        `Cyst in tissue ${stages[0] ? '✓' : '·'}`,
        `Felid passage + shed ${stages[1] ? '✓' : '·'}`,
        `Sporulated in soil ${stages[2] ? '✓' : '·'}`,
        `New host infected ${stages[3] ? '✓' : '·'}`,
      ]
      if (reinfected) {
        return { status: 'won', progress: 1, metric: 'Cycle closed', detail, reason: 'A full facultatively heteroxenous circuit, with a cyst in the second host.' }
      }
      if (world.host.health <= 0 && !shed) {
        return { status: 'lost', progress, metric: 'Cycle broken', detail, reason: 'The host died before any cyst could reach a cat.' }
      }
      return { status: 'active', progress, metric: `${stages.filter(Boolean).length} / 4 legs`, detail }
    },
  },

  oocystWinter: {
    id: 'oocystWinter',
    name: 'Oocyst winter',
    brief: 'Survive in soil as a sporulated oocyst, with no host and no metabolism to speak of.',
    how: `Keep at least one viable sporulated oocyst for ${WINTER_TARGET_DAYS} simulation days. Cool and moist soil ages you slowest.`,
    startCompartment: 'environment',
    evaluate: (world) => {
      const viable = world.oocysts.filter((o) => o.sporulated && o.viability > 0)
      const best = viable.reduce((m, o) => Math.max(m, o.viability), 0)
      // the oldest surviving oocyst is what the objective scores
      const days = viable.reduce((m, o) => Math.max(m, o.shelfHours), 0) / 24
      const progress = clamp01(days / WINTER_TARGET_DAYS)
      const detail = [
        `${viable.length} sporulated, ${world.oocysts.length - viable.length} still maturing`,
        viable.length > 0 ? `Best viability ${pct(best)}` : 'Sporulation takes 1–5 days',
        `${days.toFixed(0)} / ${WINTER_TARGET_DAYS} shelf days`,
      ]
      if (days >= WINTER_TARGET_DAYS && viable.length > 0) {
        return { status: 'won', progress: 1, metric: `${days.toFixed(0)} days endured`, detail, reason: 'Still infectious after a season in the soil.' }
      }
      if (world.oocysts.length === 0) {
        return { status: 'lost', progress, metric: 'All oocysts dead', detail, reason: 'Heat and desiccation finished the whole cohort.' }
      }
      return { status: 'active', progress, metric: `${days.toFixed(0)} / ${WINTER_TARGET_DAYS} days`, detail }
    },
  },

  runaway: {
    id: 'runaway',
    name: 'ΔBFD1 — runaway',
    brief: 'No switch, no cysts, no latency. Only the lytic cycle, until the host gives out.',
    how: `Without BFD1 there is nowhere to hide. Complete ${RUNAWAY_TARGET} lytic cycles before the host dies.`,
    startCompartment: 'intermediateTissue',
    modifiers: { deltaBfd1: true },
    evaluate: (world) => {
      const cycles = world.tally.lyticCycles
      const progress = clamp01(cycles / RUNAWAY_TARGET)
      const detail = [
        `Host health ${pct(world.host.health)}`,
        `Peak load ${world.tally.peakLoad} parasites`,
        `${world.tally.clearances} vacuoles cleared by IRG`,
      ]
      if (cycles >= RUNAWAY_TARGET) {
        return { status: 'won', progress: 1, metric: `${cycles} / ${RUNAWAY_TARGET} lytic cycles`, detail, reason: 'Pure acute proliferation outran the host response.' }
      }
      if (world.host.health <= 0) {
        return { status: 'lost', progress, metric: `${cycles} / ${RUNAWAY_TARGET} lytic cycles`, detail, reason: 'Host died first — exactly the ΔBFD1 phenotype.' }
      }
      return { status: 'active', progress, metric: `${cycles} / ${RUNAWAY_TARGET} lytic cycles`, detail }
    },
  },
}

export const OBJECTIVE_IDS: ObjectiveId[] = [
  'latentPassage',
  'amygdalaGarden',
  'completeCycle',
  'oocystWinter',
  'runaway',
]

/** The objective locked for v0 (C0 decision). */
export const DEFAULT_OBJECTIVE: ObjectiveId = 'latentPassage'

export function evaluateObjective(
  id: ObjectiveId,
  world: ParasiteWorld,
  cfg: ParasiteConfig,
): ObjectiveProgress {
  return OBJECTIVES[id].evaluate(world, cfg)
}

/** Does this objective make the ΔBFD1 win condition unreachable? */
export function objectiveBlocked(id: ObjectiveId, mods: Modifiers): string | null {
  if (mods.deltaBfd1 && (id === 'latentPassage' || id === 'amygdalaGarden')) {
    return 'ΔBFD1 removes the switch this objective depends on — no cyst can form.'
  }
  if (mods.deltaBfd1 && id === 'completeCycle') {
    return 'ΔBFD1 cannot encyst, so nothing survives to reach a cat.'
  }
  return null
}

export { MATURE_CYST_BRADYZOITES }
