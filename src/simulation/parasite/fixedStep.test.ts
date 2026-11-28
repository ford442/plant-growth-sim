import { describe, expect, it } from 'vitest'
import {
  advanceFixed,
  FIXED_STEP_CLOCKS,
  FIXED_STEP_SECONDS,
  MAX_STEPS_PER_FRAME,
} from './fixedStep'
import { advanceClocks, REFERENCE_SPEED } from './stages'
import { createWorld, DEFAULT_CONFIG, stepWorld, type ParasiteWorld } from './world'

const world0 = () => createWorld(DEFAULT_CONFIG, 42)

/** Feed `totalSeconds` of real time to the driver in the given frame lengths. */
function play(frames: number[], speed = REFERENCE_SPEED, start: ParasiteWorld = world0()) {
  let world = start
  let accumulator = 0
  let steps = 0
  for (const dt of frames) {
    const r = advanceFixed(world, DEFAULT_CONFIG, accumulator, dt, speed)
    world = r.world
    accumulator = r.accumulator
    steps += r.steps
  }
  return { world, accumulator, steps }
}

/** `n` frames of `dt`, then whatever is left over, so the total is exact. */
const frames = (total: number, dt: number) => {
  const out: number[] = []
  let left = total
  while (left > dt) {
    out.push(dt)
    left -= dt
  }
  out.push(left)
  return out
}

describe('fixed step', () => {
  it('is one sixtieth of a second of 1× play, in both gears', () => {
    expect(FIXED_STEP_SECONDS).toBe(1 / 60)
    expect(FIXED_STEP_CLOCKS).toEqual(advanceClocks(1 / 60, REFERENCE_SPEED))
    // the documented ratios: 0.9 lesion hours and 4 action seconds per second of play
    expect(FIXED_STEP_CLOCKS.lesion).toBeCloseTo(0.9 / 60, 12)
    expect(FIXED_STEP_CLOCKS.action).toBeCloseTo(4 / 60, 12)
  })

  it('gives the same world however the real time is cut into frames', () => {
    // 10.005 s is 600.3 steps: far from a step boundary, so rounding in the
    // accumulator cannot move a step from one frame to the next
    const total = 10.005
    const at60 = play(frames(total, 1 / 60))
    const at144 = play(frames(total, 1 / 144))
    const at17 = play(frames(total, 0.0588)) // a slow, uneven device
    const ragged = play([0.0, 0.1, 0.003, 0.016, 0.09, ...frames(total - 0.209, 0.0333)])

    expect(at60.steps).toBe(600)
    for (const r of [at144, at17, ragged]) {
      expect(r.steps).toBe(600)
      expect(r.world).toEqual(at60.world)
    }
  })

  it('matches calling stepWorld directly with the fixed clocks', () => {
    let direct = world0()
    for (let i = 0; i < 600; i++) direct = stepWorld(direct, DEFAULT_CONFIG, FIXED_STEP_CLOCKS)
    expect(play(frames(10.005, 1 / 60)).world).toEqual(direct)
  })

  it('advances both clocks by a whole number of steps', () => {
    const { world, steps } = play(frames(5.005, 1 / 60))
    expect(steps).toBe(300)
    expect(world.lesionHours).toBeCloseTo(steps * FIXED_STEP_CLOCKS.lesion, 9)
    expect(world.actionSeconds).toBeCloseTo(steps * FIXED_STEP_CLOCKS.action, 9)
  })

  it('runs proportionally more steps at higher speed, never bigger ones', () => {
    // 5.0008 s is 300.05 steps at 1× and 1200.19 at 4×: both clear of a boundary
    const one = play(frames(5.0008, 1 / 60), REFERENCE_SPEED)
    const four = play(frames(5.0008, 1 / 60), REFERENCE_SPEED * 4)
    expect(one.steps).toBe(300)
    expect(four.steps).toBe(1200)
    expect(four.world.lesionHours).toBeCloseTo(one.world.lesionHours * 4, 6)
    // the very same 1200 fixed steps, reached by running longer at 1× instead
    const longer = play(frames(20.0032, 1 / 60), REFERENCE_SPEED)
    expect(longer.steps).toBe(1200)
    expect(four.world).toEqual(longer.world)
  })

  it('carries the fraction of a step between frames', () => {
    // 0.4 of a step per frame: 0, 0, then 1 with 0.2 left over
    const dt = 0.4 * FIXED_STEP_SECONDS
    let acc = 0
    const seen: number[] = []
    let w = world0()
    for (let i = 0; i < 5; i++) {
      const r = advanceFixed(w, DEFAULT_CONFIG, acc, dt, REFERENCE_SPEED)
      w = r.world
      acc = r.accumulator
      seen.push(r.steps)
    }
    expect(seen).toEqual([0, 0, 1, 0, 1])
    expect(acc).toBeCloseTo(0, 9) // 5 × 0.4 = 2 steps exactly
  })

  it('does nothing — and keeps its remainder — when paused or given a bad dt', () => {
    const w = world0()
    for (const [dt, speed] of [
      [0.016, 0],
      [0, 1],
      [-1, 1],
      [Number.NaN, 1],
      [0.016, Number.NaN],
      [Infinity, 0],
    ]) {
      const r = advanceFixed(w, DEFAULT_CONFIG, 0.3, dt, speed)
      expect(r.steps).toBe(0)
      expect(r.world).toBe(w)
      expect(r.accumulator).toBe(0.3) // never poisoned by NaN
    }
  })

  it('caps one frame at MAX_STEPS_PER_FRAME and drops the rest instead of spiralling', () => {
    const r = advanceFixed(world0(), DEFAULT_CONFIG, 0, 1000, 3) // minutes owed
    expect(r.steps).toBe(MAX_STEPS_PER_FRAME)
    expect(r.dropped).toBeGreaterThan(0)
    expect(r.accumulator).toBeGreaterThanOrEqual(0)
    expect(r.accumulator).toBeLessThan(1)
  })

  it('still fits the longest legal frame: 0.1 s clamp at the 6× slider maximum', () => {
    // SimClock clamps dt to 0.1 s; the speed slider tops out at 3 d/s = 6×
    const r = advanceFixed(world0(), DEFAULT_CONFIG, 0, 0.1, 3)
    expect(r.dropped).toBe(0)
    expect(r.steps).toBe(36)
    expect(r.steps).toBeLessThanOrEqual(MAX_STEPS_PER_FRAME)
  })

  it('stops stepping once the caller says the run is over', () => {
    let seenSteps = 0
    const r = advanceFixed(world0(), DEFAULT_CONFIG, 0, 0.5, REFERENCE_SPEED, () => ++seenSteps === 7)
    expect(r.steps).toBe(7)
    expect(r.world.lesionHours).toBeCloseTo(7 * FIXED_STEP_CLOCKS.lesion, 9)
  })

  it('never mutates the world it was handed', () => {
    const w = world0()
    const before = structuredClone(w)
    advanceFixed(w, DEFAULT_CONFIG, 0, 1 / 30, REFERENCE_SPEED)
    expect(w).toEqual(before)
  })
})
