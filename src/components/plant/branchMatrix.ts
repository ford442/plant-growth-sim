/**
 * Branches as instanced cylinders.
 *
 * Every segment is one instance of a shared unit cylinder (radius 1, height 1,
 * base at the origin, axis +Y — see `branchGeometry`). `writeBranchMatrix` turns
 * a segment's start, end and thickness into that instance's matrix:
 *
 *   x, z columns = two unit vectors ⟂ the segment, × radius
 *   y column     = the segment direction × its (padded) length
 *   translation  = the (padded) start
 *
 * Like `leafMatrix.ts` this is hand-expanded rather than composed through an
 * Object3D, because the morph re-poses every segment every frame (up to ~78k on
 * bamboo at full development). A frame writes 16 floats per segment into an
 * existing buffer and allocates nothing; the geometry is never rebuilt.
 */

/**
 * Stem radius as a fraction of the interpreter's `thickness`. Species presets
 * give thickness as the stem's width (sunflower 0.08 against a 0.35 segment).
 */
export const RADIUS_PER_THICKNESS = 0.5

/**
 * Each cylinder overhangs its two ends by this many radii. Cylinders are
 * independent, so without it the outside of every bend would open a wedge-shaped
 * gap; with it the neighbours overlap across the joint. Collinear neighbours
 * overlap on their own surface, which is invisible.
 */
export const JOINT_OVERLAP = 0.5

/**
 * Write one branch segment's instance matrix (column-major, 16 floats at `o`).
 * A segment of zero thickness or zero length collapses to a point (the matrix is
 * singular but finite), which is what a growing twig starts as.
 */
export function writeBranchMatrix(
  out: Float32Array,
  o: number,
  sx: number,
  sy: number,
  sz: number,
  ex: number,
  ey: number,
  ez: number,
  radius: number
): void {
  let dx = ex - sx
  let dy = ey - sy
  let dz = ez - sz
  const len = Math.sqrt(dx * dx + dy * dy + dz * dz)
  if (len > 1e-9) {
    dx /= len
    dy /= len
    dz /= len
  } else {
    dx = 0
    dy = 1
    dz = 0
  }

  // x ⟂ d: up × d, or +X when d is (anti)parallel to up. The roll about the axis
  // is irrelevant for a cylinder, so it needs no continuity between frames.
  let xx = dz
  let xz = -dx
  const xl = Math.sqrt(xx * xx + xz * xz)
  if (xl > 1e-6) {
    xx /= xl
    xz /= xl
  } else {
    xx = 1
    xz = 0
  }
  // z = x × d (right-handed, so the winding and normals stay outward); x has no Y part
  const zx = -xz * dy
  const zy = xz * dx - xx * dz
  const zz = xx * dy

  const pad = radius * JOINT_OVERLAP
  const h = len + 2 * pad

  out[o] = xx * radius
  out[o + 1] = 0
  out[o + 2] = xz * radius
  out[o + 3] = 0
  out[o + 4] = dx * h
  out[o + 5] = dy * h
  out[o + 6] = dz * h
  out[o + 7] = 0
  out[o + 8] = zx * radius
  out[o + 9] = zy * radius
  out[o + 10] = zz * radius
  out[o + 11] = 0
  out[o + 12] = sx - dx * pad
  out[o + 13] = sy - dy * pad
  out[o + 14] = sz - dz * pad
  out[o + 15] = 1
}

/**
 * Turn a branch pose into instance matrices: `pos` is 6 floats per segment
 * (start, end — `sampleSegments`), `thickness` one per segment (`sampleThickness`).
 */
export function writeBranchMatrices(
  pos: Float32Array,
  thickness: Float32Array,
  count: number,
  out: Float32Array
): void {
  for (let i = 0; i < count; i++) {
    const p = i * 6
    writeBranchMatrix(
      out,
      i * 16,
      pos[p],
      pos[p + 1],
      pos[p + 2],
      pos[p + 3],
      pos[p + 4],
      pos[p + 5],
      thickness[i] * RADIUS_PER_THICKNESS
    )
  }
}

/** Cross-section detail of the shared cylinder. */
export interface BranchDetail {
  radialSegments: number
  /** Flat end caps; left off on dense plants where a cap is sub-pixel and the overlap hides the joint. */
  capped: boolean
}

/**
 * Segment budget: the cylinder gets coarser as a plant gets denser, so the
 * triangle count stays under ~0.65 M from a 38-segment seedling to bamboo's 78k
 * (the worst case, at the final iteration). Segments are overlapping pieces of a thin stem at that point, so
 * the faceting is not visible.
 */
export function branchDetail(segmentCount: number): BranchDetail {
  if (segmentCount <= 3000) return { radialSegments: 10, capped: true } // ≤ 40 tris each
  if (segmentCount <= 15000) return { radialSegments: 6, capped: true } // 24
  if (segmentCount <= 30000) return { radialSegments: 5, capped: false } // 10
  return { radialSegments: 4, capped: false } // 8
}
