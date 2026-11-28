import { describe, expect, it } from 'vitest'
import { Vector3 } from 'three'
import { STAGE_DEFS } from '../../../simulation/parasite/stages'
import {
  allocateBradyzoites,
  BRADYZOITE_LENGTH_UM,
  BRADYZOITE_WIDTH_UM,
  MIN_DRAW_DIAMETER_UM,
  RING_FIT,
  rodLocal,
  rodReach,
  ROD_FLOATS,
  writeRodMatrix,
} from './bradyzoites'
import { bradyzoiteGeometry, CELL_HEIGHT_UM, cellTileGeometry } from './geometry'
import { CELL_CIRCUMRADIUS_UM } from './sliceLayout'
import { cellTriangles, crescentTriangles, SLICE_LOD } from './sliceLod'
import { LOD_TIERS } from '../../../rendering/lod/adaptiveLod'

function pose(cystId: number, k: number): Float32Array {
  const out = new Float32Array(ROD_FLOATS)
  rodLocal(cystId, k, out, 0)
  return out
}

describe('real bradyzoite size', () => {
  it('is 7 × 1.5 µm, straight from the research table', () => {
    expect(BRADYZOITE_LENGTH_UM).toBe(7)
    expect(BRADYZOITE_WIDTH_UM).toBe(1.5)
    expect(BRADYZOITE_LENGTH_UM).toBe(STAGE_DEFS.bradyzoite.length)
    expect(BRADYZOITE_WIDTH_UM).toBe(STAGE_DEFS.bradyzoite.width)
  })

  it('has a mesh that measures 7 µm long and 1.5 µm thick, at every LOD tier', () => {
    for (const tier of LOD_TIERS) {
      const g = bradyzoiteGeometry(SLICE_LOD[tier])
      g.computeBoundingBox()
      const size = g.boundingBox!.getSize(new Vector3())
      expect(size.z).toBeGreaterThan(BRADYZOITE_LENGTH_UM - 0.2)
      expect(size.z).toBeLessThanOrEqual(BRADYZOITE_LENGTH_UM + 1e-6)
      // the body's thickness (Y); a coarse tube undershoots its true radius a little
      expect(size.y).toBeLessThanOrEqual(BRADYZOITE_WIDTH_UM + 1e-6)
      expect(size.y).toBeGreaterThan(BRADYZOITE_WIDTH_UM * 0.6)
      g.dispose()
    }
  })

  it('matches the triangle budget the LOD tiers advertise', () => {
    for (const tier of LOD_TIERS) {
      const g = bradyzoiteGeometry(SLICE_LOD[tier])
      expect(g.index!.count / 3).toBe(crescentTriangles(SLICE_LOD[tier]))
      g.dispose()
    }
  })
})

describe('host-cell tile', () => {
  it('spans a real 15 µm cell (flat to flat) and faces up at every detail level', () => {
    for (const rings of [1, 2] as const) {
      const g = cellTileGeometry(rings)
      g.computeBoundingBox()
      const box = g.boundingBox!
      // pointy-top: flat sides face ±X, so X extent is the 15 µm pitch and Z is the full 2R
      expect(box.max.x - box.min.x).toBeCloseTo(15, 3)
      expect(box.max.z - box.min.z).toBeCloseTo(2 * CELL_CIRCUMRADIUS_UM, 3)
      expect(box.max.y).toBeCloseTo(CELL_HEIGHT_UM, 6)
      expect(g.index!.count / 3).toBe(cellTriangles({ cellRings: rings }))
      const n = g.getAttribute('normal')
      for (let v = 0; v < n.count; v++) expect(n.getY(v)).toBeGreaterThan(0)
      // every triangle winds counter-clockwise seen from above, so it is front-facing there
      const p = g.getAttribute('position')
      const idx = g.index!
      for (let t = 0; t < idx.count; t += 3) {
        const [a, b, c] = [idx.getX(t), idx.getX(t + 1), idx.getX(t + 2)]
        const ux = p.getX(b) - p.getX(a)
        const uz = p.getZ(b) - p.getZ(a)
        const vx = p.getX(c) - p.getX(a)
        const vz = p.getZ(c) - p.getZ(a)
        expect(uz * vx - ux * vz).toBeGreaterThan(0) // the Y component of u × v
      }
      g.dispose()
    }
  })
})

