import { describe, expect, it } from 'vitest'
import {
  advanceClock,
  advancePlant,
  clampFrame,
  createSeedling,
  FIXED_STEP_SECONDS,
  MAX_FRAME_SECONDS,
  stepPlant,
  type ClockInput,
  type PlantSnapshot,
} from './clock'
import { createCrystalState } from './CrystalGrowth'
import { GEMSTONE_PRESETS } from './GemstonePresets'
import { MIN_ITERATIONS } from './LSystemMorph'

const WET = { temperature: 22, light: 1, precipitation: 5, humidity: 0.6, wind: 0 }

function seedlingSnapshot(): PlantSnapshot {
  return {
    species: 'sunflower',
    soilProfile: 'loam',
    gemstone: 'quartz',
    geology: { ...GEMSTONE_PRESETS.quartz.defaults },
    weather: WET,
    ...createSeedling('sunflower', 'loam'),
    crystal: createCrystalState('quartz', GEMSTONE_PRESETS.quartz.defaults),
  }
}

const play = (dt: number, speed = 1): ClockInput => ({ dt, speed, playing: true })

/** Run `frames` frames of `dt` real seconds; returns the final snapshot, accumulator and total steps. */
function run(frames: number, dt: number, speed = 1, from = seedlingSnapshot()) {
  let state = from
  let accumulator = 0
  let steps = 0
  for (let i = 0; i < frames; i++) {
    const r = advancePlant(state, accumulator, play(dt, speed))
    state = r.state
    accumulator = r.accumulator
    steps += r.steps
  }
  return { state, accumulator, steps }
}

/** The numbers a frame-rate change must not move. */
const summary = (s: PlantSnapshot) => ({
  time: s.time,
  age: s.age,
  height: s.height,
  biomass: s.biomass,
  water: s.waterStatus,
  nutrient: s.nutrientStatus,
  progress: s.lsystemProgress,
  soilT: s.soil.t,
})

describe('clampFrame', () => {
  it('passes ordinary frames through and cuts long ones', () => {
    expect(clampFrame(1 / 60)).toBe(1 / 60)
    expect(clampFrame(0.1)).toBe(0.1)
    expect(clampFrame(2)).toBe(MAX_FRAME_SECONDS)
    expect(clampFrame(5)).toBe(MAX_FRAME_SECONDS)
  })
  it('turns garbage into 0 rather than NaN growth', () => {
    for (const bad of [NaN, -1, -Infinity, 0]) expect(clampFrame(bad)).toBe(0)
    expect(clampFrame(Infinity)).toBe(0)
  })
})

describe('hitches cannot jump the plant', () => {
  it('a 2.0 s frame advances no more than the clamp allows', () => {
    const r = advancePlant(seedlingSnapshot(), 0, play(2.0))
    expect(r.state.age).toBeLessThanOrEqual(MAX_FRAME_SECONDS + 1e-9) // speed 1 day/s
    expect(r.steps).toBe(Math.round(MAX_FRAME_SECONDS / FIXED_STEP_SECONDS))
    // and it is exactly what a normal clamp-length frame does
    const normal = advancePlant(seedlingSnapshot(), 0, play(MAX_FRAME_SECONDS))
    expect(summary(r.state)).toEqual(summary(normal.state))
  })

  it('a synthetic 5 s frame cannot apply 5 s of growth, at any speed', () => {
    for (const speed of [0.5, 1, 3]) {
      const r = advancePlant(seedlingSnapshot(), 0, play(5, speed))
      expect(r.state.age).toBeLessThanOrEqual(MAX_FRAME_SECONDS * speed + 1e-9)
      expect(r.state.age).toBeLessThan(0.5)
    }
  })

  it('the dropped excess is not queued: the frame after a hitch is an ordinary one', () => {
    const hitch = advancePlant(seedlingSnapshot(), 0, play(5))
    const next = advancePlant(hitch.state, hitch.accumulator, play(1 / 60))
    expect(next.steps).toBeLessThanOrEqual(1)
    expect(next.state.age - hitch.state.age).toBeLessThanOrEqual(FIXED_STEP_SECONDS + 1e-9)
  })

  it('NaN / negative / infinite frames do nothing', () => {
    for (const dt of [NaN, -3, Infinity]) {
      const s = seedlingSnapshot()
      const r = advancePlant(s, 0, play(dt))
      expect(r.steps).toBe(0)
      expect(r.state).toBe(s)
      expect(r.accumulator).toBe(0)
    }
  })
})

