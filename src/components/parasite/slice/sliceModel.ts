/**
 * The cyst garden's view-layer model: turns `world.cysts` into instance buffers.
 *
 * Like `soil/waterFlow.ts` and `plant/MorphedPlant.ts` it is a *view* model — no
 * simulation state, no clock of its own (feed it the real frame `dt`), and it
 * never writes to what it reads. It owns every typed array the four instanced
 * meshes draw from, so the component only binds them and sets `count`:
 *
 *   mosaic cells · cyst bodies · cyst wall shells · bradyzoites
 *
 * Almost nothing here changes between frames. A cyst's size only moves when its
 * bradyzoite count steps (about once per simulated day), so `update` is built to
 * do *no work* on a quiet frame and to report, through `SliceFrame`, exactly
 * which buffers changed on a busy one:
 *
 *  - Each cyst's drawn size **eases** toward the sim's, so growth is a swell, not
 *    a pop. While that ease runs only the sphere matrices and the rods' positions
 *    are rewritten (a rod's orientation is cached), never the whole garden.
 *  - A change in *which* bradyzoites are drawn (a cyst appears, a count steps, the
 *    LOD budget moves) rebuilds the bradyzoite buffer once.
 *
 * Units are micrometres; the parent group scales them into world units.
 */

import * as THREE from 'three'
import { hash01 } from '../../../simulation/LSystem'
import { NICHE_DEFS, type NicheId } from '../../../simulation/parasite/hostImmunity'
import { STAGE_DEFS } from '../../../simulation/parasite/stages'
import type { Cyst } from '../../../simulation/parasite/world'
import {
  allocateBradyzoites,
  MIN_DRAW_DIAMETER_UM,
  ROD_FLOATS,
  rodLocal,
  rodReach,
  writeRodMatrix,
} from './bradyzoites'
import { SLICE_PALETTES } from './palette'
import {
  buildLattice,
  CELL_FILL,
  CYST_CAPACITY,
  markCellsNear,
  maxLatticeCells,
  patchRadiusUm,
  slotPosition,
  type Lattice,
} from './sliceLayout'
import { MAX_BRADYZOITE_INSTANCES } from './sliceLod'

/** A cyst's centre sits this fraction of its radius above the tissue surface (the rest is embedded). */
export const CYST_LIFT = 0.5
/** The footprint a cyst displaces on the surface: where its sphere crosses the plane. */
export const CLAIM_RADIUS = Math.sqrt(1 - CYST_LIFT * CYST_LIFT)
/** Time constant of the size ease, seconds. */
export const EASE_SECONDS = 0.25
/** A cyst that first appears while you are watching starts at this fraction of its size and swells. */
export const SPAWN_FRACTION = 0.35
/** Closer than this to its target, a cyst snaps (and the ease stops costing anything). */
const SNAP_UM = 0.01
/** Hover brightens a cyst's rim by this factor. */
const HOVER_GAIN = 2.4

export interface SliceUpdateOptions {
  /** Real seconds since the last update (not simulated time). */
  dt: number
  /** Bradyzoite instance budget from the LOD tier. */
  budget: number
  /** The cyst under the pointer, if any. */
  hoverId: number | null
  /** Tissue palette for the backdrop mosaic. */
  niche: NicheId
}

/** What one `update` did. Flags say which buffers need re-uploading. */
export interface SliceFrame {
  /** Cyst instances to draw (bodies and shells share the count). */
  cysts: number
  bradyzoites: number
  cells: number
  matricesDirty: boolean
  colorsDirty: boolean
  bradyDirty: boolean
  cellsDirty: boolean
  cellColorsDirty: boolean
  /** True while any cyst is still swelling toward its simulated size. */
  easing: boolean
  /** Bradyzoites the simulation holds in the cysts drawn — the number a tier is capping. */
  totalBradyzoites: number
}

