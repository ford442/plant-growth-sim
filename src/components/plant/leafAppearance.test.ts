import { describe, expect, it } from 'vitest'
import {
  DRY_TAU,
  RAIN_FOR_FULL_WETNESS,
  WET_TAU,
  WIND_FOR_FULL_FLUTTER,
  leafAppearance,
  relaxWetness,
  type LeafConditions,
} from './leafAppearance'

const calm: LeafConditions = {
  waterStatus: 0.85,
  nutrientStatus: 1,
  light: 0.85,
  humidity: 0.6,
  precipitation: 0,
  wind: 0,
}

describe('leafAppearance', () => {
  it('shows a healthy, dry, still leaf at the sim defaults', () => {
    const a = leafAppearance({ ...calm, wind: 1.2 })
    expect(a.chlorophyll).toBe(1)
    expect(a.wetness).toBe(0)
    expect(a.flutter).toBeGreaterThan(0)
    expect(a.flutter).toBeLessThan(0.25)
  })

  it('loses pigment continuously as the plant wilts', () => {
    const levels = [0.9, 0.6, 0.5, 0.4, 0.3, 0.2, 0.1].map((waterStatus) => leafAppearance({ ...calm, waterStatus }).chlorophyll)
    for (let i = 1; i < levels.length; i++) expect(levels[i]).toBeLessThanOrEqual(levels[i - 1])
    expect(levels[0]).toBe(1)
    expect(levels[levels.length - 1]).toBe(0)
  })

  it('has no cliff: the old render hard-switched colour at waterStatus 0.35', () => {
    // steepest slope of the smoothstep over [0.2, 0.55] is 1.5 / 0.35 ≈ 4.3,
    // so a 0.01 step can move the pigment by at most ~0.043 (a hard switch moves it by 1)
    let worst = 0
    for (let w = 0; w < 1; w += 0.01) {
      const a = leafAppearance({ ...calm, waterStatus: w }).chlorophyll
      const b = leafAppearance({ ...calm, waterStatus: w + 0.01 }).chlorophyll
      worst = Math.max(worst, Math.abs(b - a))
    }
    expect(worst).toBeLessThan(0.05)
    expect(worst).toBeGreaterThan(0.03) // and it really does cross the band, not flat
  })

  it('yellows with poor nutrition even when well watered', () => {
    const fed = leafAppearance({ ...calm, nutrientStatus: 1 }).chlorophyll
    const starved = leafAppearance({ ...calm, nutrientStatus: 0 }).chlorophyll
    expect(starved).toBeLessThan(fed)
    expect(starved).toBeGreaterThan(0.5) // a deficiency tints the leaf, it does not kill it
  })

  it('wets with rain and saturates', () => {
    expect(leafAppearance({ ...calm, precipitation: RAIN_FOR_FULL_WETNESS / 2 }).wetness).toBeCloseTo(0.5)
    expect(leafAppearance({ ...calm, precipitation: 100 }).wetness).toBe(1)
  })

  it('leaves a little dew in near-saturated air, much less than rain', () => {
    const dew = leafAppearance({ ...calm, humidity: 1 }).wetness
    expect(dew).toBeGreaterThan(0)
    expect(dew).toBeLessThan(0.5)
    expect(leafAppearance({ ...calm, humidity: 0.6 }).wetness).toBe(0)
  })

  it('flutters with wind up to a cap', () => {
    expect(leafAppearance({ ...calm, wind: WIND_FOR_FULL_FLUTTER / 2 }).flutter).toBeCloseTo(0.5)
    expect(leafAppearance({ ...calm, wind: 40 }).flutter).toBe(1)
  })

  it('stays within 0–1 for out-of-range inputs', () => {
    const extremes = [-5, 0, 1, 5, 1e6]
    for (const x of extremes) {
      const a = leafAppearance({ waterStatus: x, nutrientStatus: x, light: x, humidity: x, precipitation: x, wind: x })
      for (const v of Object.values(a)) {
        expect(v).toBeGreaterThanOrEqual(0)
        expect(v).toBeLessThanOrEqual(1)
      }
    }
  })

  it('is deterministic and does not mutate its input', () => {
    const input = Object.freeze({ ...calm, precipitation: 2 })
    expect(leafAppearance(input)).toEqual(leafAppearance(input))
  })
})

describe('relaxWetness', () => {
  it('wets faster than it dries', () => {
    const wetted = relaxWetness(0, 1, 1)
    const dried = 1 - relaxWetness(1, 0, 1)
    expect(wetted).toBeGreaterThan(dried)
    expect(wetted).toBeCloseTo(1 - Math.exp(-1 / WET_TAU))
    expect(dried).toBeCloseTo(1 - Math.exp(-1 / DRY_TAU))
  })

  it('converges to the target and never overshoots', () => {
    let w = 0
    for (let i = 0; i < 600; i++) {
      w = relaxWetness(w, 0.7, 1 / 60)
      expect(w).toBeLessThanOrEqual(0.7)
    }
    expect(w).toBeCloseTo(0.7, 1)
  })

  it('holds still for a zero or negative frame time', () => {
    expect(relaxWetness(0.3, 1, 0)).toBe(0.3)
    expect(relaxWetness(0.3, 1, -1)).toBe(0.3)
  })

  it('is frame-rate independent', () => {
    let a = 0
    for (let i = 0; i < 60; i++) a = relaxWetness(a, 1, 1 / 60)
    const b = relaxWetness(0, 1, 1)
    expect(a).toBeCloseTo(b, 6)
  })
})
