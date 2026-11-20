import { rand } from '../../simulation/CrystalGrowth'
import { smoothstep } from '../../simulation/color'
import { CELL_H, CELL_W, cellX, cellZ, SOIL_CELLS, SOIL_COLS, SOIL_ROWS, SOIL_WIDTH } from '../../simulation/SoilField'
import type { PosedRoots, RootSegment } from './rootSkeleton'

/**
 * Water on its way through the plant, as particles: soil → root → stem.
 *
 * Each particle is a parcel of the water the roots are drawing right now.
 *  1. It starts in a soil cell chosen in proportion to the sim's per-cell
 *     uptake (`SoilState.uptakeField`), so it leaves the wet, root-dense soil
 *     and not the dry or empty soil, and drifts to the root surface.
 *  2. It then follows the drawn root back to the stem base along the skeleton's
 *     parent chain — laterals merge into the main root, so the stream thickens
 *     towards the stem like the real flux does.
 *  3. At the stem base it rises up the stem and hands off to the canopy.
 *
 * Particles are spawned at a rate proportional to the total uptake and move at
 * fixed visual speeds, so *density* shows the flux: drought, night or a
 * hardpan thins the stream, rain after a drought thickens it again.
 *
 * Pure — no Three.js, no clock: the view calls `step(dt)`, and dt = 0 (paused)
 * changes nothing. The view reads `x` / `y` (metres in the slice plane, up is
 * positive) and `fade` per live particle.
 */

export const FLOW = {
  /** Particles per second per mm/day of total uptake. */
  perUnit: 3,
  /** Upper bound on the spawn rate (particles per second), so the pool never starves. */
  maxRate: 200,
  /** Seconds for a parcel to drift from its pore to the root surface. */
  soilTime: 0.55,
  /** Visual speed along the roots, m/s. */
  rootSpeed: 0.75,
  /** Visual speed up the stem, m/s. */
  stemSpeed: 0.9,
  /** Height over which a parcel centres itself on the stem after leaving the root, m. */
  collar: 0.3,
} as const

export const PHASE_FREE = 0
export const PHASE_SOIL = 1
export const PHASE_ROOT = 2
export const PHASE_STEM = 3

/** Cheapest sensible bound on spawns per `step`, so a long frame cannot dump the whole pool at once. */
const MAX_SPAWN_PER_STEP = 40
const MIN_WEIGHT = 1e-4 // mm/day below which a cell does not emit

const cellOf = (x: number, z: number) =>
  Math.max(0, Math.min(SOIL_ROWS - 1, Math.floor(z / CELL_H))) * SOIL_COLS +
  Math.max(0, Math.min(SOIL_COLS - 1, Math.floor((x + SOIL_WIDTH / 2) / CELL_W)))

export class WaterFlow {
  readonly capacity: number
  readonly phase: Uint8Array
  /** Position in the slice plane, metres: x across, y up (soil is negative). */
  readonly x: Float32Array
  readonly y: Float32Array
  /** 0–1 size/alpha envelope: grows in from the pore, thins out at the top of the stem. */
  readonly fade: Float32Array
  /** Fixed 0–1 per-slot random, for the view's depth offset and size variation. */
  readonly jit: Float32Array
  /** Particles spawned / delivered to the stem base since creation (for readouts and tests). */
  spawned = 0
  delivered = 0
  /** Live particles after the last `step`. */
  alive = 0
  /** Particles per second the current sources ask for (before the pool cap). */
  rate = 0

  private readonly parent: Int32Array
  private readonly seg: Int32Array
  private readonly s: Float32Array // along the segment: 1 = tip end … 0 = stem end
  private readonly ax: Float32Array // soil start, m
  private readonly az: Float32Array // soil start depth, m (positive down)
  private readonly k: Float32Array // soil-phase progress 0–1
  private readonly h: Float32Array // height risen in the stem, m
  private readonly hx: Float32Array // where the root met the stem base
  private readonly hz: Float32Array

  private rng: number
  private carry = 0
  private cursor = 0
  // weighted emitters: (soil cell, root segment) pairs with a running total of uptake
  private srcCell: number[] = []
  private srcSeg: number[] = []
  private srcCum: number[] = []
  private total = 0

