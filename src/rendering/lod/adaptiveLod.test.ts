import { describe, expect, it } from 'vitest'
import {
  ADAPTIVE_LOD_BAND,
  DOWNGRADE_AFTER,
  LOD_TIERS,
  stepAdaptiveLod,
  UPGRADE_AFTER,
  type LodTier,
} from './adaptiveLod'

/** Feed `fps` for `n` windows, returning where the tier ends up. */
function run(start: LodTier, fps: number, n: number): LodTier {
  let tier = start
  let lowSeconds = 0
  let highSeconds = 0
  for (let i = 0; i < n; i++) {
    const step = stepAdaptiveLod({ tier, fps, targetFps: 60, lowSeconds, highSeconds })
    lowSeconds = step.lowSeconds
    highSeconds = step.highSeconds
    if (step.nextTier) tier = step.nextTier
  }
  return tier
}

describe('ADAPTIVE_LOD_BAND', () => {
  it('is cheapest-first, a subset of the ladder, and leaves `low` to the player', () => {
    expect(LOD_TIERS).toEqual(['low', 'medium', 'high', 'ultra'])
    expect(ADAPTIVE_LOD_BAND).toEqual(['medium', 'high', 'ultra'])
    expect(ADAPTIVE_LOD_BAND).not.toContain('low')
  })
})

describe('stepAdaptiveLod', () => {
  it('never moves a tier the player pinned outside the band', () => {
    const step = stepAdaptiveLod({ tier: 'low', fps: 5, targetFps: 60, lowSeconds: 9, highSeconds: 9 })
    expect(step).toEqual({ nextTier: null, lowSeconds: 0, highSeconds: 0 })
  })

  it('does not auto-downgrade from medium into low however slow it is', () => {
    expect(run('medium', 12, 20)).toBe('medium')
  })

  it('downgrades only after sustained slow windows, one tier at a time', () => {
    expect(run('high', 40, DOWNGRADE_AFTER - 1)).toBe('high')
    expect(run('high', 40, DOWNGRADE_AFTER)).toBe('medium')
    expect(run('ultra', 40, DOWNGRADE_AFTER)).toBe('high')
  })

  it('upgrades only after sustained headroom, and stops at the top of the band', () => {
    expect(run('high', 120, UPGRADE_AFTER - 1)).toBe('high')
    expect(run('high', 120, UPGRADE_AFTER)).toBe('ultra')
    expect(run('ultra', 120, 20)).toBe('ultra')
  })

  it('holds in the comfortable middle band (target−10 … target+5)', () => {
    expect(run('high', 58, 30)).toBe('high')
    expect(run('high', 64, 30)).toBe('high')
  })

  it('one slow window in a healthy run does not downgrade: evidence decays', () => {
    let tier: LodTier = 'high'
    let lowSeconds = 0
    let highSeconds = 0
    const samples = [60, 60, 30, 60, 60, 60, 30, 60, 60, 60, 30, 60]
    for (const fps of samples) {
      const step = stepAdaptiveLod({ tier, fps, targetFps: 60, lowSeconds, highSeconds })
      lowSeconds = step.lowSeconds
      highSeconds = step.highSeconds
      if (step.nextTier) tier = step.nextTier
    }
    expect(tier).toBe('high')
  })

  it('does not oscillate: a downgrade resets both counters', () => {
    const step = stepAdaptiveLod({ tier: 'high', fps: 20, targetFps: 60, lowSeconds: DOWNGRADE_AFTER - 1, highSeconds: 1 })
    expect(step.nextTier).toBe('medium')
    expect(step.lowSeconds).toBe(0)
    expect(step.highSeconds).toBe(0)
  })
})
