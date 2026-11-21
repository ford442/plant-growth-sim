import { describe, expect, it } from 'vitest'
import {
  LEAF_LENGTH,
  LEAF_TRIANGLE_BUDGET,
  MAX_LEAF_ROWS,
  MIN_LEAF_ROWS,
  buildLeafBuffers,
  createLeafGeometry,
  leafProfile,
  leafRows,
} from './leafGeometry'
import { SPECIES_LSYSTEMS, leafSpec, type LeafShape } from '../../simulation/LSystem'

const SHAPES: LeafShape[] = ['ovate', 'heart', 'lanceolate', 'lobed', 'pinnate']

describe('leafProfile', () => {
  it.each(SHAPES)('%s closes to a point at base and tip and stays within [0, 1]', (shape) => {
    expect(leafProfile(shape, 0)).toBeCloseTo(0, 6)
    expect(leafProfile(shape, 1)).toBeCloseTo(0, 6)
    let widest = 0
    for (let i = 0; i <= 200; i++) {
      const w = leafProfile(shape, i / 200)
      expect(w).toBeGreaterThanOrEqual(0)
      expect(w).toBeLessThanOrEqual(1.0001)
      widest = Math.max(widest, w)
    }
    expect(widest).toBeGreaterThan(0.6) // a real blade, not a sliver
  })

  it('the cut shapes are cut: lobed and pinnate margins are not smooth', () => {
    const wiggles = (shape: LeafShape) => {
      let turns = 0
      let prev = leafProfile(shape, 0.05) - leafProfile(shape, 0)
      for (let i = 2; i <= 200; i++) {
        const d = leafProfile(shape, i / 200) - leafProfile(shape, (i - 1) / 200)
        if (Math.sign(d) !== Math.sign(prev) && d !== 0) turns++
        prev = d
      }
      return turns
    }
    expect(wiggles('ovate')).toBeLessThanOrEqual(1)
    expect(wiggles('lobed')).toBeGreaterThanOrEqual(4)
    expect(wiggles('pinnate')).toBeGreaterThanOrEqual(8)
  })
})

describe('leafRows', () => {
  it('gives sparse plants the full blade and dense ones a simpler one, within the triangle budget', () => {
    expect(leafRows(9)).toBe(MAX_LEAF_ROWS)
    expect(leafRows(2187)).toBe(MAX_LEAF_ROWS)
    for (const count of [5_000, 10_000, 16_384, 25_000]) {
      const rows = leafRows(count)
      expect(rows).toBeGreaterThanOrEqual(MIN_LEAF_ROWS)
      expect(count * rows * 4).toBeLessThanOrEqual(LEAF_TRIANGLE_BUDGET)
    }
    expect(leafRows(39_063)).toBe(MIN_LEAF_ROWS) // bamboo at the last iteration: cannot go lower
    expect(leafRows(0)).toBe(MAX_LEAF_ROWS)
    // monotone: more leaves never buy a more detailed blade
    let last = Infinity
    for (let n = 1; n < 60_000; n += 997) {
      const r = leafRows(n)
      expect(r).toBeLessThanOrEqual(last)
      last = r
    }
  })
})