describe('fixed step + accumulator', () => {
  it('a frame shorter than a step runs nothing but is remembered', () => {
    const s = seedlingSnapshot()
    const a = advancePlant(s, 0, play(FIXED_STEP_SECONDS * 0.4))
    expect(a.steps).toBe(0)
    expect(a.state).toBe(s) // identical object → the store can skip a write
    expect(a.accumulator).toBeCloseTo(0.4, 12)
    const b = advancePlant(a.state, a.accumulator, play(FIXED_STEP_SECONDS * 0.7))
    expect(b.steps).toBe(1) // 1.1 steps owed
    expect(b.accumulator).toBeCloseTo(0.1, 9)
  })

  it('leftover time carries forward: 1/120 s frames run one step per four frames', () => {
    const { steps, accumulator } = run(4 * 25, 1 / 120)
    expect(steps).toBe(25)
    expect(accumulator).toBeLessThan(1e-6)
  })

  it('one step is FIXED_STEP_SECONDS × speed days', () => {
    for (const speed of [0.5, 1, 2.5]) {
      const r = advancePlant(seedlingSnapshot(), 0, play(FIXED_STEP_SECONDS, speed))
      expect(r.steps).toBe(1)
      expect(r.state.time).toBeCloseTo(FIXED_STEP_SECONDS * speed, 12)
    }
  })

  it('float error cannot swallow a step: 0.1 s is exactly 3 steps', () => {
    expect(advancePlant(seedlingSnapshot(), 0, play(0.1)).steps).toBe(3)
  })
})

describe('frame-rate independence', () => {
  it('60 frames of 1/60 s = 30 frames of 1/30 s = 10 frames of 0.1 s (one second of play)', () => {
    const a = run(60, 1 / 60)
    const b = run(30, 1 / 30)
    const c = run(10, 0.1)
    expect(a.steps).toBe(30)
    expect(b.steps).toBe(30)
    expect(c.steps).toBe(30)
    for (const other of [b, c]) {
      const sa = summary(a.state)
      const so = summary(other.state)
      for (const k of Object.keys(sa) as (keyof typeof sa)[]) expect(so[k]).toBeCloseTo(sa[k], 9)
    }
    expect(a.state.age).toBeCloseTo(1, 9)
  })

  it('one second of 1/60 s frames sits on the converged answer; one coarse 1-day step does not', () => {
    // The model is explicit-Euler (rate read at the start of a step, water lags a day), so a
    // 1-day step is *not* the same plant as 30 steps of 1/30 day: it overshoots by ~6 % of
    // the day's development. The fixed step is the better answer, and this pins both facts.
    const fine = run(60, 1 / 60).state
    let reference = seedlingSnapshot()
    for (let i = 0; i < 600; i++) reference = stepPlant(reference, 1 / 600)
    const coarse = stepPlant(seedlingSnapshot(), 1)

    expect(fine.age).toBeCloseTo(coarse.age, 9) // time itself is exact
    // measured ≈ 5e-4 on progress (of ≈ 0.3 developed), 1e-4 on biomass; the coarse step is ≈ 1.8e-2
    expect(Math.abs(fine.lsystemProgress - reference.lsystemProgress)).toBeLessThan(1e-3)
    expect(Math.abs(fine.biomass - reference.biomass)).toBeLessThan(5e-4)
    expect(Math.abs(fine.height - reference.height)).toBeLessThan(5e-4)

    const err = (x: PlantSnapshot) => Math.abs(x.lsystemProgress - reference.lsystemProgress)
    expect(err(fine)).toBeLessThan(err(coarse) / 10)
  })

  it('a ragged real frame sequence still lands on the same plant as a smooth one', () => {
    // 3 s of play cut into irregular frames, never longer than the clamp
    const cuts = [0.016, 0.033, 0.1, 0.007, 0.05, 0.09, 0.02, 0.1, 0.1, 0.004]
    let state = seedlingSnapshot()
    let acc = 0
    let total = 0
    for (let rep = 0; total < 3 - 1e-9; rep++) {
      const dt = Math.min(cuts[rep % cuts.length], 3 - total)
      const r = advancePlant(state, acc, play(dt))
      state = r.state
      acc = r.accumulator
      total += dt
    }
    const smooth = run(30, 0.1).state
    // the ragged run has at most one fixed step still owed
    expect(Math.abs(state.age - smooth.age)).toBeLessThanOrEqual(FIXED_STEP_SECONDS + 1e-9)
  })
})

