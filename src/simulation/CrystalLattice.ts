/**
 * Atomic lattice models — pure data/math, no Three.js objects.
 *
 * Structures are generated from published fractional coordinates plus
 * space-group generators (CIF-style operator strings), so atom counts and bond
 * topology are the real ones. A "tall slab" of atomic sublayers is built once
 * per structure; the lattice view slides a window over it as the growth front
 * advances, and layer-by-layer growth, defects and dopants are assigned with
 * deterministic hashes so each grown layer stays the same.
 *
 * Growth axis is the crystallographic c-axis (Three.js +Y).
 */

import { growthMode, type GrowthMode, type GrowthZone } from './CrystalGrowth'
import { smoothstep } from './color'

export type LatticeId = 'diamond' | 'alpha-quartz' | 'corundum' | 'beryl' | 'topaz'
export type Element = 'C' | 'Si' | 'O' | 'Al' | 'Be' | 'F' | 'Cr' | 'Fe' | 'N'

/** Ball-and-stick styling (radius in Å, scaled down from ionic radii). */
export const ELEMENT_STYLE: Record<Element, { radius: number; color: string; name: string }> = {
  C: { radius: 0.36, color: '#b8c4cc', name: 'Carbon' },
  Si: { radius: 0.42, color: '#e8b45a', name: 'Silicon' },
  O: { radius: 0.34, color: '#e2504a', name: 'Oxygen' },
  Al: { radius: 0.44, color: '#9fb4d0', name: 'Aluminium' },
  Be: { radius: 0.34, color: '#5fd3a5', name: 'Beryllium' },
  F: { radius: 0.32, color: '#b4e85a', name: 'Fluorine' },
  Cr: { radius: 0.5, color: '#ff3fa4', name: 'Chromium' },
  Fe: { radius: 0.5, color: '#ff8a2a', name: 'Iron' },
  N: { radius: 0.4, color: '#4d7dff', name: 'Nitrogen' },
}

interface SiteDef {
  el: Element
  frac: [number, number, number]
}

interface StructureDef {
  name: string
  system: 'cubic' | 'hexagonal' | 'orthorhombic'
  cell: { a: number; b: number; c: number }
  sites: SiteDef[]
  /** Space-group generators in CIF notation; orbits are closed under them. */
  generators: string[]
  /** Atomic sublayers per cell along c, and the fractional z of sublayer 0. */
  layersPerCell: number
  layerOrigin: number
  /** Max bond length (Å) per unordered element pair. */
  bonds: Partial<Record<string, number>>
  footprint: number // slab width (Å)
  /** Expected atoms per conventional cell (sanity check). */
  atomsPerCell: number
}

