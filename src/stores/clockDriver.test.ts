import { beforeEach, describe, expect, it } from 'vitest'
import { clockUsers, startSimClock, tickSimulations, type ClockEnv } from './clockDriver'
import { useModeStore } from './modeStore'
import { useSimStore } from './simStore'
import { useTimeStore } from './timeStore'
import { MAX_FRAME_SECONDS } from '../simulation/clock'

/** A hand-cranked requestAnimationFrame: nothing runs until the test says so. */
function fakeEnv() {
  let nextHandle = 1
  const pending = new Map<number, (nowMs: number) => void>()
  let requested = 0
  const env: ClockEnv = {
    requestFrame: (cb) => {
      const h = nextHandle++
      requested++
      pending.set(h, cb)
      return h
    },
    cancelFrame: (h) => void pending.delete(h),
  }
  return {
    env,
    /** Fire every callback queued right now at time `nowMs`. */
    flush: (nowMs: number) => {
      const batch = [...pending.entries()]
      pending.clear()
      for (const [, cb] of batch) cb(nowMs)
    },
    pending: () => pending.size,
    requested: () => requested,
  }
}

const sim = () => useSimStore.getState()

beforeEach(() => {
  useTimeStore.getState().play()
  useTimeStore.getState().setSpeed(1)
  useModeStore.setState({ mode: 'plant' })
  sim().reset()
  sim().setWeather({ temperature: 22, light: 1, precipitation: 5, humidity: 0.6, wind: 0 })
})

describe('one shared clock', () => {
  it('any number of holders (StrictMode, a remounted canvas, a second view) run exactly one loop', () => {
    const f = fakeEnv()
    const stopA = startSimClock(f.env)
    const stopB = startSimClock(f.env) // e.g. a remount while the first is still mounted
    expect(clockUsers()).toBe(2)
    expect(f.pending()).toBe(1)
    expect(f.requested()).toBe(1)

    f.flush(0)
    f.flush(100)
    expect(f.pending()).toBe(1) // still one loop, not two

    stopA()
    expect(f.pending()).toBe(1) // B still holds it
    stopA() // releasing twice is harmless
    expect(clockUsers()).toBe(1)
    stopB()
    expect(clockUsers()).toBe(0)
    expect(f.pending()).toBe(0) // last holder gone → loop cancelled
  })

  it('a remount (release then re-acquire) restarts cleanly with no catch-up from the gap', () => {
    const f = fakeEnv()
    const stop = startSimClock(f.env)
    f.flush(0)
    f.flush(16)
    stop()
    const ageBefore = sim().age

    // ten minutes later the clock is started again
    const stop2 = startSimClock(f.env)
    f.flush(600_000) // first frame has no predecessor → dt 0
    expect(sim().age).toBe(ageBefore)
    f.flush(600_100)
    expect(sim().age - ageBefore).toBeLessThanOrEqual(MAX_FRAME_SECONDS + 1e-9)
    stop2()
  })

  it('a backgrounded tab (huge gap between frames) cannot jump the plant', () => {
    const f = fakeEnv()
    const stop = startSimClock(f.env)
    f.flush(0)
    f.flush(5_000) // 5 s with no frame
    expect(sim().age).toBeLessThanOrEqual(MAX_FRAME_SECONDS + 1e-9)
    f.flush(5_016)
    expect(sim().age).toBeLessThan(MAX_FRAME_SECONDS + 0.05)
    stop()
  })

  it('ticks keep running while no canvas exists: the driver depends on nothing in the scene', () => {
    const f = fakeEnv()
    const stop = startSimClock(f.env)
    f.flush(0)
    for (let i = 1; i <= 30; i++) f.flush(i * (1000 / 60)) // half a second of 60 Hz frames
    expect(sim().age).toBeCloseTo(0.5, 6)
    stop()
  })
})

describe('time controls stay on the stores', () => {
  it('pausing freezes sim time; frames still arrive; resuming continues from where it stopped', () => {
    const f = fakeEnv()
    const stop = startSimClock(f.env)
    f.flush(0)
    for (let i = 1; i <= 30; i++) f.flush(i * 20)
    const frozen = sim().age
    expect(frozen).toBeGreaterThan(0)

    useTimeStore.getState().pause()
    for (let i = 31; i <= 90; i++) f.flush(i * 20)
    expect(sim().age).toBe(frozen)
    expect(f.pending()).toBe(1) // the loop never stopped

    useTimeStore.getState().play()
    f.flush(91 * 20)
    f.flush(92 * 20)
    expect(sim().age).toBeGreaterThan(frozen)
    expect(sim().age - frozen).toBeLessThanOrEqual(0.05) // no burst for the paused minute
    stop()
  })

  it('speed scales days per second; reset() returns the seedling and zeroes the carried time', () => {
    useTimeStore.getState().setSpeed(2)
    tickSimulations(0.1)
    expect(sim().age).toBeCloseTo(0.2, 9)
    tickSimulations(0.01) // a part-step is owed…
    expect(sim().clockAccumulator).toBeGreaterThan(0)

    sim().reset()
    expect(sim().age).toBe(0)
    expect(sim().time).toBe(0)
    expect(sim().height).toBe(0.15)
    expect(sim().clockAccumulator).toBe(0)
  })

  it('changing the species / soil / mode does not reset age (only reset() does)', () => {
    tickSimulations(0.1)
    const age = sim().age
    sim().setSpecies('oak')
    sim().setSoilProfile('limestone')
    useModeStore.setState({ mode: 'gem' })
    expect(sim().age).toBe(age)
    useModeStore.setState({ mode: 'plant' })
    tickSimulations(0.1)
    expect(sim().age).toBeCloseTo(age + 0.1, 9)
  })
})
