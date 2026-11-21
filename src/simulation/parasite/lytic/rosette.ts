/**
 * Rosette layout inside the parasitophorous vacuole.
 *
 * Endodyogeny (research §2.1 / §3) builds two daughters inside each mother, so
 * a vacuole holds 1, 2, 4, 8 … tachyzoites. The daughters stay joined at their
 * posterior ends through the residual body, which is why a mature vacuole is a
 * **rosette**: bodies radiating from a common centre, apical ends outward. Two
 * parasites sit side by side in a narrow V; the fan opens as the count grows
 * and, past a single ring, tilts above and below the equator.
 *
 * Pure geometry in micrometres, relative to the vacuole centre, so the view can
 * draw it and the tests can check it without Three.js.
 */

import { clamp01, lerp, normalizeV, scaleV, vec3, type Vec3 } from '../math'
import { HALF_LENGTH } from './substrateGlide'

/** Gap between a posterior end and the rosette centre (residual body), µm. */
export const RESIDUAL_BODY = 0.45

/** Fraction of a division round over which daughters ease into their own slots. */
const SETTLE = 0.22

export interface ZoitePose {
  /** Body centre, relative to the vacuole centre, µm. */
  offset: Vec3
  /** Apex direction, unit. */
  heading: Vec3
}

/** Angular width of the fan for `n` parasites, radians. */
function fanSpread(n: number): number {
  return Math.min(Math.PI * 2 * (1 - 1 / n), 0.6 * n)
}

/** Elevation above the equator for slot `i` of `n`, radians. */
function elevation(n: number, i: number): number {
  if (n < 8) return 0
  const range = Math.min(1.05, 0.26 * Math.log2(n))
  // golden-ratio sequence: spreads the slots in elevation without clumping
  return range * Math.sin(Math.PI * 2 * ((i * 0.6180339887) % 1))
}

/** Settled pose of slot `i` of `n`, fan centred on angle `axis` (x–z plane). */
export function rosetteSlot(n: number, i: number, axis: number): ZoitePose {
  if (n <= 1) return { offset: vec3(), heading: vec3(Math.cos(axis), 0, Math.sin(axis)) }
  const a = axis + fanSpread(n) * ((i + 0.5) / n - 0.5)
  const e = elevation(n, i)
  const heading = vec3(Math.cos(a) * Math.cos(e), Math.sin(e), Math.sin(a) * Math.cos(e))
  return { offset: scaleV(heading, HALF_LENGTH + RESIDUAL_BODY), heading }
}

/**
 * Pose of parasite `i` while the vacuole holds `n` and the current round is
 * `division` (0–1) complete. Right after a doubling each daughter starts where
 * its mother was (`i >> 1` of `n / 2`) and eases into its own slot, so the
 * rosette never jumps.
 */
export function rosettePose(n: number, i: number, division: number, axis: number): ZoitePose {
  const own = rosetteSlot(n, i, axis)
  const t = clamp01(division / SETTLE)
  if (n < 2 || t >= 1) return own
  const parent = rosetteSlot(n / 2, i >> 1, axis)
  const s = t * t * (3 - 2 * t)
  return {
    offset: vec3(
      lerp(parent.offset.x, own.offset.x, s),
      lerp(parent.offset.y, own.offset.y, s),
      lerp(parent.offset.z, own.offset.z, s),
    ),
    heading: normalizeV(
      vec3(
        lerp(parent.heading.x, own.heading.x, s),
        lerp(parent.heading.y, own.heading.y, s),
        lerp(parent.heading.z, own.heading.z, s),
      ),
    ),
  }
}

/** Radius of a rosette's vacuole once it is past a single parasite, µm. */
const rosetteRadius = (x: number) => 2 * HALF_LENGTH + RESIDUAL_BODY + 0.4 + 0.3 * Math.cbrt(x)

/** Vacuole radius when it holds one tachyzoite, µm. */
export const PV_RADIUS_SINGLE = HALF_LENGTH + 0.6

/**
 * Vacuole radius for an *effective* parasite count `x` (= n · 2^division, so it
 * grows smoothly through a round). Encloses every apex of the rosette.
 */
export function pvRadius(x: number): number {
  if (x <= 1) return PV_RADIUS_SINGLE
  if (x < 2) return lerp(PV_RADIUS_SINGLE, rosetteRadius(2), x - 1)
  return rosetteRadius(x)
}

/** How far the two daughter buds have grown inside a mother, 0–1. */
export function budProgress(division: number): number {
  const t = clamp01((division - 0.4) / 0.6)
  return t * t * (3 - 2 * t)
}