interface Entry {
  /** Radius shown now, µm. */
  shown: number
  /** Radius the sim says, µm. */
  target: number
  /** `update` generation this cyst was last seen in, so vanished ones can be dropped. */
  stamp: number
  /** Did `shown` change this frame? */
  moved: boolean
  /** Cached rod poses (`ROD_FLOATS` each); never shrinks, so a count that dips and returns costs nothing. */
  local: Float32Array
  localCount: number
}

const NO_RODS = new Float32Array(0)

/** Niche accent blended toward the bradyzoite violet, as the 3-D tissue view tints its cysts. */
const NICHE_TINT = (() => {
  const zoite = new THREE.Color(STAGE_DEFS.bradyzoite.color)
  const out = {} as Record<NicheId, THREE.Color>
  for (const id of Object.keys(NICHE_DEFS) as NicheId[]) out[id] = new THREE.Color(NICHE_DEFS[id].color).lerp(zoite, 0.55)
  return out
})()

/** Uniform scale + translation into a column-major instance matrix. */
function writeScaleTranslate(m: Float32Array, o: number, s: number, x: number, y: number, z: number): void {
  m[o] = s
  m[o + 1] = 0
  m[o + 2] = 0
  m[o + 3] = 0
  m[o + 4] = 0
  m[o + 5] = s
  m[o + 6] = 0
  m[o + 7] = 0
  m[o + 8] = 0
  m[o + 9] = 0
  m[o + 10] = s
  m[o + 11] = 0
  m[o + 12] = x
  m[o + 13] = y
  m[o + 14] = z
  m[o + 15] = 1
}

export class SliceModel {
  // instance buffers — bound to the InstancedMeshes by the component
  readonly cystMatrix = new Float32Array(CYST_CAPACITY * 16)
  readonly shellMatrix = new Float32Array(CYST_CAPACITY * 16)
  readonly cystColor = new Float32Array(CYST_CAPACITY * 3)
  readonly shellColor = new Float32Array(CYST_CAPACITY * 3)
  readonly bradyMatrix = new Float32Array(MAX_BRADYZOITE_INSTANCES * 16)
  readonly cellMatrix = new Float32Array(maxLatticeCells() * 16)
  readonly cellColor = new Float32Array(maxLatticeCells() * 3)

  /** `x, y, z, radius` per drawn cyst, for pointer picking. */
  readonly pick = new Float32Array(CYST_CAPACITY * 4)
  /** Cyst id of each drawn instance, so a pick index maps back to the sim. */
  readonly ids = new Int32Array(CYST_CAPACITY)

  /** The mosaic currently laid out; `null` until the first update. */
  lattice: Lattice | null = null

  private entries = new Map<number, Entry>()
  private entryList: Entry[] = []
  private cystList: Cyst[] = []
  private slotIdx = new Int32Array(CYST_CAPACITY)
  private eligible = new Float64Array(CYST_CAPACITY)
  private alloc = new Uint32Array(CYST_CAPACITY)
  private prevAlloc = new Uint32Array(CYST_CAPACITY)
  private start = new Uint32Array(CYST_CAPACITY)
  private claim = new Uint8Array(0)
  private claimPrev = new Uint8Array(0)
  private count = 0
  private stamp = 0
  private primed = false
  private hoverId: number | null = null
  private paintedNiche: NicheId | null = null

