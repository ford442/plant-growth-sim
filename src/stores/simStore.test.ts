import { beforeEach, describe, expect, it } from 'vitest'
import { useSimStore } from './simStore'
import { useTimeStore } from './timeStore'
import { DAYS_PER_ITERATION, MAX_ITERATIONS, MIN_ITERATIONS } from '../simulation/LSystemMorph'

const sim = () => useSimStore.getState()

/** Rain keeps the plant turgid, so a test can hold water at 1 and vary only what it is about. */
const WET = { temperature: 22, light: 1, precipitation: 5, humidity: 0.6, wind: 0 }

beforeEach(() => {
  useTimeStore.getState().play()
  useTimeStore.getState().setSpeed(1)
  sim().reset()
  sim().setWeather(WET)
  useSimStore.setState({ waterStatus: 1 })
})

describe('architecture development (L-system progress)', () => {
  it('starts at the minimum iteration', () => {
    expect(sim().lsystemProgress).toBe(MIN_ITERATIONS)
    expect(sim().lsystemIterations).toBe(MIN_ITERATIONS)
  })

  it('advances continuously: a small tick moves the stage by a small fraction', () => {
    sim().tick(0.1) // 0.1 s at 1 day/s, ideal weather
    expect(sim().lsystemProgress).toBeCloseTo(MIN_ITERATIONS + 0.1 / DAYS_PER_ITERATION, 8)
    expect(sim().lsystemIterations).toBe(MIN_ITERATIONS)
  })

  it('reaches the next whole iteration after DAYS_PER_ITERATION ideal days', () => {
    for (let i = 0; i < 31; i++) sim().tick(0.1)
    expect(sim().lsystemIterations).toBe(MIN_ITERATIONS + 1)
    expect(sim().lsystemProgress).toBeLessThan(MIN_ITERATIONS + 1.05)
  })

  it('stops at the final iteration', () => {
    for (let i = 0; i < 400; i++) sim().tick(0.1)
    expect(sim().lsystemProgress).toBe(MAX_ITERATIONS)
    expect(sim().lsystemIterations).toBe(MAX_ITERATIONS)
  })

  it('does not advance while paused', () => {
    useTimeStore.getState().pause()
    sim().tick(0.1)
    expect(sim().lsystemProgress).toBe(MIN_ITERATIONS)
  })

  it('scales with the speed control', () => {
    useTimeStore.getState().setSpeed(2)
    sim().tick(0.1)
    expect(sim().lsystemProgress).toBeCloseTo(MIN_ITERATIONS + 0.2 / DAYS_PER_ITERATION, 8)
  })

  it('stalls when the weather stops growth (no light, or far too cold) even though age keeps running', () => {
    sim().setWeather({ light: 0 })
    sim().tick(0.1)
    sim().setWeather({ light: 1, temperature: -10 })
    sim().tick(0.1)
    expect(sim().lsystemProgress).toBe(MIN_ITERATIONS)
    expect(sim().biomass).toBeCloseTo(0.1, 10)
    expect(sim().age).toBeGreaterThan(0.19)
  })

  it('is locked to the weather-driven growth rate: Δbiomass / Δprogress is constant', () => {
    const ratios: number[] = []
    for (const weather of [
      { temperature: 22, light: 1 },
      { temperature: 15, light: 0.6 },
      { temperature: 30, light: 0.3 },
      { temperature: 5, light: 1 },
    ]) {
      sim().reset()
      sim().setWeather({ ...WET, ...weather })
      useSimStore.setState({ waterStatus: 0.8 })
      const b0 = sim().biomass
      const p0 = sim().lsystemProgress
      sim().tick(0.1)
      const dp = sim().lsystemProgress - p0
      expect(dp).toBeGreaterThan(0)
      ratios.push((sim().biomass - b0) / dp)
    }
    for (const r of ratios) expect(r).toBeCloseTo(ratios[0], 8)
  })

  it('wetter plants develop faster than drought-stressed ones', () => {
    sim().tick(0.1)
    const wet = sim().lsystemProgress - MIN_ITERATIONS
    sim().reset()
    sim().setWeather(WET)
    useSimStore.setState({ waterStatus: 0.2 })
    sim().tick(0.1)
    expect(sim().lsystemProgress - MIN_ITERATIONS).toBeLessThan(wet)
  })

  it('reset() returns to the first stage; setLsystemIterations keeps both fields consistent', () => {
    for (let i = 0; i < 40; i++) sim().tick(0.1)
    sim().reset()
    expect(sim().lsystemProgress).toBe(MIN_ITERATIONS)
    sim().setLsystemIterations(5)
    expect(sim().lsystemProgress).toBe(5)
    expect(sim().lsystemIterations).toBe(5)
  })
})