export const STRUCTURES: Record<LatticeId, StructureDef> = {
  // Fd-3m: FCC lattice + two-atom basis (sp³ tetrahedra)
  diamond: {
    name: 'Diamond cubic',
    system: 'cubic',
    cell: { a: 3.567, b: 3.567, c: 3.567 },
    sites: [
      { el: 'C', frac: [0, 0, 0] },
      { el: 'C', frac: [0.25, 0.25, 0.25] },
    ],
    generators: ['x+1/2,y+1/2,z', 'x+1/2,y,z+1/2'],
    layersPerCell: 4,
    layerOrigin: 0,
    bonds: { 'C-C': 1.7 },
    footprint: 20,
    atomsPerCell: 8,
  },
  // α-quartz, P3₂21 (Levien et al. 1980): helical chains of corner-sharing SiO₄
  'alpha-quartz': {
    name: 'α-quartz (SiO₄ helices)',
    system: 'hexagonal',
    cell: { a: 4.913, b: 4.913, c: 5.405 },
    sites: [
      { el: 'Si', frac: [0.4697, 0, 0] },
      { el: 'O', frac: [0.4135, 0.2669, 0.1191] },
    ],
    // 3₂ screw along c + 2-fold along a (the setting that matches these coordinates)
    generators: ['-y,x-y,z+2/3', 'x-y,-y,-z'],
    layersPerCell: 3,
    layerOrigin: 0,
    bonds: { 'O-Si': 1.75 },
    footprint: 20,
    atomsPerCell: 9,
  },
  // Corundum, R-3c: hcp O with Al in 2/3 of octahedral holes
  corundum: {
    name: 'Corundum (hcp O, Al octahedra)',
    system: 'hexagonal',
    cell: { a: 4.759, b: 4.759, c: 12.991 },
    sites: [
      { el: 'Al', frac: [0, 0, 0.35216] },
      { el: 'O', frac: [0.30624, 0, 0.25] },
    ],
    generators: ['x+2/3,y+1/3,z+1/3', '-y,x-y,z', 'y,x,-z+1/2', '-x,-y,-z'],
    layersPerCell: 6,
    layerOrigin: 1 / 12,
    bonds: { 'Al-O': 2.05 },
    footprint: 18,
    atomsPerCell: 30,
  },
  // Beryl, P6/mcc (Gibbs et al. 1968): stacked Si₆O₁₈ rings forming channels
  beryl: {
    name: 'Beryl (Si₆O₁₈ ring channels)',
    system: 'hexagonal',
    cell: { a: 9.21, b: 9.21, c: 9.19 },
    sites: [
      { el: 'Be', frac: [0.5, 0, 0.25] },
      { el: 'Al', frac: [2 / 3, 1 / 3, 0.25] },
      { el: 'Si', frac: [0.3875, 0.1158, 0] },
      { el: 'O', frac: [0.31, 0.2366, 0] },
      { el: 'O', frac: [0.4988, 0.1455, 0.1453] },
    ],
    generators: ['x-y,x,z', 'y,x,-z+1/2', '-x,-y,-z'],
    layersPerCell: 4,
    layerOrigin: 0,
    bonds: { 'O-Si': 1.75, 'Be-O': 1.8, 'Al-O': 2.05 },
    footprint: 22,
    atomsPerCell: 58,
  },
  // Topaz, Pbnm: SiO₄ tetrahedra + AlO₄F₂ octahedra. Coordinates are approximate
  // (±0.1 Å), so the Si–O cutoff is widened to keep tetrahedra connected.
  topaz: {
    name: 'Topaz (SiO₄ + AlO₄F₂ chains)',
    system: 'orthorhombic',
    cell: { a: 4.65, b: 8.8, c: 8.39 },
    sites: [
      { el: 'Al', frac: [0.9047, 0.1312, 0.0817] },
      { el: 'Si', frac: [0.3991, 0.9409, 0.25] },
      { el: 'O', frac: [0.7046, 0.0299, 0.25] },
      { el: 'O', frac: [0.4545, 0.7557, 0.25] },
      { el: 'O', frac: [0.2122, 0.9895, 0.0657] },
      { el: 'F', frac: [0.598, 0.2533, 0.0599] },
    ],
    generators: ['-x,-y,z+1/2', 'x+1/2,-y+1/2,-z', '-x,-y,-z'],
    layersPerCell: 4,
    layerOrigin: 0.0625,
    bonds: { 'O-Si': 1.9, 'Al-O': 2.05, 'Al-F': 2.0 },
    footprint: 20,
    atomsPerCell: 36,
  },
}

// ---------------------------------------------------------------------------
// Symmetry: parse CIF operators and close orbits
// ---------------------------------------------------------------------------

type Frac = [number, number, number]
type Op = (p: Frac) => Frac

/** Parse one CIF component like "-x+y+1/2" into coefficients. */
function parseComponent(expr: string): { cx: number; cy: number; cz: number; t: number } {
  const out = { cx: 0, cy: 0, cz: 0, t: 0 }
  const tokens = expr.replace(/\s+/g, '').match(/[+-]?[^+-]+/g) ?? []
  for (const tok of tokens) {
    const sign = tok.startsWith('-') ? -1 : 1
    const body = tok.replace(/^[+-]/, '')
    if (body === 'x') out.cx += sign
    else if (body === 'y') out.cy += sign
    else if (body === 'z') out.cz += sign
    else {
      const [n, d] = body.split('/').map(Number)
      out.t += (sign * n) / (d ?? 1)
    }
  }
  return out
}

export function parseOp(op: string): Op {
  const comps = op.split(',').map(parseComponent)
  return (p) => comps.map((c) => c.cx * p[0] + c.cy * p[1] + c.cz * p[2] + c.t) as Frac
}

const wrap = (x: number) => {
  const w = x - Math.floor(x)
  return w > 1 - 1e-6 ? 0 : w
}

function samePeriodic(a: Frac, b: Frac): boolean {
  for (let i = 0; i < 3; i++) {
    let d = Math.abs(a[i] - b[i])
    d = Math.min(d, 1 - d)
    if (d > 1e-4) return false
  }
  return true
}

/** Orbit of a fractional position under the group generated by `ops` (mod 1). */
export function orbit(p: Frac, ops: Op[]): Frac[] {
  const out: Frac[] = [p.map(wrap) as Frac]
  for (let i = 0; i < out.length; i++) {
    for (const op of ops) {
      const q = op(out[i]).map(wrap) as Frac
      if (!out.some((o) => samePeriodic(o, q))) out.push(q)
    }
  }
  return out
}

export interface UnitCellAtom {
  el: Element
  frac: Frac
}

