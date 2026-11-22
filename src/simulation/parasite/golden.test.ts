import { describe, expect, it } from 'vitest'
import { activateAbility, ABILITY_IDS, type AbilityId } from './abilities'
import { FIXED_STEP_CLOCKS } from './fixedStep'
import { DEFAULT_MODIFIERS } from './modifiers'
import { evaluateObjective, reservoirCysts, type ObjectiveProgress } from './objectives'
import type { StressLevers } from './hostImmunity'
import {
  createWorld,
  DEFAULT_CONFIG,
  seedEnvironment,
  stepWorld,
  type ParasiteConfig,
  type ParasiteWorld,
} from './world'

/**
 * Golden runs: a fixed seed, a fixed number of fixed steps, and a snapshot of
 * the stage counts. They are the tripwire for *any* change in behaviour: a
 * retuned constant, a reordered rule, an extra or missing random draw. A
 * failure here is not necessarily a bug. It means the sim now plays differently
 * from the run that was recorded, so decide whether that is intended and, if it
 * is, re-record with `npx vitest run -u src/simulation/parasite/golden.test.ts`
 * and say why in the commit.
 *
 * Only integers (and values rounded to three places) are recorded, so a last-bit
 * difference in `Math.exp` between Node versions cannot fail the build. The RNG
 * seed is recorded too: it is a fingerprint of how many random draws the run
 * made and in what order, so it moves if *anything* upstream of a draw changes.
 */

/** 72 sim-hours = 4800 fixed steps of 0.015 lesion hours. */
const STEPS_72H = 4800

const cfg = (over: Partial<ParasiteConfig> = {}): ParasiteConfig => ({
  ...DEFAULT_CONFIG,
  ...over,
  modifiers: { ...DEFAULT_MODIFIERS, ...(over.modifiers ?? {}) },
  effectors: { ...DEFAULT_CONFIG.effectors, ...(over.effectors ?? {}) },
  stress: { ...DEFAULT_CONFIG.stress, ...(over.stress ?? {}) },
})

function run(world: ParasiteWorld, config: ParasiteConfig, steps: number): ParasiteWorld {
  let w = world
  for (let i = 0; i < steps; i++) w = stepWorld(w, config, FIXED_STEP_CLOCKS)
  return w
}

const round3 = (x: number) => Math.round(x * 1000) / 1000

/** Count of items by a key, with keys in a stable order. */
function countBy<T>(items: T[], key: (t: T) => string): Record<string, number> {
  const out: Record<string, number> = {}
  for (const it of items) out[key(it)] = (out[key(it)] ?? 0) + 1
  return Object.fromEntries(Object.entries(out).sort(([a], [b]) => a.localeCompare(b)))
}

/** The stage counts the issue asks for, plus the tallies that explain them. */
function census(w: ParasiteWorld) {
  const inHost = w.compartment !== 'environment'
  return {
    compartment: w.compartment,
    lesionHours: round3(w.lesionHours),
    actionSeconds: round3(w.actionSeconds),
    agentsByStage: countBy(w.agents, (a) => a.stage),
    // a world moved to soil keeps its old host cells; they are not part of the scene
    hostCells: inHost ? countBy(w.cells, (c) => c.state) : {},
    inVacuoles: w.tally.intracellular,
    // an aggregate (parasites past the scene cap), so a fraction: round it
    overflow: round3(w.overflow),
    cysts: w.cysts.length,
    bradyzoitesInCysts: w.tally.bradyzoitesInCysts,
    oocysts: countBy(w.oocysts, (o) => (o.sporulated ? 'sporulated' : 'unsporulated')),
    lyticCycles: w.tally.lyticCycles,
    conversions: w.tally.conversions,
    reactivations: w.tally.reactivations,
    failedInvasions: w.tally.failedInvasions,
    clearances: w.tally.clearances,
    hostHealth: round3(w.host.health),
    rngSeed: w.rng.seed,
  }
}