  constructor(skeleton: readonly RootSegment[], capacity = 1200, seed = 7) {
    this.capacity = capacity
    this.phase = new Uint8Array(capacity)
    this.x = new Float32Array(capacity)
    this.y = new Float32Array(capacity)
    this.fade = new Float32Array(capacity)
    this.jit = new Float32Array(capacity)
    this.seg = new Int32Array(capacity)
    this.s = new Float32Array(capacity)
    this.ax = new Float32Array(capacity)
    this.az = new Float32Array(capacity)
    this.k = new Float32Array(capacity)
    this.h = new Float32Array(capacity)
    this.hx = new Float32Array(capacity)
    this.hz = new Float32Array(capacity)
    this.parent = Int32Array.from(skeleton, (seg) => seg.parent)
    this.rng = seed >>> 0
    for (let i = 0; i < capacity; i++) this.jit[i] = this.rnd()
  }

  private rnd(): number {
    const [u, next] = rand(this.rng)
    this.rng = next
    return u
  }

  /**
   * Re-aim the emitters at the current sink map. A cell's uptake is shared by
   * the connected root segments drawn in it; a cell the drawn roots do not
   * reach (the sim's density is a smooth field, the drawing is a sketch of it)
   * hands its water to the nearest drawn root instead of losing it.
   */
  setSources(posed: PosedRoots, uptakeField: readonly number[]): void {
    const count = new Int32Array(SOIL_CELLS)
    const cellOfSeg = new Int32Array(posed.count).fill(-1)
    const connected: number[] = []
    for (let j = 0; j < posed.count; j++) {
      if (!posed.connected[j]) continue
      const c = cellOf((posed.x0[j] + posed.x1[j]) / 2, (posed.z0[j] + posed.z1[j]) / 2)
      cellOfSeg[j] = c
      count[c]++
      connected.push(j)
    }
    const start = new Int32Array(SOIL_CELLS + 1)
    for (let c = 0; c < SOIL_CELLS; c++) start[c + 1] = start[c] + count[c]
    const fill = start.slice(0, SOIL_CELLS)
    const items = new Int32Array(connected.length)
    for (const j of connected) items[fill[cellOfSeg[j]]++] = j

    const cells: number[] = []
    const segs: number[] = []
    const cum: number[] = []
    let total = 0
    if (connected.length > 0) {
      for (let c = 0; c < SOIL_CELLS; c++) {
        const w = uptakeField[c]
        if (!(w > MIN_WEIGHT)) continue
        if (count[c] > 0) {
          const share = w / count[c]
          for (let n = start[c]; n < start[c + 1]; n++) {
            total += share
            cells.push(c)
            segs.push(items[n])
            cum.push(total)
          }
        } else {
          const cx = cellX(c % SOIL_COLS)
          const cz = cellZ(Math.floor(c / SOIL_COLS))
          let best = connected[0]
          let bestD = Infinity
          for (const j of connected) {
            const dx = (posed.x0[j] + posed.x1[j]) / 2 - cx
            const dz = (posed.z0[j] + posed.z1[j]) / 2 - cz
            const d = dx * dx + dz * dz
            if (d < bestD) {
              bestD = d
              best = j
            }
          }
          total += w
          cells.push(c)
          segs.push(best)
          cum.push(total)
        }
      }
    }
    this.srcCell = cells
    this.srcSeg = segs
    this.srcCum = cum
    this.total = total
    this.rate = Math.min(FLOW.maxRate, FLOW.perUnit * total)
  }

