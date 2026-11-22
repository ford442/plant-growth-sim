/**
 * Where things sit on the tissue slice. Pure, deterministic, in micrometres.
 *
 * The slice is a flat patch of tissue (the XZ plane, Y up). It has two layouts:
 *
 *  - **Host cells**: a hexagonal mosaic at the sim's real cell size
 *    (`2 × CELL_RADIUS` = 15 µm), purely a backdrop — the sim tracks 24 cells in
 *    a 3-D volume, which is not a section, so the mosaic is not per-cell state.
 *  - **Cyst slots**: a hex spiral of plots, each wide enough for a full-size
 *    70 µm cyst. A cyst's slot is its index in `world.cysts`, which is
 *    append-only within a run, so a cyst never moves once it has appeared and
 *    growth never shoves a neighbour. (The sim's own `cyst.pos` cannot be used:
 *    64 cysts up to 70 µm do not fit in its 55 µm-radius sphere.)
 */

import { CELL_RADIUS } from '../../../simulation/parasite/world'
import { CYST_MAX_DIAMETER, CYST_WALL_MAX } from '../../../simulation/parasite/stages'

/** Host-cell centre-to-centre distance, µm: the sim's cell diameter. */
export const CELL_PITCH_UM = 2 * CELL_RADIUS
/** Hexagon circumradius for that pitch (pointy-top tiling). */
export const CELL_CIRCUMRADIUS_UM = CELL_PITCH_UM / Math.sqrt(3)
/** Vertical distance between mosaic rows. */
export const CELL_ROW_UM = 1.5 * CELL_CIRCUMRADIUS_UM
/** Tile scale inside its hexagon, so a dark gap of intercellular matrix shows between cells. */
export const CELL_FILL = 0.9

/**
 * Distance between neighbouring cyst slots: a full-size cyst with its wall, plus
 * one host cell's width of tissue so neighbours never touch.
 */
export const SLOT_PITCH_UM = CYST_MAX_DIAMETER + 2 * CYST_WALL_MAX + CELL_PITCH_UM

/** Slots the garden can show. The sim currently caps at `MAX_CYSTS` (64); the stress test goes to 200. */
export const CYST_CAPACITY = 256

/** The patch always shows at least this many slot rings, so an empty slice still reads as tissue. */
export const MIN_RINGS = 2

// ---------------------------------------------------------------------------
// Cyst slots (hex spiral)
// ---------------------------------------------------------------------------

/** Axial neighbour offsets, in the order a ring is walked. */
const AXIAL_DIRECTIONS: readonly (readonly [number, number])[] = [
  [1, 0],
  [1, -1],
  [0, -1],
  [-1, 0],
  [-1, 1],
  [0, 1],
]

/** Slots in a hex spiral of `rings` full rings around the centre. */
export const slotsInRings = (rings: number) => 1 + 3 * rings * (rings + 1)

/** Smallest number of rings that holds `slots` slots. */
export function ringsFor(slots: number): number {
  let rings = 0
  while (slotsInRings(rings) < slots) rings++
  return rings
}

const slotTable: { x: number; z: number }[] = [{ x: 0, z: 0 }]
let slotRings = 0

/** Extend the spiral table one ring at a time (rings are 6k slots, walked side by side). */
function growSlotTable(untilSlots: number): void {
  while (slotTable.length < untilSlots) {
    slotRings++
    let q = -slotRings
    let r = slotRings
    for (const [dq, dr] of AXIAL_DIRECTIONS) {
      for (let step = 0; step < slotRings; step++) {
        slotTable.push({ x: SLOT_PITCH_UM * (q + r / 2), z: SLOT_PITCH_UM * r * (Math.sqrt(3) / 2) })
        q += dq
        r += dr
      }
    }
  }
}

/** Centre of cyst slot `index`, µm. Slot 0 is the middle; later slots spiral outwards. */
export function slotPosition(index: number): { x: number; z: number } {
  growSlotTable(index + 1)
  return slotTable[index]
}