describe('golden runs (seed 42)', () => {
  it('72 sim-hours in a naive intermediate host', () => {
    const w = run(createWorld(DEFAULT_CONFIG, 42), DEFAULT_CONFIG, STEPS_72H)
    expect(census(w)).toMatchInlineSnapshot(`
      {
        "actionSeconds": 320,
        "agentsByStage": {
          "tachyzoite": 12,
        },
        "bradyzoitesInCysts": 0,
        "clearances": 4,
        "compartment": "intermediateTissue",
        "conversions": 0,
        "cysts": 0,
        "failedInvasions": 9,
        "hostCells": {
          "healthy": 8,
          "invaded": 12,
          "lysed": 4,
        },
        "hostHealth": 0.975,
        "inVacuoles": 17,
        "lesionHours": 72,
        "lyticCycles": 4,
        "oocysts": {},
        "overflow": 0.153,
        "reactivations": 0,
        "rngSeed": 2258046621,
      }
    `)
  })

  it('72 sim-hours of oocysts in cool, moist soil', () => {
    const c = cfg({ temperature: 12, moisture: 0.95 })
    const w = run(seedEnvironment(createWorld(c, 42), 20), c, STEPS_72H)
    expect(census(w)).toMatchInlineSnapshot(`
      {
        "actionSeconds": 320,
        "agentsByStage": {},
        "bradyzoitesInCysts": 0,
        "clearances": 0,
        "compartment": "environment",
        "conversions": 0,
        "cysts": 0,
        "failedInvasions": 0,
        "hostCells": {},
        "hostHealth": 1,
        "inVacuoles": 0,
        "lesionHours": 72,
        "lyticCycles": 0,
        "oocysts": {
          "sporulated": 6,
          "unsporulated": 14,
        },
        "overflow": 0,
        "reactivations": 0,
        "rngSeed": 3256755586,
      }
    `)
  })

  it('700 sim-hours under player stress: the BFD1 latency lock', () => {
    // The end state saturates (every cyst reaches the 1024 cap), so on its own
    // it would not notice a change to the latch kinetics. Record *when* the
    // switch commits and how the cysts fill, not just where they end up.
    const c = cfg({ stress: { alkaline: 1, starvation: 0.6, heatShock: 0 } })
    const checkpoints = [6, 12, 18, 24, 36, 72, 150, 300].map((h) => Math.round(h / FIXED_STEP_CLOCKS.lesion))
    const total = Math.round(700 / FIXED_STEP_CLOCKS.lesion)
    let w = createWorld(c, 42)
    let firstConversionHour: number | null = null
    const trace: string[] = []
    for (let i = 1; i <= total; i++) {
      w = stepWorld(w, c, FIXED_STEP_CLOCKS)
      if (firstConversionHour === null && w.tally.conversions > 0) firstConversionHour = round3(w.lesionHours)
      if (checkpoints.includes(i)) {
        trace.push(
          `h=${Math.round(w.lesionHours)} conversions=${w.tally.conversions} cysts=${w.cysts.length} ` +
            `bradyzoites=${Math.round(w.tally.bradyzoitesInCysts)} mature=${w.tally.matureCysts}`,
        )
      }
    }
    expect({ firstConversionHour, trace, final: census(w) }).toMatchInlineSnapshot(`
      {
        "final": {
          "actionSeconds": 3111.133,
          "agentsByStage": {},
          "bradyzoitesInCysts": 4096,
          "clearances": 0,
          "compartment": "intermediateTissue",
          "conversions": 4,
          "cysts": 4,
          "failedInvasions": 0,
          "hostCells": {
            "healthy": 24,
          },
          "hostHealth": 1,
          "inVacuoles": 0,
          "lesionHours": 700.005,
          "lyticCycles": 0,
          "oocysts": {},
          "overflow": 0,
          "reactivations": 0,
          "rngSeed": 3520096674,
        },
        "firstConversionHour": 12.54,
        "trace": [
          "h=6 conversions=0 cysts=0 bradyzoites=0 mature=0",
          "h=12 conversions=0 cysts=0 bradyzoites=0 mature=0",
          "h=18 conversions=1 cysts=0 bradyzoites=0 mature=0",
          "h=24 conversions=4 cysts=0 bradyzoites=0 mature=0",
          "h=36 conversions=4 cysts=1 bradyzoites=2 mature=0",
          "h=72 conversions=4 cysts=4 bradyzoites=12 mature=0",
          "h=150 conversions=4 cysts=4 bradyzoites=52 mature=0",
          "h=300 conversions=4 cysts=4 bradyzoites=884 mature=0",
        ],
      }
    `)
  })

  it('replays identically: the same seed and steps give the same census twice', () => {
    const a = census(run(createWorld(DEFAULT_CONFIG, 42), DEFAULT_CONFIG, STEPS_72H))
    const b = census(run(createWorld(DEFAULT_CONFIG, 42), DEFAULT_CONFIG, STEPS_72H))
    expect(b).toEqual(a)
  })

  it('a different seed plays a different run', () => {
    const a = census(run(createWorld(DEFAULT_CONFIG, 42), DEFAULT_CONFIG, STEPS_72H))
    const b = census(run(createWorld(DEFAULT_CONFIG, 43), DEFAULT_CONFIG, STEPS_72H))
    expect(b.rngSeed).not.toBe(a.rngSeed)
  })
})

// ---------------------------------------------------------------------------
// Scripted game runs (epic #3, issue #5/#7)
// ---------------------------------------------------------------------------

/**
 * A scripted player. `stressAt` is the lesion hour at which the player pushes
 * the stress levers; `rotate` is the set of abilities fired greedily, in order,
 * the moment each comes off cooldown — the simplest competent play pattern, and
 * the one a new player converges on.
 *
 * These are the acceptance tests for the objective being *winnable and losable
 * both ways*: the same seed and the same world, three decisions, three
 * different endings. If a retune moves them, the mode now plays differently,
 * which is exactly what a golden test is for.
 */
