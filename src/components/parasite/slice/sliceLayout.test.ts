import { describe, expect, it } from 'vitest'
import { CYST_MAX_DIAMETER, CYST_WALL_MAX } from '../../../simulation/parasite/stages'
import { CELL_RADIUS } from '../../../simulation/parasite/world'
import {
  buildLattice,
  CELL_CIRCUMRADIUS_UM,
  CELL_PITCH_UM,
  CELL_ROW_UM,
  CYST_CAPACITY,
  markCellsNear,
  maxLatticeCells,
  MIN_RINGS,
  patchRadiusUm,
  ringsFor,
  slotPosition,
  SLOT_PITCH_UM,
  slotsInRings,
} from './sliceLayout'

describe('host-cell mosaic scale', () => {
  it('uses the sim’s real cell size: a cell is 15 µm across', () => {
    expect(CELL_PITCH_UM).toBe(2 * CELL_RADIUS)
    expect(CELL_PITCH_UM).toBe(15)
  })

  it('tiles regular hexagons: pitch = √3 R, row spacing = 1.5 R', () => {
    expect(CELL_PITCH_UM).toBeCloseTo(Math.sqrt(3) * CELL_CIRCUMRADIUS_UM, 9)
    expect(CELL_ROW_UM).toBeCloseTo(1.5 * CELL_CIRCUMRADIUS_UM, 9)
  })
})

describe('cyst slots', () => {
  it('puts slot 0 at the centre and fills hex rings of 6k', () => {
    expect(slotPosition(0)).toEqual({ x: 0, z: 0 })
    expect(slotsInRings(0)).toBe(1)
    expect(slotsInRings(1)).toBe(7)
    expect(slotsInRings(2)).toBe(19)
    expect(slotsInRings(9)).toBe(271)
  })

  it('finds the rings a count needs', () => {
    expect(ringsFor(0)).toBe(0)
    expect(ringsFor(1)).toBe(0)
    expect(ringsFor(2)).toBe(1)
    expect(ringsFor(7)).toBe(1)
    expect(ringsFor(8)).toBe(2)
    expect(ringsFor(CYST_CAPACITY)).toBe(9)
  })

  it('leaves room for a full-size cyst, wall included, plus a host cell, in every direction', () => {
    expect(SLOT_PITCH_UM).toBeGreaterThanOrEqual(CYST_MAX_DIAMETER + 2 * CYST_WALL_MAX + CELL_PITCH_UM)
    let nearest = Infinity
    const n = slotsInRings(6)
    for (let a = 0; a < n; a++) {
      for (let b = a + 1; b < n; b++) {
        const pa = slotPosition(a)
        const pb = slotPosition(b)
        nearest = Math.min(nearest, Math.hypot(pa.x - pb.x, pa.z - pb.z))
      }
    }
    // neighbours sit exactly one pitch apart — no two slots are closer
    expect(nearest).toBeCloseTo(SLOT_PITCH_UM, 6)
  })

  it('is stable: a slot never moves when the garden grows', () => {
    const before = [0, 1, 7, 18, 40].map(slotPosition)
    slotPosition(CYST_CAPACITY - 1)
    expect([0, 1, 7, 18, 40].map(slotPosition)).toEqual(before)
  })

  it('spirals outwards: each ring is no closer to the centre than the last', () => {
    let lastRing = 0
    for (let k = 1; k <= 5; k++) {
      const first = slotsInRings(k - 1)
      const d = Math.hypot(slotPosition(first).x, slotPosition(first).z)
      expect(d).toBeGreaterThanOrEqual(lastRing - 1e-6)
      lastRing = d
    }
  })
})