  update(cysts: readonly Cyst[], { dt, budget, hoverId, niche }: SliceUpdateOptions): SliceFrame {
    // ---- the mosaic: sized to the garden, painted for the tissue
    let setChanged = false
    let cellsDirty = false
    let cellColorsDirty = false
    const radius = patchRadiusUm(cysts.length)
    if (!this.lattice || this.lattice.radius !== radius) {
      this.layOutMosaic(buildLattice(radius))
      setChanged = true
      cellsDirty = true
    }
    if (this.paintedNiche !== niche || cellsDirty) {
      this.paintMosaic(niche)
      cellColorsDirty = true
    }
    const lattice = this.lattice!

    // ---- which cysts are drawn, and how big each looks right now
    const stamp = ++this.stamp
    const k = 1 - Math.exp(-Math.max(0, dt) / EASE_SECONDS)
    let n = 0
    let easing = false
    let totalBradyzoites = 0
    for (let i = 0; i < cysts.length && n < CYST_CAPACITY; i++) {
      const c = cysts[i]
      if (!c.intact) continue // a ruptured cyst leaves its slot empty
      const target = c.diameter / 2
      let e = this.entries.get(c.id)
      let fresh = false
      if (!e) {
        e = { shown: this.primed ? target * SPAWN_FRACTION : target, target, stamp, moved: true, local: NO_RODS, localCount: 0 }
        this.entries.set(c.id, e)
        setChanged = true
        fresh = true
      }
      e.stamp = stamp
      e.target = target
      const before = e.shown
      // a cyst that has just appeared is shown at its spawn size for this frame; the swell starts on the next
      if (!fresh && e.shown !== target) {
        e.shown += (target - e.shown) * k
        if (Math.abs(target - e.shown) < SNAP_UM) e.shown = target
      }
      e.moved = e.shown !== before || e.moved
      if (e.shown !== target) easing = true

      if (this.ids[n] !== c.id || this.slotIdx[n] !== i) setChanged = true
      this.ids[n] = c.id
      this.slotIdx[n] = i
      this.entryList[n] = e
      this.cystList[n] = c
      this.eligible[n] = c.diameter >= MIN_DRAW_DIAMETER_UM ? c.bradyzoites : 0
      totalBradyzoites += c.bradyzoites
      n++
    }
    if (n !== this.count) setChanged = true
    if (this.entries.size > n) {
      for (const [id, e] of this.entries) if (e.stamp !== stamp) this.entries.delete(id)
    }
    this.count = n

    // ---- how many bradyzoites each may show under the LOD budget
    const drawn = allocateBradyzoites(this.eligible, n, budget, this.alloc)
    let bradyDirty = setChanged
    for (let i = 0; i < n && !bradyDirty; i++) if (this.alloc[i] !== this.prevAlloc[i]) bradyDirty = true
    this.prevAlloc.set(this.alloc.subarray(0, n))

    const matricesDirty = setChanged || easing || this.anyMoved(n)
    const colorsDirty = setChanged || hoverId !== this.hoverId
    this.hoverId = hoverId

    // ---- cyst bodies, shells, picking spheres, and the cells they displace
    if (matricesDirty) {
      for (let j = 0; j < n; j++) {
        const { x, z } = slotPosition(this.slotIdx[j])
        const r = this.entryList[j].shown
        const y = CYST_LIFT * r
        writeScaleTranslate(this.cystMatrix, j * 16, r, x, y, z)
        writeScaleTranslate(this.shellMatrix, j * 16, r + this.cystList[j].wall, x, y, z)
        this.pick[j * 4] = x
        this.pick[j * 4 + 1] = y
        this.pick[j * 4 + 2] = z
        this.pick[j * 4 + 3] = r
      }
      if (this.displaceCells(lattice, n)) cellsDirty = true
    }
    if (colorsDirty) {
      for (let j = 0; j < n; j++) {
        const tint = NICHE_TINT[this.cystList[j].niche]
        const gain = this.cystList[j].id === hoverId ? HOVER_GAIN : 1
        this.cystColor[j * 3] = tint.r * 0.5
        this.cystColor[j * 3 + 1] = tint.g * 0.5
        this.cystColor[j * 3 + 2] = tint.b * 0.5
        this.shellColor[j * 3] = tint.r * gain
        this.shellColor[j * 3 + 1] = tint.g * gain
        this.shellColor[j * 3 + 2] = tint.b * gain
      }
    }

    // ---- bradyzoites
    if (bradyDirty) this.rebuildRods(n)
    else if (easing || matricesDirty) this.moveRods(n)

    for (let j = 0; j < n; j++) this.entryList[j].moved = false
    this.primed = true
    return {
      cysts: n,
      bradyzoites: drawn,
      cells: lattice.count,
      matricesDirty,
      colorsDirty,
      bradyDirty,
      cellsDirty,
      cellColorsDirty,
      easing,
      totalBradyzoites,
    }
  }