export function unitCell(id: LatticeId): UnitCellAtom[] {
  const s = STRUCTURES[id]
  const ops = s.generators.map(parseOp)
  const atoms: UnitCellAtom[] = []
  for (const site of s.sites) for (const frac of orbit(site.frac, ops)) atoms.push({ el: site.el, frac })
  return atoms
}

/** Cell vectors in Y-up Cartesian Å (a ∥ X, c ∥ Y). */
export function cellVectors(id: LatticeId): [Frac, Frac, Frac] {
  const { system, cell } = STRUCTURES[id]
  if (system === 'hexagonal') {
    return [
      [cell.a, 0, 0],
      [-cell.a / 2, 0, (-cell.a * Math.sqrt(3)) / 2],
      [0, cell.c, 0],
    ]
  }
  return [
    [cell.a, 0, 0],
    [0, 0, -cell.b],
    [0, cell.c, 0],
  ]
}

// ---------------------------------------------------------------------------
// Tall slab: atoms + bonds over (layersPerCell + window) sublayers
// ---------------------------------------------------------------------------

export interface LatticeAtom {
  pos: Frac // Å, Y-up
  el: Element
  layer: number // sublayer index in the tall slab
  key: number // stable index within its sublayer (for hashing)
}

export interface LatticeModel {
  id: LatticeId
  name: string
  atoms: LatticeAtom[]
  bonds: [number, number][]
  layerSpacing: number // Å
  layersPerCell: number
  layerCount: number // sublayers in the tall slab
  halfWidth: number // Å
  /** atoms grouped by tall-slab layer */
  byLayer: number[][]
}

const modelCache = new Map<string, LatticeModel>()

export function buildLatticeModel(id: LatticeId, windowLayers: number): LatticeModel {
  const cacheKey = `${id}:${windowLayers}`
  const hit = modelCache.get(cacheKey)
  if (hit) return hit

  const s = STRUCTURES[id]
  const cellAtoms = unitCell(id)
  const [A, B, C] = cellVectors(id)
  const spacing = s.cell.c / s.layersPerCell
  const layerCount = s.layersPerCell + windowLayers
  const half = s.footprint / 2
  const n = Math.ceil(s.footprint / Math.min(s.cell.a, s.cell.b)) + 2
  const kMax = Math.ceil(layerCount / s.layersPerCell) + 1

  const atoms: LatticeAtom[] = []
  for (let k = -1; k <= kMax; k++) {
    for (let i = -n; i <= n; i++) {
      for (let j = -n; j <= n; j++) {
        for (const a of cellAtoms) {
          const u = a.frac[0] + i
          const v = a.frac[1] + j
          const w = a.frac[2] + k
          const layer = Math.round((w - s.layerOrigin) * s.layersPerCell)
          if (layer < 0 || layer >= layerCount) continue
          const pos: Frac = [
            u * A[0] + v * B[0] + w * C[0],
            u * A[1] + v * B[1] + w * C[1] - s.layerOrigin * s.cell.c,
            u * A[2] + v * B[2] + w * C[2],
          ]
          if (Math.abs(pos[0]) > half || Math.abs(pos[2]) > half) continue
          atoms.push({ pos, el: a.el, layer, key: 0 })
        }
      }
    }
  }

  const byLayer: number[][] = Array.from({ length: layerCount }, () => [])
  atoms.forEach((a, idx) => {
    a.key = byLayer[a.layer].length
    byLayer[a.layer].push(idx)
  })

  // bonds via a uniform grid
  const maxBond = Math.max(...Object.values(s.bonds).map((x) => x ?? 0))
  const cellSize = maxBond
  const grid = new Map<string, number[]>()
  const gk = (p: Frac) => `${Math.floor(p[0] / cellSize)},${Math.floor(p[1] / cellSize)},${Math.floor(p[2] / cellSize)}`
  atoms.forEach((a, idx) => {
    const key = gk(a.pos)
    const list = grid.get(key)
    if (list) list.push(idx)
    else grid.set(key, [idx])
  })
  const bonds: [number, number][] = []
  atoms.forEach((a, i) => {
    const cx = Math.floor(a.pos[0] / cellSize)
    const cy = Math.floor(a.pos[1] / cellSize)
    const cz = Math.floor(a.pos[2] / cellSize)
    for (let dx = -1; dx <= 1; dx++)
      for (let dy = -1; dy <= 1; dy++)
        for (let dz = -1; dz <= 1; dz++) {
          const list = grid.get(`${cx + dx},${cy + dy},${cz + dz}`)
          if (!list) continue
          for (const j of list) {
            if (j <= i) continue
            const b = atoms[j]
            const cutoff = s.bonds[[a.el, b.el].sort().join('-')]
            if (!cutoff) continue
            const d = Math.hypot(a.pos[0] - b.pos[0], a.pos[1] - b.pos[1], a.pos[2] - b.pos[2])
            if (d < cutoff && d > 0.5) bonds.push([i, j])
          }
        }
  })

  const model: LatticeModel = {
    id,
    name: s.name,
    atoms,
    bonds,
    layerSpacing: spacing,
    layersPerCell: s.layersPerCell,
    layerCount,
    halfWidth: half,
    byLayer,
  }
  modelCache.set(cacheKey, model)
  return model
}