describe('allocateBradyzoites', () => {
  const out = new Uint32Array(8)

  it('draws every bradyzoite when the budget allows', () => {
    const drawn = allocateBradyzoites([10, 300, 1024, 0], 4, 20_000, out)
    expect(Array.from(out.subarray(0, 4))).toEqual([10, 300, 1024, 0])
    expect(drawn).toBe(1334)
  })

  it('scales every cyst by the same factor when over budget, and never exceeds it', () => {
    const eligible = [1024, 512, 256, 64]
    const drawn = allocateBradyzoites(eligible, 4, 930, out) // total 1856 → factor 0.501…
    expect(drawn).toBeLessThanOrEqual(930)
    expect(drawn).toBeGreaterThan(930 - eligible.length)
    const factor = 930 / 1856
    eligible.forEach((n, i) => expect(out[i]).toBe(Math.floor(n * factor)))
    expect(out[0]).toBeGreaterThan(out[1])
    expect(out[1]).toBeGreaterThan(out[2])
  })

  it('draws nothing under a zero budget and does not divide by zero on an empty garden', () => {
    expect(allocateBradyzoites([100, 200], 2, 0, out)).toBe(0)
    expect(allocateBradyzoites([], 0, 100, out)).toBe(0)
  })
})

describe('rod placement', () => {
  it('is a pure function of (cyst, rod): same inputs, same pose', () => {
    expect(Array.from(pose(42, 7))).toEqual(Array.from(pose(42, 7)))
    expect(Array.from(pose(42, 7))).not.toEqual(Array.from(pose(42, 8)))
    expect(Array.from(pose(42, 7))).not.toEqual(Array.from(pose(43, 7)))
  })

  it('does not depend on how many rods are drawn: the first k poses never change', () => {
    const first = Array.from({ length: 20 }, (_, k) => Array.from(pose(9, k)))
    const again = Array.from({ length: 500 }, (_, k) => Array.from(pose(9, k)))
    expect(again.slice(0, 20)).toEqual(first)
  })

  it('gives each rod a right-handed orthonormal frame, so nothing renders mirrored', () => {
    for (let k = 0; k < 300; k++) {
      const p = pose(5, k)
      const [x, y, z] = [p.subarray(3, 6), p.subarray(6, 9), p.subarray(9, 12)]
      const dot = (a: Float32Array, b: Float32Array) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
      expect(dot(x, x)).toBeCloseTo(1, 5)
      expect(dot(y, y)).toBeCloseTo(1, 5)
      expect(dot(z, z)).toBeCloseTo(1, 5)
      expect(dot(x, y)).toBeCloseTo(0, 5)
      expect(dot(x, z)).toBeCloseTo(0, 5)
      // x × y = z
      expect(x[1] * y[2] - x[2] * y[1]).toBeCloseTo(z[0], 5)
      expect(x[2] * y[0] - x[0] * y[2]).toBeCloseTo(z[1], 5)
      expect(x[0] * y[1] - x[1] * y[0]).toBeCloseTo(z[2], 5)
    }
  })

  it('scatters points through the whole unit ball (uniform in volume)', () => {
    const n = 4000
    let inner = 0
    let up = 0
    for (let k = 0; k < n; k++) {
      const p = pose(11, k)
      const r = Math.hypot(p[0], p[1], p[2])
      expect(r).toBeLessThanOrEqual(1 + 1e-6)
      if (r < 0.5) inner++ // half the radius holds one eighth of the volume
      if (p[1] > 0) up++
    }
    expect(inner / n).toBeGreaterThan(0.1)
    expect(inner / n).toBeLessThan(0.15)
    expect(up / n).toBeGreaterThan(0.47)
    expect(up / n).toBeLessThan(0.53)
  })

  it('keeps both ends of every rod inside the cyst wall at every size that draws rods', () => {
    const half = BRADYZOITE_LENGTH_UM / 2
    for (const diameter of [MIN_DRAW_DIAMETER_UM, 20, 35, 52, 70]) {
      const R = diameter / 2
      const reach = rodReach(R)
      for (let k = 0; k < 600; k++) {
        const p = pose(3, k)
        const cx = reach * p[0]
        const cy = reach * p[1]
        const cz = reach * p[2]
        for (const end of [-half, half]) {
          const ex = cx + end * p[9]
          const ey = cy + end * p[10]
          const ez = cz + end * p[11]
          expect(Math.hypot(ex, ey, ez)).toBeLessThanOrEqual(RING_FIT * R + 1e-4)
        }
      }
    }
  })

  it('has room for rods in a 12 µm cyst, and none in a 5 µm one', () => {
    expect(rodReach(MIN_DRAW_DIAMETER_UM / 2)).toBeGreaterThan(1)
    expect(rodReach(2.5)).toBe(0)
  })

  it('writes a column-major instance matrix: frame in columns 0–2, centre in column 3', () => {
    const local = pose(1, 1)
    const m = new Float32Array(32)
    writeRodMatrix(m, 16, local, 0, 5, 6, 7)
    expect(Array.from(m.subarray(16, 20))).toEqual([local[3], local[4], local[5], 0])
    expect(Array.from(m.subarray(24, 28))).toEqual([local[9], local[10], local[11], 0])
    expect(Array.from(m.subarray(28, 32))).toEqual([5, 6, 7, 1])
    expect(Array.from(m.subarray(0, 16)).every((v) => v === 0)).toBe(true)
  })
})
