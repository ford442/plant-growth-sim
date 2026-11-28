import type { SpeciesId } from '../../simulation/species'
import { getMorphedPlant } from '../plant/MorphedPlant'

/** The camera frames about 2 m above the ground; water that rises further than that is out of view anyway. */
const MAX_STEM = 2

/**
 * How high the Roots view's water rises: the top of the plant as the
 * architecture view draws it (its own height × the view's growth scale), so the
 * handoff to the canopy happens at the real top of the stem.
 */
export function stemTopOf(species: SpeciesId, iterations: number, height: number): number {
  const scale = Math.max(0.3, height / 1.8)
  return Math.min(MAX_STEM, Math.max(0.15, getMorphedPlant(species, iterations).top * scale))
}
