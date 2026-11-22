import { create } from 'zustand'
import { LOD_TIERS, type LodTier } from '../rendering/lod/adaptiveLod'
import type { NicheId } from '../simulation/parasite/hostImmunity'
import type { ScaleBar } from '../components/parasite/slice/scaleBar'
import { CYST_CAPACITY } from '../components/parasite/slice/sliceLayout'
import { DEFAULT_LOD_TIER } from '../components/parasite/slice/sliceLod'
import { useParasiteStore } from './parasiteStore'

/**
 * View state for the tissue-slice ("cyst garden") view — what the person has
 * chosen to look at, not anything the simulation knows. Nothing in
 * `parasiteStore` reads it; the slice reads `parasiteStore` and writes only here.
 */

/** URL switches: `?stress=200` draws a synthetic garden, `?lod=ultra` pins a tier. */
export interface SliceParams {
  /** Synthetic cysts to draw instead of the sim's, 0 = off. */
  stress: number
  /** A pinned tier (turns adaptive scaling off), or null. */
  lod: LodTier | null
}

export function parseSliceParams(search: string): SliceParams {
  const params = new URLSearchParams(search)
  const stress = Number(params.get('stress'))
  const lod = params.get('lod')
  return {
    stress: Number.isFinite(stress) ? Math.max(0, Math.min(CYST_CAPACITY, Math.floor(stress))) : 0,
    lod: LOD_TIERS.includes(lod as LodTier) ? (lod as LodTier) : null,
  }
}

/** What the sidebar reports about the garden, updated only when it changes. */
export interface SliceStats {
  cysts: number
  /** Bradyzoite instances on screen. */
  drawn: number
  /** Bradyzoites the simulation holds in those cysts. */
  total: number
}

export interface SliceViewState {
  /** Backdrop palette (cosmetic). */
  niche: NicheId
  lodTier: LodTier
  /** Step the tier down/up from measured frame rate. */
  lodAuto: boolean
  stress: number
  /** The cyst under the pointer. */
  hoverId: number | null
  scaleBar: ScaleBar | null
  stats: SliceStats

  setNiche: (niche: NicheId) => void
  /** The player picks a tier: it sticks, so adaptive scaling stops. */
  setLodTier: (tier: LodTier) => void
  setLodAuto: (on: boolean) => void
  /** Adaptive scaling moves the tier; it stays on. */
  stepLodTier: (tier: LodTier) => void
  setHover: (id: number | null) => void
  setScaleBar: (bar: ScaleBar) => void
  setStats: (stats: SliceStats) => void
}

const params = parseSliceParams(typeof window === 'undefined' ? '' : window.location.search)

export const useSliceViewStore = create<SliceViewState>((set) => ({
  // the backdrop starts as the tissue the player is steering the parasite toward
  niche: useParasiteStore.getState().config.nicheFocus,
  lodTier: params.lod ?? DEFAULT_LOD_TIER,
  lodAuto: params.lod === null,
  stress: params.stress,
  hoverId: null,
  scaleBar: null,
  stats: { cysts: 0, drawn: 0, total: 0 },

  setNiche: (niche) => set({ niche }),
  setLodTier: (lodTier) => set({ lodTier, lodAuto: false }),
  setLodAuto: (lodAuto) => set({ lodAuto }),
  stepLodTier: (lodTier) => set({ lodTier }),
  setHover: (hoverId) => set({ hoverId }),
  setScaleBar: (scaleBar) => set({ scaleBar }),
  setStats: (stats) => set({ stats }),
}))
