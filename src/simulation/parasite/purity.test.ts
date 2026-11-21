import { describe, expect, it } from 'vitest'
import { advanceClocks } from './stages'
import {
  createWorld,
  DEFAULT_CONFIG,
  enterFelidGut,
  ingestOocysts,
  seedEnvironment,
  shedToEnvironment,
  stepWorld,
  type ParasiteConfig,
  type ParasiteWorld,
} from './world'
import { DEFAULT_MODIFIERS } from './modifiers'

/**
 * The world is a value: `stepWorld(w, cfg, clocks)` and the passage functions
 * must return a new world and leave `w` exactly as it was. That is what makes
 * replays, undo and the golden test trustworthy, and what the issue's
 * "same input gives same output" acceptance criterion means.
 *
 * The RNG is the easy thing to get wrong: `nextFloat` advances its `Rng` in
 * place, so a step that draws from `world.rng` directly changes the *input*.
 */

const cfg = (over: Partial<ParasiteConfig> = {}): ParasiteConfig => ({
  ...DEFAULT_CONFIG,
  ...over,
  modifiers: { ...DEFAULT_MODIFIERS, ...(over.modifiers ?? {}) },
  effectors: { ...DEFAULT_CONFIG.effectors, ...(over.effectors ?? {}) },
  stress: { ...DEFAULT_CONFIG.stress, ...(over.stress ?? {}) },
})

const CLOCKS = advanceClocks(1 / 60, 0.5)

function run(world: ParasiteWorld, config: ParasiteConfig, hours: number): ParasiteWorld {
  let w = world
  const steps = Math.ceil(hours / CLOCKS.lesion)
  for (let i = 0; i < steps; i++) w = stepWorld(w, config, CLOCKS)
  return w
}

/** Recursively freezes `o`; any later in-place write throws in strict mode. */
function deepFreeze<T>(o: T): T {
  if (o !== null && typeof o === 'object' && !Object.isFrozen(o)) {
    Object.freeze(o)
    for (const v of Object.values(o)) deepFreeze(v)
  }
  return o
}

/** A structural copy, so "unchanged" can be asserted without trusting freeze. */
const snapshot = (w: ParasiteWorld): ParasiteWorld => structuredClone(w)

const STRESSED = cfg({ stress: { alkaline: 1, starvation: 0.5, heatShock: 0 } })

describe('purity: stepWorld', () => {
  // Each scenario is built mid-run so the step has agents, vacuoles, cysts or
  // oocysts to work on, not just an empty world.
  const scenarios: Array<[string, () => { world: ParasiteWorld; config: ParasiteConfig }]> = [
    ['an early infection (agents invading)', () => ({ world: run(createWorld(DEFAULT_CONFIG, 42), DEFAULT_CONFIG, 6), config: DEFAULT_CONFIG })],
    ['a lytic infection with vacuoles', () => ({ world: run(createWorld(DEFAULT_CONFIG, 42), DEFAULT_CONFIG, 60), config: DEFAULT_CONFIG })],
    ['a latent infection with cysts', () => ({ world: run(createWorld(STRESSED, 42), STRESSED, 700), config: STRESSED })],
    [
      'oocysts in soil',
      () => {
        const c = cfg({ temperature: 20, moisture: 0.8 })
        return { world: run(seedEnvironment(createWorld(c, 5), 20), c, 30), config: c }
      },
    ],
  ]

  for (const [name, make] of scenarios) {
    it(`does not mutate its input: ${name}`, () => {
      const { world, config } = make()
      const before = snapshot(world)
      // a deep-frozen input makes any in-place write throw, pointing at the culprit
      expect(() => stepWorld(deepFreeze(world), config, CLOCKS)).not.toThrow()
      expect(world).toEqual(before)
    })

    it(`returns the same output for the same input, every time: ${name}`, () => {
      const { world, config } = make()
      const a = stepWorld(world, config, CLOCKS)
      const b = stepWorld(world, config, CLOCKS)
      expect(b).toEqual(a)
      // and again after the first call, in case state leaked through the input
      expect(stepWorld(world, config, CLOCKS)).toEqual(a)
    })

    it(`does not share its RNG with the world it came from: ${name}`, () => {
      const { world, config } = make()
      const next = stepWorld(world, config, CLOCKS)
      expect(next.rng).not.toBe(world.rng)
    })
  }

  it('steps a world made by the same seed identically, however it was reached', () => {
    // two independent builds of the same world must agree, and chaining steps
    // must equal one run: no hidden state outside the world value
    const a = run(createWorld(DEFAULT_CONFIG, 7), DEFAULT_CONFIG, 40)
    const b = run(createWorld(DEFAULT_CONFIG, 7), DEFAULT_CONFIG, 40)
    expect(b).toEqual(a)
  })
})

describe('purity: passages between compartments', () => {
  const latent = () => run(createWorld(STRESSED, 42), STRESSED, 700)

  it('enterFelidGut leaves its input world untouched', () => {
    const w = latent()
    expect(w.cysts.some((c) => c.intact)).toBe(true)
    const before = snapshot(w)
    const a = enterFelidGut(deepFreeze(w), STRESSED)
    expect(w).toEqual(before)
    expect(a.rng).not.toBe(w.rng)
    expect(enterFelidGut(w, STRESSED)).toEqual(a)
  })

  it('seedEnvironment leaves its input world untouched', () => {
    const w = createWorld(DEFAULT_CONFIG, 3)
    const before = snapshot(w)
    const a = seedEnvironment(deepFreeze(w), 12)
    expect(w).toEqual(before)
    expect(a.rng).not.toBe(w.rng)
    expect(seedEnvironment(w, 12)).toEqual(a)
  })

  it('shedToEnvironment is repeatable from the same gut world', () => {
    const gut = run(enterFelidGut(latent(), STRESSED), STRESSED, 600)
    expect(gut.oocystsReady).toBeGreaterThan(0)
    const before = snapshot(gut)
    const a = shedToEnvironment(deepFreeze(gut), 12)
    expect(gut).toEqual(before)
    expect(shedToEnvironment(gut, 12)).toEqual(a)
  })

  it('ingestOocysts leaves its input world untouched', () => {
    // cool and moist, as in the sporulation test; oocysts weather on the
    // compressed shelf clock, so check *early* that one is both ripe and alive
    const c = cfg({ temperature: 12, moisture: 0.95 })
    const soil = run(seedEnvironment(createWorld(c, 5), 12), c, 100)
    expect(soil.oocysts.some((o) => o.sporulated && o.viability > 0)).toBe(true)
    const before = snapshot(soil)
    const a = ingestOocysts(deepFreeze(soil), c)
    expect(soil).toEqual(before)
    expect(a.rng).not.toBe(soil.rng)
    expect(ingestOocysts(soil, c)).toEqual(a)
  })
})
