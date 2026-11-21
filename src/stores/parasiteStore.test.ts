import { beforeEach, describe, expect, it } from 'vitest'
import { useParasiteStore } from './parasiteStore'
import { useTimeStore } from './timeStore'
import { FIXED_STEP_CLOCKS, FIXED_STEP_SECONDS } from '../simulation/parasite/fixedStep'
import { REFERENCE_SPEED } from '../simulation/parasite/stages'

const par = () => useParasiteStore.getState()

/** `total` seconds of real time in frames of `dt` (the last one shorter). */
function feed(total: number, dt: number) {
  let left = total
  while (left > dt) {
    par().tick(dt)
    left -= dt
  }
  par().tick(left)
}

beforeEach(() => {
  useTimeStore.getState().play()
  useTimeStore.getState().setSpeed(REFERENCE_SPEED) // 1×
  par().setObjective('latentPassage') // also gives a fresh run from the seed
  par().reset()
})

describe('parasite store: fixed-step clock', () => {
  it('runs the same world at 60 Hz, 144 Hz and on a slow, uneven device', () => {
    // 10.005 s is 600.3 steps, clear of a step boundary
    feed(10.005, 1 / 60)
    const at60 = par().world

    par().reset()
    feed(10.005, 1 / 144)
    const at144 = par().world

    par().reset()
    feed(10.005, 0.0588)
    const slow = par().world

    expect(at60.lesionHours).toBeCloseTo(600 * FIXED_STEP_CLOCKS.lesion, 9)
    expect(at144).toEqual(at60)
    expect(slow).toEqual(at60)
  })

  it('banks time that is too short for a step instead of losing it', () => {
    const before = par().world
    par().tick(FIXED_STEP_SECONDS * 0.4)
    expect(par().world).toBe(before) // untouched: nothing re-renders
    expect(par().accumulator).toBeCloseTo(0.4, 9)

    par().tick(FIXED_STEP_SECONDS * 0.7) // 1.1 steps in all
    expect(par().world.lesionHours).toBeCloseTo(FIXED_STEP_CLOCKS.lesion, 9)
    expect(par().accumulator).toBeCloseTo(0.1, 9)
  })

  it('scales the number of steps with the shared speed slider, not their size', () => {
    useTimeStore.getState().setSpeed(REFERENCE_SPEED * 3)
    feed(2.0008, 1 / 60) // 120.05 steps at 1×, so 360.15 at 3×
    expect(par().world.lesionHours).toBeCloseTo(360 * FIXED_STEP_CLOCKS.lesion, 9)
  })

  it('does not tick, or touch the accumulator, while paused', () => {
    par().tick(FIXED_STEP_SECONDS * 0.4)
    const world = par().world
    useTimeStore.getState().pause()
    par().tick(5)
    expect(par().world).toBe(world)
    expect(par().accumulator).toBeCloseTo(0.4, 9)
  })

  it('clears the banked time on reset, reroll and a change of objective or species', () => {
    for (const restart of [
      () => par().reset(),
      () => par().reroll(),
      () => par().setObjective('runaway'),
      () => par().setSpecies('hhammondi'),
    ]) {
      par().tick(FIXED_STEP_SECONDS * 0.4)
      expect(par().accumulator).toBeGreaterThan(0)
      restart()
      expect(par().accumulator).toBe(0)
      expect(par().world.lesionHours).toBe(0)
    }
  })

  it('lands a loss on the exact step it happens, and runs no step after it', () => {
    par().setObjective('oocystWinter')
    // the whole cohort has weathered away: lost as soon as it is judged
    useParasiteStore.setState((s) => ({ world: { ...s.world, oocysts: [] } }))
    expect(par().progress.status).toBe('active') // not yet judged

    par().tick(0.1) // owes 6 steps; must stop after the first
    expect(par().progress.status).toBe('lost')
    expect(par().world.lesionHours).toBeCloseTo(1 * FIXED_STEP_CLOCKS.lesion, 9)
    expect(useTimeStore.getState().isPlaying).toBe(false) // paused on the result

    // and a resolved run stays frozen until the player resets
    useTimeStore.getState().play()
    const frozen = par().world
    par().tick(1)
    expect(par().world).toBe(frozen)
  })
})