  private anyMoved(n: number): boolean {
    for (let j = 0; j < n; j++) if (this.entryList[j].moved) return true
    return false
  }

  /** A new patch of tissue: every tile visible again, and the displacement map reset. */
  private layOutMosaic(lattice: Lattice): void {
    this.lattice = lattice
    for (let k = 0; k < lattice.count; k++) this.writeCell(k, true)
    this.claim = new Uint8Array(lattice.count)
    this.claimPrev = new Uint8Array(lattice.count)
  }

  private writeCell(k: number, visible: boolean): void {
    const o = k * 16
    const lattice = this.lattice!
    // hidden = zero scale (w stays 1, like `hideInstance`), never an all-zero matrix
    writeScaleTranslate(this.cellMatrix, o, visible ? CELL_FILL : 0, lattice.x[k], 0, lattice.z[k])
    if (visible) this.cellMatrix[o + 5] = 1 // tiles keep their full height; only the footprint shrinks
  }

  private paintMosaic(niche: NicheId): void {
    const base = new THREE.Color(SLICE_PALETTES[niche].cell)
    const count = this.lattice!.count
    for (let k = 0; k < count; k++) {
      const shade = 0.78 + 0.44 * hash01(k * 13 + 7)
      this.cellColor[k * 3] = base.r * shade
      this.cellColor[k * 3 + 1] = base.g * shade
      this.cellColor[k * 3 + 2] = base.b * shade
    }
    this.paintedNiche = niche
  }

  /**
   * Hides the host cells a cyst sits on (a cyst displaces its host's cytoplasm).
   * Rewrites only the tiles whose state flipped. Returns whether any did.
   */
  private displaceCells(lattice: Lattice, n: number): boolean {
    this.claim.fill(0)
    for (let j = 0; j < n; j++) {
      const { x, z } = slotPosition(this.slotIdx[j])
      markCellsNear(lattice, x, z, CLAIM_RADIUS * this.entryList[j].shown, this.claim)
    }
    let changed = false
    for (let k = 0; k < lattice.count; k++) {
      if (this.claim[k] === this.claimPrev[k]) continue
      this.writeCell(k, this.claim[k] === 0)
      this.claimPrev[k] = this.claim[k]
      changed = true
    }
    return changed
  }

  /** Every drawn rod, from its cached pose. Used when the *set* of rods changed. */
  private rebuildRods(n: number): void {
    let o = 0
    for (let j = 0; j < n; j++) {
      const d = this.alloc[j]
      this.start[j] = o
      if (d > 0) {
        const e = this.entryList[j]
        this.ensureRods(e, this.cystList[j].id, d)
        this.placeRods(j, e, d, o)
      }
      o += d
    }
  }

  /** Only the rods' positions, for cysts that are still swelling (their orientations never change). */
  private moveRods(n: number): void {
    for (let j = 0; j < n; j++) {
      const d = this.alloc[j]
      const e = this.entryList[j]
      if (d > 0 && e.moved) this.placeRods(j, e, d, this.start[j])
    }
  }

  private placeRods(j: number, e: Entry, d: number, first: number): void {
    const { x, z } = slotPosition(this.slotIdx[j])
    const reach = rodReach(e.shown)
    const cy = CYST_LIFT * e.shown
    const local = e.local
    for (let r = 0; r < d; r++) {
      const li = r * ROD_FLOATS
      writeRodMatrix(
        this.bradyMatrix,
        (first + r) * 16,
        local,
        li,
        x + reach * local[li],
        cy + reach * local[li + 1],
        z + reach * local[li + 2],
      )
    }
  }

  private ensureRods(e: Entry, cystId: number, count: number): void {
    if (e.localCount >= count) return
    if (e.local.length < count * ROD_FLOATS) {
      const grown = new Float32Array(count * ROD_FLOATS)
      grown.set(e.local.subarray(0, e.localCount * ROD_FLOATS))
      e.local = grown
    }
    for (let k = e.localCount; k < count; k++) rodLocal(cystId, k, e.local, k * ROD_FLOATS)
    e.localCount = count
  }
}
