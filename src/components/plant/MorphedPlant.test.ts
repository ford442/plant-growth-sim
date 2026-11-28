import { describe, expect, it } from 'vitest'
import { SPECIES_LSYSTEMS } from '../../simulation/LSystem'
import { createMorphBuilder } from '../../simulation/LSystemMorph'
import { getMorphedPlant } from './MorphedPlant'

describe('MorphedPlant.top', () => {
  it('is the height of the highest branch vertex in the current pose', () => {
    const p = getMorphedPlant('sunflower', 3)
    p.setMorph(0)
    const t0 = p.top
    expect(t0).toBeGreaterThan(0)
    p.setMorph(1)
    expect(p.top).toBeGreaterThanOrEqual(t0) // growing towards the next stage never lowers the top
    // at t = 1 the pose is exactly the next generation's segment end points
    const pts = createMorphBuilder(SPECIES_LSYSTEMS.sunflower).morph(3).segmentsTo
    let max = -Infinity
    for (let i = 1; i < pts.length; i += 3) max = Math.max(max, pts[i])
    expect(p.top).toBeCloseTo(Math.max(0, max), 4)
  })

  it('is taller at a later stage', () => {
    const early = getMorphedPlant('oak', 2)
    const late = getMorphedPlant('oak', 5)
    early.setMorph(1)
    late.setMorph(1)
    expect(late.top).toBeGreaterThan(early.top)
  })
})