// ---------------------------------------------------------------------------
// Growth front: per-atom arrival times inside a layer
// ---------------------------------------------------------------------------

/** Integer hash → [0, 1). Deterministic, so a grown layer never changes. */
export function hash01(a: number, b: number, salt = 0): number {
  let h = Math.imul(a | 0, 0x27d4eb2d) ^ Math.imul(b | 0, 0x165667b1) ^ Math.imul(salt | 0, 0x9e3779b9)
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b)
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35)
  h ^= h >>> 16
  return (h >>> 0) / 4294967296
}

/** How many layers a front can span at once (rough growth fills several). */
export const MAX_ARRIVAL_SPREAD = 2.4

/**
 * Arrival time of each atom of global layer G (0 = first, up to ~1 for
 * layer-by-layer modes, up to MAX_ARRIVAL_SPREAD for rough growth).
 *  - spiral: an Archimedean step winding out of a screw dislocation (BCF)
 *  - birth-spread: 2D islands nucleate and spread until they coalesce
 *  - rough: atoms stick anywhere → several partial layers at once
 */
export function layerArrivalTimes(
  mode: GrowthMode,
  xz: [number, number][],
  G: number,
  halfWidth: number
): Float32Array {
  const out = new Float32Array(xz.length)
  if (mode === 'rough') {
    for (let i = 0; i < xz.length; i++) out[i] = hash01(G, i, 7) * MAX_ARRIVAL_SPREAD
    return out
  }
  if (mode === 'birth-spread') {
    const islands = 3 + Math.floor(hash01(G, 99, 3) * 3)
    const centers: { x: number; z: number; t0: number }[] = []
    for (let k = 0; k < islands; k++) {
      centers.push({
        x: (hash01(G, k, 11) * 2 - 1) * halfWidth * 0.8,
        z: (hash01(G, k, 13) * 2 - 1) * halfWidth * 0.8,
        t0: hash01(G, k, 17) * 0.4,
      })
    }
    let max = 0
    for (let i = 0; i < xz.length; i++) {
      let t = Infinity
      for (const c of centers) t = Math.min(t, c.t0 + Math.hypot(xz[i][0] - c.x, xz[i][1] - c.z) / (halfWidth * 1.1))
      out[i] = t
      max = Math.max(max, t)
    }
    for (let i = 0; i < xz.length; i++) out[i] = (out[i] / (max || 1)) * 0.97
    return out
  }
  // spiral (also used for etching/none so the front recedes along the same step)
  for (let i = 0; i < xz.length; i++) {
    const [x, z] = xz[i]
    const theta = Math.atan2(z, x) / (Math.PI * 2) + 0.5
    const r = Math.hypot(x, z) / halfWidth
    const t = theta + r * 1.4
    out[i] = (t - Math.floor(t)) * 0.97
  }
  return out
}

/**
 * Growth zone (conditions) under which layer G was last grown. Zones are in
 * time order but not necessarily in layer order (dissolution can rewind the
 * front), so the latest zone that started at or below G wins.
 */
export function zoneAtLayer(zones: GrowthZone[], G: number): GrowthZone {
  for (let i = zones.length - 1; i > 0; i--) if (zones[i].layer <= G + 1e-6) return zones[i]
  return zones[0]
}

export function layerGrowthMode(zone: GrowthZone): GrowthMode {
  const m = growthMode(zone.saturation - 1)
  return m === 'etching' || m === 'none' ? 'spiral' : m
}

export type SiteDefect = 'vacancy' | 'dopant' | null

/**
 * Point defects frozen into layer G. Densities are exaggerated ~10³× so they
 * are visible: fast (high-σ) growth traps vacancies; dopant uptake follows
 * the fluid's impurity level at the time.
 */
export function siteDefect(
  zone: GrowthZone,
  G: number,
  key: number,
  el: Element,
  dopantHost: Element
): SiteDefect {
  const sigma = zone.saturation - 1
  const pVac = 0.004 + 0.06 * smoothstep(0.25, 1.4, sigma)
  if (hash01(G, key, 23) < pVac) return 'vacancy'
  if (el === dopantHost && hash01(G, key, 29) < zone.impurity * 0.16) return 'dopant'
  return null
}