describe('patch radius', () => {
  it('always shows tissue, even with no cysts', () => {
    expect(patchRadiusUm(0)).toBe((MIN_RINGS + 0.75) * SLOT_PITCH_UM)
  })

  it('reaches past the outermost slot', () => {
    for (const slots of [1, 8, 20, 64, 200, CYST_CAPACITY]) {
      const outer = slotPosition(slots - 1)
      expect(patchRadiusUm(slots)).toBeGreaterThan(Math.hypot(outer.x, outer.z) + CYST_MAX_DIAMETER / 2)
    }
  })
})

describe('buildLattice', () => {
  it('keeps every cell inside the patch and fills it at the hexagonal density', () => {
    const radius = 300
    const lattice = buildLattice(radius)
    for (let k = 0; k < lattice.count; k++) expect(Math.hypot(lattice.x[k], lattice.z[k])).toBeLessThanOrEqual(radius + 1e-3)
    const cellArea = (Math.sqrt(3) / 2) * CELL_PITCH_UM * CELL_PITCH_UM
    expect(lattice.count).toBeGreaterThan(0.95 * ((Math.PI * radius * radius) / cellArea))
    expect(lattice.count).toBeLessThan(1.05 * ((Math.PI * radius * radius) / cellArea))
  })

  it('has no duplicate cells', () => {
    const lattice = buildLattice(200)
    const seen = new Set<string>()
    for (let k = 0; k < lattice.count; k++) seen.add(`${lattice.x[k].toFixed(3)},${lattice.z[k].toFixed(3)}`)
    expect(seen.size).toBe(lattice.count)
  })

  it('neighbouring cells in a row are one pitch apart and odd rows are offset half a pitch', () => {
    const lattice = buildLattice(120)
    const xAt = (j: number) => {
      const xs: number[] = []
      for (let k = 0; k < lattice.count; k++) if (Math.abs(lattice.z[k] - j * CELL_ROW_UM) < 1e-3) xs.push(lattice.x[k])
      return xs.sort((a, b) => a - b)
    }
    const row0 = xAt(0)
    const row1 = xAt(1)
    expect(row0[1] - row0[0]).toBeCloseTo(CELL_PITCH_UM, 4)
    expect(Math.abs(row0[0] % CELL_PITCH_UM)).toBeLessThan(1e-3)
    expect(Math.abs(row1[0] % CELL_PITCH_UM)).toBeCloseTo(CELL_PITCH_UM / 2, 3)
  })

  it('sizes the buffer for a full garden', () => {
    expect(buildLattice(patchRadiusUm(CYST_CAPACITY)).count).toBe(maxLatticeCells())
    expect(buildLattice(patchRadiusUm(3)).count).toBeLessThan(maxLatticeCells())
  })
})

describe('markCellsNear', () => {
  const lattice = buildLattice(400)

  function brute(cx: number, cz: number, r: number): number[] {
    const out: number[] = []
    for (let k = 0; k < lattice.count; k++) if (Math.hypot(lattice.x[k] - cx, lattice.z[k] - cz) <= r) out.push(k)
    return out
  }

  it('marks exactly the cells a brute-force distance test finds', () => {
    const probes: [number, number, number][] = [
      [0, 0, 35],
      [86, 0, 35],
      [-130.5, 74.5, 20],
      [200, -150, 60],
      [10, 10, 2.5],
      [395, 0, 35], // spills over the edge of the patch
      [0, 0, 0],
    ]
    for (const [cx, cz, r] of probes) {
      const mask = new Uint8Array(lattice.count)
      markCellsNear(lattice, cx, cz, r, mask)
      const marked: number[] = []
      for (let k = 0; k < mask.length; k++) if (mask[k]) marked.push(k)
      expect(marked).toEqual(brute(cx, cz, r))
    }
  })

  it('claims a few dozen cells for a full-size cyst, not the whole mosaic', () => {
    const mask = new Uint8Array(lattice.count)
    markCellsNear(lattice, 0, 0, 35, mask)
    const claimed = mask.reduce((s, v) => s + v, 0)
    expect(claimed).toBeGreaterThan(10)
    expect(claimed).toBeLessThan(60)
  })
})