// ---------------------------------------------------------------------------
// Host-cell mosaic
// ---------------------------------------------------------------------------

/** Radius of the tissue patch that surrounds `slots` cyst slots, µm. */
export function patchRadiusUm(slots: number): number {
  return (Math.max(MIN_RINGS, ringsFor(slots)) + 0.75) * SLOT_PITCH_UM
}

export interface Lattice {
  /** The patch radius this mosaic was cut to, µm. */
  radius: number
  count: number
  /** Cell centres, µm. */
  x: Float32Array
  z: Float32Array
  /** Row and column bounds, for `markCellsNear`. */
  rowMin: number
  rowMax: number
  colMin: number
  colMax: number
  /** `grid[(row - rowMin) * width + (col - colMin)]` is the cell's index, or −1. */
  grid: Int32Array
}

/** Centre x of the cell at column `i`, row `j` (odd rows sit half a cell over). */
const cellX = (i: number, j: number) => (i + 0.5 * (j & 1)) * CELL_PITCH_UM

export function buildLattice(radius: number): Lattice {
  const rowMax = Math.ceil(radius / CELL_ROW_UM)
  const colMax = Math.ceil(radius / CELL_PITCH_UM) + 1
  const rowMin = -rowMax
  const colMin = -colMax
  const width = colMax - colMin + 1
  const grid = new Int32Array((rowMax - rowMin + 1) * width).fill(-1)
  const xs: number[] = []
  const zs: number[] = []
  const r2 = radius * radius
  for (let j = rowMin; j <= rowMax; j++) {
    const z = j * CELL_ROW_UM
    for (let i = colMin; i <= colMax; i++) {
      const x = cellX(i, j)
      if (x * x + z * z > r2) continue
      grid[(j - rowMin) * width + (i - colMin)] = xs.length
      xs.push(x)
      zs.push(z)
    }
  }
  return { radius, count: xs.length, x: Float32Array.from(xs), z: Float32Array.from(zs), rowMin, rowMax, colMin, colMax, grid }
}

/**
 * Sets `mask[k] = 1` for every cell whose centre is within `radius` of
 * (`cx`, `cz`). Walks only the rows and columns the circle can touch, so a
 * 70 µm cyst visits a few dozen cells rather than the whole mosaic.
 */
export function markCellsNear(lattice: Lattice, cx: number, cz: number, radius: number, mask: Uint8Array): void {
  const width = lattice.colMax - lattice.colMin + 1
  const r2 = radius * radius
  const j0 = Math.max(lattice.rowMin, Math.floor((cz - radius) / CELL_ROW_UM))
  const j1 = Math.min(lattice.rowMax, Math.ceil((cz + radius) / CELL_ROW_UM))
  for (let j = j0; j <= j1; j++) {
    const z = j * CELL_ROW_UM
    const dz = z - cz
    if (dz * dz > r2) continue
    const shift = 0.5 * (j & 1)
    const i0 = Math.max(lattice.colMin, Math.floor((cx - radius) / CELL_PITCH_UM - shift))
    const i1 = Math.min(lattice.colMax, Math.ceil((cx + radius) / CELL_PITCH_UM - shift))
    for (let i = i0; i <= i1; i++) {
      const k = lattice.grid[(j - lattice.rowMin) * width + (i - lattice.colMin)]
      if (k < 0) continue
      const dx = (i + shift) * CELL_PITCH_UM - cx
      if (dx * dx + dz * dz <= r2) mask[k] = 1
    }
  }
}

/** Largest mosaic the slice ever draws (a full `CYST_CAPACITY` garden), for buffer sizing. */
let maxCells = 0
export function maxLatticeCells(): number {
  if (maxCells === 0) maxCells = buildLattice(patchRadiusUm(CYST_CAPACITY)).count
  return maxCells
}