  /** Advance every particle by `dt` seconds of animation; `stemTop` is how high the stem stub runs, m. */
  step(dt: number, posed: PosedRoots, stemTop: number): void {
    if (!(dt > 0)) return
    const top = Math.max(0.05, stemTop)

    // spawn
    if (this.total > 0) {
      this.carry += this.rate * dt
      const want = Math.min(MAX_SPAWN_PER_STEP, Math.floor(this.carry))
      this.carry -= Math.floor(this.carry)
      // spread the step's spawns across the step (each is born part-way through it), so a slow frame
      // does not release a clump of parcels that then travel up the shared stem in lockstep
      for (let n = 0; n < want; n++) {
        if (!this.spawn(((n + this.rnd()) / want) * dt)) break
        this.spawned++
      }
    } else {
      this.carry = 0
    }

    // move
    let alive = 0
    for (let i = 0; i < this.capacity; i++) {
      const phase = this.phase[i]
      if (phase === PHASE_FREE) continue
      let rise = FLOW.stemSpeed * dt // how far up the stem this parcel goes this step

      if (phase === PHASE_SOIL) {
        const j = this.seg[i]
        if (!posed.connected[j]) {
          this.phase[i] = PHASE_FREE
          continue
        }
        this.k[i] += dt / (FLOW.soilTime * (0.7 + 0.6 * this.jit[i]))
        if (this.k[i] >= 1) this.phase[i] = PHASE_ROOT
        const e = smoothstep(0, 1, Math.min(1, this.k[i]))
        this.x[i] = this.ax[i] + (this.rootX(posed, j, this.s[i]) - this.ax[i]) * e
        this.y[i] = -(this.az[i] + (this.rootZ(posed, j, this.s[i]) - this.az[i]) * e)
        this.fade[i] = smoothstep(0, 0.35, this.k[i])
      }

      if (this.phase[i] === PHASE_ROOT) {
        let dist = FLOW.rootSpeed * dt
        let j = this.seg[i]
        let s = this.s[i]
        let gone = false
        while (dist > 0) {
          if (!posed.connected[j]) {
            gone = true // the root it was in is no longer drawn (front reset / soil swapped)
            break
          }
          const len = this.length(posed, j)
          if (dist < s * len) {
            s -= dist / len
            dist = 0
          } else {
            dist -= s * len
            const p = this.parent[j]
            if (p < 0) {
              // it crossed the stem base part-way through the step: carry the rest of the step into the stem
              this.phase[i] = PHASE_STEM
              this.h[i] = dist * (FLOW.stemSpeed / FLOW.rootSpeed)
              rise = 0
              this.hx[i] = posed.x0[j]
              this.hz[i] = posed.z0[j]
              this.delivered++
              break
            }
            j = p
            s = 1
          }
        }
        if (gone) {
          this.phase[i] = PHASE_FREE
          continue
        }
        if (this.phase[i] === PHASE_ROOT) {
          this.seg[i] = j
          this.s[i] = s
          this.x[i] = this.rootX(posed, j, s)
          this.y[i] = -this.rootZ(posed, j, s)
          this.fade[i] = 1
        }
      }

      if (this.phase[i] === PHASE_STEM) {
        this.h[i] += rise
        if (this.h[i] >= top) {
          this.phase[i] = PHASE_FREE
          continue
        }
        const e = smoothstep(0, FLOW.collar, this.h[i]) // centre on the stem axis
        this.x[i] = this.hx[i] * (1 - e)
        this.y[i] = -this.hz[i] * (1 - e) + this.h[i]
        this.fade[i] = 1 - smoothstep(0.6, 1, this.h[i] / top) // hands off to the canopy
      }
      alive++
    }
    this.alive = alive
  }

  private rootX(p: PosedRoots, j: number, s: number) {
    return p.x0[j] + (p.x1[j] - p.x0[j]) * s
  }
  private rootZ(p: PosedRoots, j: number, s: number) {
    return p.z0[j] + (p.z1[j] - p.z0[j]) * s
  }
  private length(p: PosedRoots, j: number) {
    return Math.max(1e-3, Math.hypot(p.x1[j] - p.x0[j], p.z1[j] - p.z0[j]))
  }

  /** Release a parcel that is already `age` seconds old (see `step`). */
  private spawn(age: number): boolean {
    // a free slot, scanning on from the last one used
    let slot = -1
    for (let n = 0; n < this.capacity; n++) {
      const i = (this.cursor + n) % this.capacity
      if (this.phase[i] === PHASE_FREE) {
        slot = i
        this.cursor = i + 1
        break
      }
    }
    if (slot < 0) return false

    // pick an emitter in proportion to its uptake
    const u = this.rnd() * this.total
    let lo = 0
    let hi = this.srcCum.length - 1
    while (lo < hi) {
      const mid = (lo + hi) >> 1
      if (this.srcCum[mid] > u) hi = mid
      else lo = mid + 1
    }
    const c = this.srcCell[lo]
    this.seg[slot] = this.srcSeg[lo]
    this.s[slot] = 0.1 + 0.9 * this.rnd()
    this.ax[slot] = cellX(c % SOIL_COLS) + (this.rnd() - 0.5) * CELL_W * 0.8
    this.az[slot] = cellZ(Math.floor(c / SOIL_COLS)) + (this.rnd() - 0.5) * CELL_H * 0.8
    this.k[slot] = age / FLOW.soilTime
    this.phase[slot] = PHASE_SOIL
    this.x[slot] = this.ax[slot]
    this.y[slot] = -this.az[slot]
    this.fade[slot] = 0
    return true
  }
}
