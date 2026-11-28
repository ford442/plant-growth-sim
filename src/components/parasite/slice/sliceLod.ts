/**
 * What each LOD tier means for the cyst garden.
 *
 * The tier ladder and its adaptive stepping are borrowed from ford442/watershed
 * (`rendering/lod/adaptiveLod.ts`); this is the table that gives those tier
 * names a budget, in the shape of watershed's `QUALITY_SETTINGS`. A tier only
 * changes how much is *drawn* — the simulation's counts never depend on it, and
 * the readout in the sidebar says "drawn X of Y" so a capped scene is never
 * mistaken for a smaller infection.
 *
 * The expensive thing is the bradyzoites: a mature cyst holds up to 1 024, so
 * 200 cysts is ~200 k crescents if every one were drawn. They are the only layer
 * with a per-instance triangle cost worth budgeting, so the tier sets how many
 * are drawn in total and how finely each crescent is tessellated.
 */

import type { LodTier } from '../../../rendering/lod/adaptiveLod'

export interface SliceLodConfig {
  /** Most bradyzoite instances drawn across all cysts. */
  bradyzoiteBudget: number
  /** Crescent tessellation: sides around the body × rings along it. */
  crescentRadial: number
  crescentLength: number
  /** Cyst sphere tessellation (shared by the body and the wall shell). */
  sphereWidth: number
  sphereHeight: number
  /** Host-cell tile: 1 = flat hexagon, 2 = hexagon with a domed profile. */
  cellRings: 1 | 2
}

export const SLICE_LOD: Record<LodTier, SliceLodConfig> = {
  low: { bradyzoiteBudget: 2_500, crescentRadial: 3, crescentLength: 4, sphereWidth: 12, sphereHeight: 8, cellRings: 1 },
  medium: { bradyzoiteBudget: 8_000, crescentRadial: 4, crescentLength: 5, sphereWidth: 16, sphereHeight: 10, cellRings: 1 },
  // the acceptance case: 200 cysts and ~20 k bradyzoites
  high: { bradyzoiteBudget: 20_000, crescentRadial: 4, crescentLength: 6, sphereWidth: 20, sphereHeight: 14, cellRings: 2 },
  ultra: { bradyzoiteBudget: 32_000, crescentRadial: 5, crescentLength: 8, sphereWidth: 28, sphereHeight: 20, cellRings: 2 },
}

export const DEFAULT_LOD_TIER: LodTier = 'high'

/** The buffer every tier fits inside, so a tier change never reallocates. */
export const MAX_BRADYZOITE_INSTANCES = Math.max(...Object.values(SLICE_LOD).map((t) => t.bradyzoiteBudget))

/** Triangles in one crescent (a swept tube: two per quad, `radial` quads per ring). */
export const crescentTriangles = (c: Pick<SliceLodConfig, 'crescentRadial' | 'crescentLength'>) =>
  2 * c.crescentRadial * c.crescentLength

/** Triangles in a UV sphere of this tessellation. */
export const sphereTriangles = (c: Pick<SliceLodConfig, 'sphereWidth' | 'sphereHeight'>) =>
  2 * c.sphereWidth * (c.sphereHeight - 1)

/** Triangles in one host-cell tile. */
export const cellTriangles = (c: Pick<SliceLodConfig, 'cellRings'>) => 6 * (2 * c.cellRings - 1)
