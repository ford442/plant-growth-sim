import { describe, expect, it } from 'vitest'
import { FIXED_STEP_CLOCKS } from './fixedStep'
import { DEFAULT_MODIFIERS } from './modifiers'
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
          "tachyzoite": 56,
        },
        "bradyzoitesInCysts": 0,
        "clearances": 0,
        "compartment": "intermediateTissue",
        "conversions": 0,
        "cysts": 0,
        "failedInvasions": 5,
        "hostCells": {
          "healthy": 6,
          "invaded": 14,
          "lysed": 4,
        },
        "hostHealth": 0.969,
        "inVacuoles": 24,
        "lesionHours": 72,
        "lyticCycles": 4,
        "oocysts": {},
        "overflow": 48.797,
        "reactivations": 0,
        "rngSeed": 616405612,
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
