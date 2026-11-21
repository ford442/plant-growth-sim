import * as THREE from 'three'
import { type LeafShape, type LeafSpec } from '../../simulation/LSystem'

/**
 * The leaf blade every instance of a species shares.
 *
 * Standing on the origin along +Y (base at y = 0, tip at y = `LEAF_LENGTH`), upper
 * face towards +Z, so `writeLeafMatrix` can turn it with a plain basis. It is a
 * strip of `rows` quads along the blade with three vertices per row — left edge,
 * midrib, right edge — which lets it carry what a flat plane cannot: an outline
 * (the width profile), a V-fold along the midrib and a drooping tip. UVs run
 * u = 0 … 1 across (midrib at 0.5) and v = 0 … 1 base → tip, which is what the TSL
 * leaf material draws its veins and flutter from.
 */

/** Blade length, in leaf-local units. (The old flat plane was 1 × 1.4; sizes keep that meaning.) */
export const LEAF_LENGTH = 1.4

/** Most triangles the foliage of one plant may cost: the blade is simplified past this. */
export const LEAF_TRIANGLE_BUDGET = 200_000
export const MAX_LEAF_ROWS = 8
export const MIN_LEAF_ROWS = 2

/**
 * Rows per blade for `leafCount` leaves, so dense foliage (bamboo reaches tens of
 * thousands of leaves) stays under {@link LEAF_TRIANGLE_BUDGET} while a sparse plant
 * gets enough rows to show its outline. A row is 4 triangles.
 */
export function leafRows(leafCount: number): number {
  const rows = Math.floor(LEAF_TRIANGLE_BUDGET / (4 * Math.max(1, leafCount)))
  return Math.max(MIN_LEAF_ROWS, Math.min(MAX_LEAF_ROWS, rows))
}

const clamp01 = (x: number) => (x < 0 ? 0 : x > 1 ? 1 : x)

/**
 * Blade width at `s` ∈ [0, 1] (base → tip) as a fraction of its widest point.
 * 0 at the base and tip for every shape, so a blade always closes to a point there.
 */
export function leafProfile(shape: LeafShape, s: number): number {
  const t = clamp01(s)
  switch (shape) {
    case 'ovate': // widest a little below the middle, pointed tip
      return Math.pow(Math.sin(Math.PI * Math.pow(t, 0.75)), 0.9)
    case 'heart': // broad at the base, tapering to a drawn-out tip
      return Math.pow(Math.sin(Math.PI * Math.pow(t, 0.55)), 0.8)
    case 'lanceolate': // narrow, widest near the base
      return Math.pow(Math.sin(Math.PI * Math.pow(t, 0.8)), 0.85)
    case 'lobed': // an ovate blade with three pairs of rounded lobes
      return Math.pow(Math.sin(Math.PI * Math.pow(t, 0.8)), 0.8) * (0.72 + 0.28 * Math.cos(Math.PI * 6 * t - Math.PI * 0.6))
    case 'pinnate': // narrow frond whose margin is cut into pinnae
      return Math.pow(Math.sin(Math.PI * Math.pow(t, 0.7)), 0.8) * (0.5 + 0.5 * Math.abs(Math.sin(Math.PI * 7 * t)))
  }
}

export interface LeafBuffers {
  /** x, y, z per vertex. */
  positions: Float32Array
  /** u, v per vertex. */
  uvs: Float32Array
  indices: Uint16Array
  rows: number
}

/** The blade as plain arrays (no three.js), so the shape can be tested directly. */
export function buildLeafBuffers(spec: Pick<LeafSpec, 'shape' | 'aspect' | 'fold' | 'curl'>, rows: number): LeafBuffers {
  const n = Math.max(MIN_LEAF_ROWS, Math.floor(rows))
  const width = LEAF_LENGTH / Math.max(0.2, spec.aspect)
  const positions = new Float32Array((n + 1) * 3 * 3)
  const uvs = new Float32Array((n + 1) * 3 * 2)
  const indices = new Uint16Array(n * 4 * 3)

  for (let r = 0; r <= n; r++) {
    const s = r / n
    const half = (leafProfile(spec.shape, s) * width) / 2
    const y = s * LEAF_LENGTH
    // the whole blade droops towards the tip; the edges fold down from the midrib
    const droop = -spec.curl * LEAF_LENGTH * s * s
    const edge = droop - spec.fold * half
    const v = r * 3
    positions.set([-half, y, edge, 0, y, droop, half, y, edge], v * 3)
    uvs.set([0, s, 0.5, s, 1, s], v * 2)
  }

  let k = 0
  for (let r = 0; r < n; r++) {
    const a = r * 3 // left, mid, right of this row; a + 3 … on the next
    const b = a + 3
    indices.set([a, a + 1, b, a + 1, b + 1, b], k)
    indices.set([a + 1, a + 2, b + 1, a + 2, b + 2, b + 1], k + 6)
    k += 12
  }
  return { positions, uvs, indices, rows: n }
}

export function createLeafGeometry(spec: Pick<LeafSpec, 'shape' | 'aspect' | 'fold' | 'curl'>, rows: number): THREE.BufferGeometry {
  const { positions, uvs, indices } = buildLeafBuffers(spec, rows)
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.BufferAttribute(positions, 3))
  g.setAttribute('uv', new THREE.BufferAttribute(uvs, 2))
  g.setIndex(new THREE.BufferAttribute(indices, 1))
  g.computeVertexNormals()
  fillCollapsedNormals(g.getAttribute('normal') as THREE.BufferAttribute, rows)
  return g
}

/**
 * The base and tip rows collapse to a point (the profile is 0 there), so every
 * triangle around those vertices has no area and `computeVertexNormals` leaves
 * them with no normal — the ends of the blade would shade black. Give each the
 * normal of its neighbour one row in.
 */
function fillCollapsedNormals(normals: THREE.BufferAttribute, rows: number): void {
  const n = Math.max(MIN_LEAF_ROWS, Math.floor(rows))
  const copy = (to: number, from: number) => normals.setXYZ(to, normals.getX(from), normals.getY(from), normals.getZ(from))
  for (let c = 0; c < 3; c++) {
    copy(c, 3 + 1) // base row ← the midrib one row up (all three vertices are one point)
    copy(n * 3 + c, (n - 1) * 3 + 1)
  }
  normals.needsUpdate = true
}
