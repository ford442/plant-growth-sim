import {
  CAMBIAL_SIZE,
  FILE_COUNT,
  FILE_WIDTH,
  type StemMetrics,
} from '../../simulation/TissueGrowth'

/**
 * Layout of the cellular view, in world units. The scene is two linked pictures:
 *
 *   stem disc  ──(zoom guides)──►  cell lens
 *   whole cross-section            the radial strip at 3 o'clock, magnified
 *
 * The lens is a Cartesian strip: x runs along the stem radius (pith on the left,
 * bark on the right) and y runs around the circumference, one row per radial
 * file. It is anchored on the centre of the cambium, which therefore never moves
 * on screen — older wood slides inwards (left) as new cells enlarge.
 */

/** World units per µm in the lens. */
export const LENS_SCALE = 0.027
/** One file's height in the lens. */
export const ROW_H = FILE_WIDTH * LENS_SCALE
/** Tissue further than this many µm inside the cambium is clipped. */
export const LENS_LEFT_UM = 215
/** Outermost reach of the bark side of the lens, µm from the cambium centre. */
export const LENS_RIGHT_UM = 120
/** Clipped tissue fades into the background over this distance. */
export const FADE_UM = 55

export const LENS_LEFT = LENS_LEFT_UM * LENS_SCALE
export const LENS_RIGHT = LENS_RIGHT_UM * LENS_SCALE
export const LENS_HEIGHT = FILE_COUNT * ROW_H

/** Row centre of file `f`, with file 0 at the bottom. */
export const rowY = (f: number) => (f - (FILE_COUNT - 1) / 2) * ROW_H

// --- scene composition (local, before centring) ---------------------------

export const DISC_R_MIN = 1.2
export const DISC_R_MAX = 2.1
/** Stem radius (µm) at which the disc stops growing and rings start to compress. */
const DISC_FULL_UM = 1500

/** On-screen disc radius: it swells with the stem, then holds so rings stay readable. */
export function discRadius(stemRadiusUm: number): number {
  const t = Math.min(1, Math.max(0, stemRadiusUm / DISC_FULL_UM))
  return DISC_R_MIN + (DISC_R_MAX - DISC_R_MIN) * (t * t * (3 - 2 * t))
}

/** Gap between the disc's rim and the lens' inner edge, for the zoom guides. */
const GAP = 1.1

/** Lens cambium anchor, with the disc centre at `DISC_X` to its left. */
export const LENS_X = 0
export const DISC_X = LENS_X - LENS_LEFT - GAP - DISC_R_MAX
/** Shift that centres the whole composition on the origin. */
export const CENTER_SHIFT = -((DISC_X - DISC_R_MAX) + (LENS_X + LENS_RIGHT)) / 2

export const SCENE_WIDTH = LENS_RIGHT - (DISC_X - DISC_R_MAX)
/** Includes the ruler and labels under the lens. */
export const SCENE_HEIGHT = Math.max(LENS_HEIGHT, 2 * DISC_R_MAX) + 1.4

/**
 * The strip of the stem that the lens shows, as a rectangle on the disc at
 * 3 o'clock, in µm from the stem centre. It is centred on the cambium.
 */
export interface ZoomBox {
  x0: number
  x1: number
  halfH: number
  /** Radius of the cambium, µm. */
  cambium: number
}

export function zoomBox(m: StemMetrics): ZoomBox {
  const cambium = m.xylemRadius + CAMBIAL_SIZE * 0.75
  return {
    x0: Math.max(0, cambium - LENS_LEFT_UM),
    x1: cambium + LENS_RIGHT_UM,
    halfH: (FILE_COUNT * FILE_WIDTH) / 2,
    cambium,
  }
}