describe('buildLeafBuffers', () => {
  const spec = leafSpec(SPECIES_LSYSTEMS.oak)

  it('is a closed strip: counts, indices in range, UVs spanning the blade', () => {
    for (const rows of [MIN_LEAF_ROWS, 5, MAX_LEAF_ROWS]) {
      const b = buildLeafBuffers(spec, rows)
      const verts = (rows + 1) * 3
      expect(b.positions.length).toBe(verts * 3)
      expect(b.uvs.length).toBe(verts * 2)
      expect(b.indices.length).toBe(rows * 4 * 3)
      expect(Math.max(...b.indices)).toBe(verts - 1)
      expect(Math.min(...b.indices)).toBe(0)
      expect(Math.min(...b.uvs)).toBe(0)
      expect(Math.max(...b.uvs)).toBe(1)
    }
  })

  it('stands on the origin along +Y and is as long as LEAF_LENGTH', () => {
    const b = buildLeafBuffers(spec, 6)
    let ymin = Infinity
    let ymax = -Infinity
    for (let i = 1; i < b.positions.length; i += 3) {
      ymin = Math.min(ymin, b.positions[i])
      ymax = Math.max(ymax, b.positions[i])
    }
    expect(ymin).toBeCloseTo(0, 6)
    expect(ymax).toBeCloseTo(LEAF_LENGTH, 5)
    for (const c of b.positions.slice(0, 3)) expect(c).toBeCloseTo(0, 9) // base vertex: the attachment point
  })

  it('is as wide as its aspect says, and symmetric about the midrib', () => {
    const wide = buildLeafBuffers({ ...spec, shape: 'ovate', aspect: 1, fold: 0, curl: 0 }, 8)
    const slim = buildLeafBuffers({ ...spec, shape: 'ovate', aspect: 4, fold: 0, curl: 0 }, 8)
    const span = (b: ReturnType<typeof buildLeafBuffers>) => {
      let lo = Infinity
      let hi = -Infinity
      for (let i = 0; i < b.positions.length; i += 3) {
        lo = Math.min(lo, b.positions[i])
        hi = Math.max(hi, b.positions[i])
      }
      expect(lo).toBeCloseTo(-hi, 6)
      return hi - lo
    }
    expect(span(wide) / span(slim)).toBeGreaterThan(3)
    expect(span(slim)).toBeLessThan(LEAF_LENGTH / 4 + 1e-6)
  })

  it('folds the edges down from the midrib and droops the tip, on the side away from the light', () => {
    const flat = buildLeafBuffers({ ...spec, fold: 0, curl: 0 }, 6)
    const bent = buildLeafBuffers({ ...spec, fold: 0.3, curl: 0.25 }, 6)
    for (let i = 2; i < flat.positions.length; i += 3) expect(flat.positions[i]).toBeCloseTo(0, 9)
    const z = (b: ReturnType<typeof buildLeafBuffers>, row: number, col: number) => b.positions[(row * 3 + col) * 3 + 2]
    expect(z(bent, 3, 0)).toBeLessThan(z(bent, 3, 1)) // edge below midrib
    expect(z(bent, 3, 2)).toBeCloseTo(z(bent, 3, 0), 6)
    expect(z(bent, 6, 1)).toBeLessThan(z(bent, 2, 1)) // tip lower than the base
    expect(z(bent, 6, 1)).toBeCloseTo(-0.25 * LEAF_LENGTH, 5)
  })

  it('winds every triangle so its face looks along +Z, the upper face', () => {
    for (const shape of SHAPES) {
      const b = buildLeafBuffers({ ...spec, shape, fold: 0, curl: 0 }, 6)
      let counted = 0
      for (let t = 0; t < b.indices.length; t += 3) {
        const p = [0, 1, 2].map((k) => Array.from(b.positions.slice(b.indices[t + k] * 3, b.indices[t + k] * 3 + 3)))
        const e1 = [p[1][0] - p[0][0], p[1][1] - p[0][1]]
        const e2 = [p[2][0] - p[0][0], p[2][1] - p[0][1]]
        const nz = e1[0] * e2[1] - e1[1] * e2[0]
        expect(nz).toBeGreaterThanOrEqual(-1e-9) // never wound the wrong way (zero = collapsed at base or tip)
        if (nz > 1e-9) counted++
      }
      expect(counted).toBeGreaterThan(0)
    }
  })
})

describe('createLeafGeometry', () => {
  it('produces an indexed geometry with position, uv and unit normals facing the upper side', () => {
    const g = createLeafGeometry(leafSpec(SPECIES_LSYSTEMS.sunflower), 6)
    expect(g.getAttribute('position').count).toBe(21)
    expect(g.getAttribute('uv').count).toBe(21)
    expect(g.index!.count).toBe(6 * 4 * 3)
    const n = g.getAttribute('normal')
    for (let i = 0; i < n.count; i++) {
      expect(Math.hypot(n.getX(i), n.getY(i), n.getZ(i))).toBeGreaterThan(0.99)
      expect(n.getZ(i)).toBeGreaterThan(0)
    }
    g.dispose()
  })
})