describe('pause', () => {
  it('advances nothing, accumulates nothing, and hands back the same snapshot', () => {
    const s = seedlingSnapshot()
    const r = advancePlant(s, 0.37, { dt: 0.1, speed: 1, playing: false })
    expect(r.steps).toBe(0)
    expect(r.state).toBe(s)
    expect(r.accumulator).toBe(0.37)
  })

  it('does not bank paused time: resuming does not release a burst of steps', () => {
    let state = seedlingSnapshot()
    let acc = 0
    for (let i = 0; i < 600; i++) {
      const r = advancePlant(state, acc, { dt: 0.1, speed: 1, playing: false })
      state = r.state
      acc = r.accumulator
    }
    expect(state.age).toBe(0)
    const resumed = advancePlant(state, acc, play(1 / 60))
    expect(resumed.steps).toBeLessThanOrEqual(1)
  })

  it('zero (or bad) speed advances nothing', () => {
    for (const speed of [0, -1, NaN]) {
      const s = seedlingSnapshot()
      expect(advancePlant(s, 0, play(0.1, speed)).state).toBe(s)
    }
  })
})

describe('reset state', () => {
  it('createSeedling is the documented seedling', () => {
    const f = createSeedling('oak', 'volcanic')
    expect(f).toMatchObject({
      time: 0,
      age: 0,
      height: 0.15,
      biomass: 0.1,
      waterStatus: 0.85,
      nutrientStatus: 1,
      growthRate: 0,
      lsystemProgress: MIN_ITERATIONS,
      lsystemIterations: MIN_ITERATIONS,
    })
    expect(f.soil.t).toBe(0)
  })

  it('a grown plant and a fresh seedling differ; stepping from the seedling reproduces the first run', () => {
    const grown = run(300, 1 / 30, 1).state
    expect(grown.age).toBeGreaterThan(5)
    const again = run(300, 1 / 30, 1, { ...seedlingSnapshot(), ...createSeedling('sunflower', 'loam') }).state
    expect(summary(again)).toEqual(summary(grown)) // deterministic from the seedling
  })
})

describe('purity', () => {
  const freeze = <T,>(o: T): T => {
    if (o && typeof o === 'object' && !Object.isFrozen(o)) {
      Object.freeze(o)
      for (const v of Object.values(o as object)) freeze(v)
    }
    return o
  }

  it('never mutates the snapshot it is given', () => {
    const s = freeze(seedlingSnapshot())
    expect(() => advancePlant(s, 0.3, play(0.1))).not.toThrow()
    expect(s.age).toBe(0)
  })
})

describe('the stepper shape is generic (gem / parasite can reuse it)', () => {
  it('advanceClock steps any (state, days) => state', () => {
    const r = advanceClock(0, (n, days) => n + days, 0, play(0.1, 2))
    expect(r.steps).toBe(3)
    expect(r.state).toBeCloseTo(0.2, 12) // 0.1 s × 2 days/s
  })
})