interface Play {
  stressAt?: number
  stress?: StressLevers
  rotate?: AbilityId[]
  /** Hold the abilities until this lesion hour. */
  from?: number
}

const PUSH: StressLevers = { alkaline: 0.8, starvation: 0.3, heatShock: 0 }

function playOut(play: Play, seed = 42, maxDays = 40) {
  let config: ParasiteConfig = cfg()
  let w = createWorld(config, seed)
  let progress: ObjectiveProgress = evaluateObjective('latentPassage', w, config)
  const steps = Math.round((maxDays * 24) / FIXED_STEP_CLOCKS.lesion)

  for (let i = 0; i < steps && progress.status === 'active'; i++) {
    if (play.stressAt !== undefined && Math.abs(w.lesionHours - play.stressAt) < FIXED_STEP_CLOCKS.lesion / 2) {
      config = { ...config, stress: play.stress ?? PUSH }
    }
    if (play.rotate && w.lesionHours >= (play.from ?? 0)) {
      for (const id of play.rotate) {
        const next = activateAbility(w.abilities, id, config.effectors, w.tally.conversions)
        if (next !== w.abilities) w = { ...w, abilities: next }
      }
    }
    w = stepWorld(w, config, FIXED_STEP_CLOCKS)
    progress = evaluateObjective('latentPassage', w, config)
  }

  return {
    status: progress.status,
    reason: progress.reason,
    day: round3(w.lesionHours / 24),
    reservoirCysts: reservoirCysts(w, config.tuning),
    cysts: w.cysts.filter((c) => c.intact).length,
    hostHealth: round3(w.host.health),
    conversions: w.tally.conversions,
    clearances: w.tally.clearances,
    cellsLysed: Math.round(w.tally.cellsLysed),
    abilityUses: Object.fromEntries(ABILITY_IDS.map((id) => [id, w.abilities[id].uses])),
    rngSeed: w.rng.seed,
  }
}

describe('scripted game runs (seed 42)', () => {
  it('wins: secrete the effectors, then push stress once there is something to encyst', () => {
    const out = playOut({ stressAt: 48, rotate: ABILITY_IDS })
    expect(out.status).toBe('won')
    expect(out).toMatchInlineSnapshot(`
      {
        "abilityUses": {
          "rop16": 14,
          "rop18rop5": 23,
          "tgist": 7,
        },
        "cellsLysed": 1,
        "clearances": 0,
        "conversions": 10,
        "cysts": 10,
        "day": 30.001,
        "hostHealth": 1,
        "reason": "Latency established. The host will carry these cysts for life.",
        "reservoirCysts": 9,
        "rngSeed": 3491551511,
        "status": "won",
      }
    `)
  })

  it('loses by killing the host: effectors but no stress, so nothing ever encysts', () => {
    const out = playOut({ rotate: ABILITY_IDS })
    expect(out.status).toBe('lost')
    expect(out.reason).toMatch(/host/i)
    expect(out.reservoirCysts).toBe(0)
    expect(out).toMatchInlineSnapshot(`
      {
        "abilityUses": {
          "rop16": 12,
          "rop18rop5": 20,
          "tgist": 5,
        },
        "cellsLysed": 78,
        "clearances": 231,
        "conversions": 5,
        "cysts": 0,
        "day": 26.321,
        "hostHealth": 0.2,
        "reason": "Host health collapsed below the floor — acute disease, not latency.",
        "reservoirCysts": 0,
        "rngSeed": 468482689,
        "status": "lost",
      }
    `)
  })

  it('loses by being cleared: no effectors, no stress, the host wins the acute phase', () => {
    const out = playOut({})
    expect(out.status).toBe('lost')
    expect(out).toMatchInlineSnapshot(`
      {
        "abilityUses": {
          "rop16": 0,
          "rop18rop5": 0,
          "tgist": 0,
        },
        "cellsLysed": 10,
        "clearances": 27,
        "conversions": 6,
        "cysts": 6,
        "day": 30.001,
        "hostHealth": 1,
        "reason": "Day 30 with 5 of 8 reservoir cysts — the window for a chronic infection closed.",
        "reservoirCysts": 5,
        "rngSeed": 2557162297,
        "status": "lost",
      }
    `)
  })

  it('loses on a late push: the vacuoles are already stripped by the time stress arrives', () => {
    const out = playOut({ stressAt: 120, rotate: ABILITY_IDS })
    expect(out.status).toBe('lost')
    expect(out).toMatchInlineSnapshot(`
      {
        "abilityUses": {
          "rop16": 14,
          "rop18rop5": 23,
          "tgist": 6,
        },
        "cellsLysed": 15,
        "clearances": 44,
        "conversions": 13,
        "cysts": 5,
        "day": 30.001,
        "hostHealth": 1,
        "reason": "Day 30 with 5 of 8 reservoir cysts — the window for a chronic infection closed.",
        "reservoirCysts": 5,
        "rngSeed": 858878891,
        "status": "lost",
      }
    `)
  })
})
