import { describe, expect, it } from 'vitest'
import { getMorphedPlant } from './MorphedPlant'

describe('MorphedPlant.top', () => {
  it('is the height of the highest branch vertex in the current pose', () => {
    const p = getMorphedPlant('sunflower', 3)
    p.setMorph(0)
    const t0 = p.top
    expect(t0).toBeGreaterThan(0)
    p.setMorph(1)
    expect(p.top).toBeGreaterThanOrEqual(t0) // growing towards the next stage never lowers the top
    const a = p.branchGeometry.getAttribute('position').array as Float32Array
    let max = -Infinity
    for (let i = 1; i < a.length; i += 3) max = Math.max(max, a[i])
    expect(p.top).toBe(Math.max(0, max))
  })

  it('is taller at a later stage', () => {
    const early = getMorphedPlant('oak', 2)
    const late = getMorphedPlant('oak', 5)
    early.setMorph(1)
    late.setMorph(1)
    expect(late.top).toBeGreaterThan(early.top)
  })
})
