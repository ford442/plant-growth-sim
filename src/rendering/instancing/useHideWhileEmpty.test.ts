import { describe, expect, it } from 'vitest'
import { resolveInstancedVisibility } from './useHideWhileEmpty'

describe('resolveInstancedVisibility', () => {
  it('hides an empty mesh and shows a populated one', () => {
    expect(resolveInstancedVisibility(0, true)).toBe(false)
    expect(resolveInstancedVisibility(1, true)).toBe(true)
    expect(resolveInstancedVisibility(20_000, true)).toBe(true)
  })

  it('never overrides an owner that asked for the mesh to stay hidden', () => {
    expect(resolveInstancedVisibility(50, false)).toBe(false)
  })
})
