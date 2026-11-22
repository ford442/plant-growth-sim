import { beforeEach, describe, expect, it } from 'vitest'
import { CYST_CAPACITY } from '../components/parasite/slice/sliceLayout'
import { DEFAULT_LOD_TIER } from '../components/parasite/slice/sliceLod'
import { parseSliceParams, useSliceViewStore } from './sliceViewStore'

describe('parseSliceParams', () => {
  it('reads ?stress and ?lod', () => {
    expect(parseSliceParams('?stress=200&lod=ultra')).toEqual({ stress: 200, lod: 'ultra' })
  })

  it('defaults to a real run: no stress, no pinned tier', () => {
    expect(parseSliceParams('')).toEqual({ stress: 0, lod: null })
    expect(parseSliceParams('?renderer=webgpu')).toEqual({ stress: 0, lod: null })
  })

  it('ignores nonsense and clamps stress to what the garden can hold', () => {
    expect(parseSliceParams('?stress=banana&lod=extreme')).toEqual({ stress: 0, lod: null })
    expect(parseSliceParams('?stress=-5').stress).toBe(0)
    expect(parseSliceParams('?stress=9999').stress).toBe(CYST_CAPACITY)
    expect(parseSliceParams('?stress=12.9').stress).toBe(12)
  })
})

describe('useSliceViewStore', () => {
  beforeEach(() => {
    useSliceViewStore.setState({ lodTier: DEFAULT_LOD_TIER, lodAuto: true, hoverId: null })
  })

  it('starts on the default tier with adaptive scaling on', () => {
    const s = useSliceViewStore.getState()
    expect(s.lodTier).toBe(DEFAULT_LOD_TIER)
    expect(s.lodAuto).toBe(true)
    expect(s.stress).toBe(0)
  })

  it('a tier the player picks sticks: adaptive scaling stops', () => {
    useSliceViewStore.getState().setLodTier('low')
    expect(useSliceViewStore.getState()).toMatchObject({ lodTier: 'low', lodAuto: false })
  })

  it('a tier the adaptive step picks leaves adaptive scaling on', () => {
    useSliceViewStore.getState().stepLodTier('medium')
    expect(useSliceViewStore.getState()).toMatchObject({ lodTier: 'medium', lodAuto: true })
  })

  it('tracks the hovered cyst', () => {
    useSliceViewStore.getState().setHover(42)
    expect(useSliceViewStore.getState().hoverId).toBe(42)
    useSliceViewStore.getState().setHover(null)
    expect(useSliceViewStore.getState().hoverId).toBeNull()
  })
})
