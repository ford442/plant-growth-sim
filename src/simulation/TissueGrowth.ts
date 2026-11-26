/**
 * Stem tissue growth — the pure model behind the Cellular view.
 *
 * A stem cross-section is modelled as a handful of *radial files* of cells,
 * each running pith → xylem → cambium → phloem → cortex → epidermis. That is how
 * real wood is organised: the vascular cambium divides periclinally (the new
 * wall runs parallel to the stem surface), the inner daughter differentiates
 * into xylem (wood) and the outer daughter into phloem, so every cell in a
 * radial file is a descendant of one cambial initial.
 *
 *   cambial cell ──G1─S─G2─mitosis──► two daughters ──► one stays cambial,
 *                                      the other leaves as xylem (inside)
 *                                      or, every few divisions, phloem (outside)
 *
 * Three things respond to weather, and they respond differently:
 *   - *division* needs turgor, warmth and photosynthate (carbon), and stops at a
 *     G2/M checkpoint when any of them is missing;
 *   - *cell enlargement* is driven by turgor alone and is the most drought
 *     sensitive process, so a mild water deficit gives small cells first;
 *   - *wall maturation* (lignification) just needs warmth, so drought-stunted
 *     cells still harden — narrow, dense latewood-like rings.
 *
 * Time is the shared simulation clock in days. A growth ring is one
 * `SEASON_DAYS` season: big thin-walled earlywood cells (with wide vessels in
 * ring-porous species) first, small thick-walled latewood fibres last, then a
 * dormant gap in which the cambium rests and the ring boundary forms.
 *
 * Everything here is plain data in / plain data out (no Three.js, no store):
 * `stepTissue` never mutates its input. The view lays the files out each frame
 * with `layoutFile` and paints the stem disc from `ringProfile`.
 */

import type { SpeciesId } from './species'

// ---------------------------------------------------------------------------
// Constants (µm unless noted)
// ---------------------------------------------------------------------------

/** Radial files simulated and drawn. Each is a column of cells of one lineage. */
export const FILE_COUNT = 8
/** One growth season = one ring, in simulation days. */
export const SEASON_DAYS = 20
/** Tail of each season in which the cambium rests (ring boundary forms). */
export const DORMANT_FRACTION = 0.12
/** Longest slice integrated at once, so big frames cannot skip a whole cell cycle. */
const SUBSTEP_DAYS = 0.1

/** Radial thickness of a cambial cell just before it divides. Real cambium is thin. */
export const CAMBIAL_SIZE = 12
/** Tangential width of one file. Cells in a file share it. */
export const FILE_WIDTH = 19

/** Newest xylem cells kept per file; older wood is folded into the ring record. */
export const WINDOW_CELLS = 26
/** Conducting phloem kept per file; older phloem is crushed into the bark. */
export const PHLOEM_KEEP = 4

// Primary (first-year) structure, shown until secondary growth pushes it out.
export const PITH_CELLS = 2
export const PITH_CELL_SIZE = 35
export const PRIMARY_XYLEM_CELLS = 2
export const PRIMARY_XYLEM_SIZE = 25
export const PITH_RADIUS = PITH_CELLS * PITH_CELL_SIZE
export const PRIMARY_RADIUS = PITH_RADIUS + PRIMARY_XYLEM_CELLS * PRIMARY_XYLEM_SIZE
export const CORTEX_CELLS = 2
export const CORTEX_SIZE = 30
export const EPIDERMIS_SIZE = 10

// ---------------------------------------------------------------------------
// Cell cycle
// ---------------------------------------------------------------------------

/**
 * Cell-cycle landmarks as fractions of one cycle. The proportions are
 * exaggerated towards mitosis (real M phase is a few percent of the cycle) so
 * that division is watchable at normal playback speed.
 */
export const CYCLE = {
  G1_END: 0.3,
  S_END: 0.52,
  /** G2/M checkpoint: a cell must pass it to start mitosis. */
  M_START: 0.68,
  PROPHASE_END: 0.75,
  METAPHASE_END: 0.82,
  ANAPHASE_END: 0.9,
} as const

export type CyclePhase = 'G1' | 'S' | 'G2' | 'prophase' | 'metaphase' | 'anaphase' | 'telophase'

export function cyclePhase(cycle: number): CyclePhase {
  if (cycle < CYCLE.G1_END) return 'G1'
  if (cycle < CYCLE.S_END) return 'S'
  if (cycle < CYCLE.M_START) return 'G2'
  if (cycle < CYCLE.PROPHASE_END) return 'prophase'
  if (cycle < CYCLE.METAPHASE_END) return 'metaphase'
  if (cycle < CYCLE.ANAPHASE_END) return 'anaphase'
  return 'telophase'
}

export const isMitotic = (cycle: number) => cycle >= CYCLE.M_START

/** Cell-plate progress 0–1: it only grows during telophase/cytokinesis. */
export const cellPlateProgress = (cycle: number) =>
  clamp01((cycle - CYCLE.ANAPHASE_END) / (1 - CYCLE.ANAPHASE_END))

/** Radial thickness of a cambial cell at a given point of its cycle: half → full by G2. */
export function cambialSizeAt(cycle: number): number {
  const half = CAMBIAL_SIZE / 2
  return half + half * smoothstep(0, CYCLE.M_START, cycle)
}

// ---------------------------------------------------------------------------
// Species
// ---------------------------------------------------------------------------

export interface TissueSpecies {
  /** Days for one cambial cell cycle under ideal conditions. */
  cycleDays: number
  /** Xylem cells made per phloem cell (wood is made far faster than bark). */
  xylemPerPhloem: number
  /** Final radial size of xylem cells born at the start / end of the season. */
  earlySize: number
  lateSize: number
  /** Chance a new xylem cell is a vessel element, early / late in the season. */
  vesselEarly: number
  vesselLate: number
  /** Vessels are this many times wider than fibres of the same age. */
  vesselScale: number
  /** One-line anatomy note for the panel. */
  note: string
}

/** Typed on `SpeciesId`, so adding a species without a tissue preset is a compile error. */
export const SPECIES_TISSUE: Record<SpeciesId, TissueSpecies> = {
  sunflower: {
    cycleDays: 0.95,
    xylemPerPhloem: 3,
    earlySize: 15,
    lateSize: 9,
    vesselEarly: 0.35,
    vesselLate: 0.22,
    vesselScale: 1.7,
    note: 'Herbaceous eudicot: a soft stem with a thin cylinder of wood and mostly diffuse vessels.',
  },
  oak: {
    cycleDays: 1.2,
    xylemPerPhloem: 5,
    earlySize: 20,
    lateSize: 6,
    vesselEarly: 0.72,
    vesselLate: 0.04,
    vesselScale: 2,
    note: 'Ring-porous: wide earlywood vessels in spring, dense fibre latewood after, so each ring reads clearly.',
  },
  rose: {
    cycleDays: 1.1,
    xylemPerPhloem: 4,
    earlySize: 16,
    lateSize: 7,
    vesselEarly: 0.3,
    vesselLate: 0.18,
    vesselScale: 1.8,
    note: 'Woody shrub: diffuse-porous wood with vessels spread evenly through the ring.',
  },
  fern: {
    cycleDays: 1.5,
    xylemPerPhloem: 2,
    earlySize: 12,
    lateSize: 9,
    vesselEarly: 0,
    vesselLate: 0,
    vesselScale: 1,
    note: 'Schematic: ferns have no vascular cambium and conduct through tracheids (no vessels). Shown with the same growth model for comparison.',
  },
  bamboo: {
    cycleDays: 0.8,
    xylemPerPhloem: 2,
    earlySize: 11,
    lateSize: 7,
    vesselEarly: 0.5,
    vesselLate: 0.3,
    vesselScale: 1.8,
    note: 'Schematic: monocots keep scattered vascular bundles and have no cambium, so they never thicken. Shown with the same growth model for comparison.',
  },
  ivy: {
    cycleDays: 1,
    xylemPerPhloem: 3.5,
    earlySize: 17,
    lateSize: 8,
    vesselEarly: 0.6,
    vesselLate: 0.4,
    vesselScale: 2.2,
    note: 'Liana: very wide vessels move water fast through a slender climbing stem.',
  },
}

export function tissueSpecies(id: string): TissueSpecies {
  return SPECIES_TISSUE[id as SpeciesId] ?? SPECIES_TISSUE.sunflower
}

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

export type TissueCellKind = 'xylem' | 'phloem'
export type TissueCellVariant = 'vessel' | 'fibre' | 'sieve' | 'companion'

/** A xylem or phloem cell that has left the cambium. Immutable once mature. */
export interface TissueCell {
  kind: TissueCellKind
  variant: TissueCellVariant
  /** Current radial thickness. */
  size: number
  /** Radial thickness at birth (half a cambial cell). */
  birthSize: number
  /** Radial thickness once fully enlarged. */
  target: number
  /** 0–1 enlargement progress; only advances while turgor allows growth. */
  expand: number
  /** 0–1 wall maturation; xylem cells die (lumen empties) as it completes. */
  maturity: number
  /** Season index the cell was born in. */
  ring: number
  /** Born in the first half of the season. */
  early: boolean
  /** Per-cell random 0–1, for stable visual variation. */
  tone: number
}

export interface CambialCell {
  /** 0–1 progress through the cell cycle; 1 is cell division. */
  cycle: number
  /** Radial thickness (a function of `cycle`, kept for convenience). */
  size: number
}

export interface RadialFile {
  /** Inner → outer: oldest wood first, newest next to the cambium. */
  xylem: TissueCell[]
  cambium: CambialCell
  /** Inner → outer: newest next to the cambium, oldest (about to be crushed) last. */
  phloem: TissueCell[]
  /** Xylem cells that have left the window, and their summed thickness. */
  retired: number
  retiredSize: number
  /** Xylem made since the last phloem cell. */
  sincePhloem: number
  /** This file's cell-cycle speed relative to the species mean. */
  pace: number
  rng: number
}

/** Per-season totals. `width`/`earlyWidth`/`cells` only count wood that has left the window. */
export interface RingRecord {
  index: number
  width: number
  earlyWidth: number
  cells: number
  births: number
  /** Σ (1 − enlargement response) over births; divide by `births` for mean stress. */
  stress: number
}

export interface TissueState {
  /** Tissue clock, simulation days. */
  t: number
  files: RadialFile[]
  /** One record per season so far, `rings[i].index === i`. */
  rings: RingRecord[]
  /** Cambial divisions since the start, summed over files. */
  divisions: number
}

export interface TissueInputs {
  temperature: number // °C
  light: number // 0–1
  /** Plant water status, 0 (wilted) – 1 (turgid). */
  water: number
}

const newRing = (index: number): RingRecord => ({
  index,
  width: 0,
  earlyWidth: 0,
  cells: 0,
  births: 0,
  stress: 0,
})

export function createTissueState(species: string = 'sunflower', seed = 20260820): TissueState {
  const sp = tissueSpecies(species)
  const files: RadialFile[] = []
  for (let i = 0; i < FILE_COUNT; i++) {
    const f: RadialFile = {
      xylem: [],
      cambium: { cycle: 0, size: CAMBIAL_SIZE / 2 },
      phloem: [],
      retired: 0,
      retiredSize: 0,
      sincePhloem: 0,
      pace: 1,
      rng: (seed + Math.imul(i + 1, 0x9e3779b9)) >>> 0 || 1,
    }
    // Stagger the files so divisions are spread through time, not a metronome.
    f.cambium.cycle = nextRand(f) * (CYCLE.M_START - 0.02)
    f.cambium.size = cambialSizeAt(f.cambium.cycle)
    f.sincePhloem = Math.floor(nextRand(f) * sp.xylemPerPhloem)
    f.pace = 0.9 + nextRand(f) * 0.2
    // Primary phloem laid down before secondary growth begins.
    f.phloem.push(makeCell('phloem', 'companion', 5, 5, 0, false, nextRand(f), 1))
    f.phloem.push(makeCell('phloem', 'sieve', 8, 8, 0, false, nextRand(f), 1))
    files.push(f)
  }
  return { t: 0, files, rings: [newRing(0)], divisions: 0 }
}

// ---------------------------------------------------------------------------
// Environment response
// ---------------------------------------------------------------------------

export type LimitingFactor = 'none' | 'water' | 'cold' | 'heat' | 'dark'

export interface CambialResponse {
  /** Warmth, 0–1: cambium is essentially shut below ~2 °C and above ~40 °C. */
  temp: number
  /** Photosynthate supply, 0–1 (reserves keep a floor under darkness). */
  carbon: number
  /** Turgor gate on *division*, 0–1. */
  water: number
  /** Turgor gate on cell *enlargement*, 0–1 — stricter than division. */
  expansion: number
  /** Overall cell-cycle speed multiplier: temp × carbon × water. */
  activity: number
  /** What is holding growth back the most (`none` when nothing is below 75%). */
  limiting: LimitingFactor
}

/** Below this activity cells stop at a checkpoint instead of cycling. */
export const ARREST_ACTIVITY = 0.06

export function cambialResponse(env: TissueInputs): CambialResponse {
  const temp =
    smoothstep(2, 16, env.temperature) * (1 - smoothstep(30, 42, env.temperature))
  const light = clamp01(env.light)
  const carbon = 0.35 + 0.65 * light
  const water = smoothstep(0.12, 0.5, env.water)
  const expansion = smoothstep(0.2, 0.75, env.water)

  // Compare the *physiological* limit of each driver (light rescaled so a dark
  // sky counts as fully limiting even though reserves keep some growth going).
  let limiting: LimitingFactor = 'none'
  let worst = 0.75
  if (water < worst) {
    worst = water
    limiting = 'water'
  }
  if (temp < worst) {
    worst = temp
    limiting = env.temperature < 22 ? 'cold' : 'heat'
  }
  if (light < worst) {
    limiting = 'dark'
  }
  return { temp, carbon, water, expansion, activity: temp * carbon * water, limiting }
}

/** Position in the current season, 0–1. */
export const seasonPhase = (t: number) => (t % SEASON_DAYS) / SEASON_DAYS
export const seasonIndex = (t: number) => Math.floor(t / SEASON_DAYS)
export const isDormant = (phase: number) => phase >= 1 - DORMANT_FRACTION
/** 1 at the start of the season (earlywood), falling to 0 by late summer. */
export const earlywoodness = (phase: number) => 1 - smoothstep(0.08, 0.62, phase)

export type TissueStatusId = 'active' | 'slowed' | 'arrested' | 'dormant'

export interface TissueStatus {
  id: TissueStatusId
  limiting: LimitingFactor
  response: CambialResponse
}

export function tissueStatus(state: TissueState, env: TissueInputs): TissueStatus {
  const response = cambialResponse(env)
  let id: TissueStatusId
  if (isDormant(seasonPhase(state.t))) id = 'dormant'
  else if (response.activity < ARREST_ACTIVITY) id = 'arrested'
  else if (response.activity < 0.6 || response.limiting !== 'none') id = 'slowed'
  else id = 'active'
  return { id, limiting: response.limiting, response }
}

// ---------------------------------------------------------------------------
// Stepping
// ---------------------------------------------------------------------------

const EXPAND_DAYS = 2.4
const MATURE_DAYS = 6
/** Enlargement stops once this fraction of maturation is done (the wall sets). */
const WALL_LOCK = 0.6
const PHLOEM_EXPAND_DAYS = 1.6
const PHLOEM_MATURE_DAYS = 4
/** Share of normal speed at which a cell already in mitosis finishes when conditions turn bad. */
const MITOSIS_FINISH_RATE = 0.6
/** …and the creep from S towards the G2/M checkpoint, where cells then wait. */
const CHECKPOINT_CREEP_RATE = 0.25

interface StepContext {
  sp: TissueSpecies
  resp: CambialResponse
  dormant: boolean
  early: number
  ring: number
  rings: RingRecord[]
  divisions: number
}

/**
 * Advances the tissue by `days`. Pure: returns a new state and leaves `state`
 * (and every cell reachable from it) untouched, so it is safe to freeze.
 */
export function stepTissue(
  state: TissueState,
  species: string,
  env: TissueInputs,
  days: number,
): TissueState {
  if (!(days > 0)) return state
  const sp = tissueSpecies(species)

  // Working copy: arrays are cloned, and any cell that changes is *replaced*,
  // so mature cells stay shared with the previous state.
  const files = state.files.map(cloneFile)
  const ctx: StepContext = {
    sp,
    resp: cambialResponse(env),
    dormant: false,
    early: 1,
    ring: 0,
    rings: state.rings.slice(),
    divisions: state.divisions,
  }

  let t = state.t
  let remaining = days
  while (remaining > 1e-9) {
    const h = Math.min(remaining, SUBSTEP_DAYS)
    t += h
    remaining -= h

    const ring = seasonIndex(t)
    while (ctx.rings.length <= ring) ctx.rings.push(newRing(ctx.rings.length))
    const phase = (t - ring * SEASON_DAYS) / SEASON_DAYS
    ctx.ring = ring
    ctx.dormant = isDormant(phase)
    ctx.early = earlywoodness(phase)

    for (const f of files) stepFile(f, ctx, h)
  }

  return { t, files, rings: ctx.rings, divisions: ctx.divisions }
}

function cloneFile(f: RadialFile): RadialFile {
  return { ...f, xylem: f.xylem.slice(), phloem: f.phloem.slice(), cambium: { ...f.cambium } }
}

function stepFile(f: RadialFile, ctx: StepContext, h: number): void {
  const { sp, resp } = ctx

  // --- cambium: cell cycle with a G2/M checkpoint --------------------------
  const c = f.cambium
  const permissive = !ctx.dormant && resp.activity >= ARREST_ACTIVITY
  let rate = 0
  let cap = Infinity
  if (permissive) {
    rate = resp.activity
  } else if (c.cycle >= CYCLE.M_START) {
    rate = MITOSIS_FINISH_RATE // mitosis cannot be abandoned half way
  } else if (c.cycle >= CYCLE.G1_END) {
    rate = CHECKPOINT_CREEP_RATE // finish S/G2, then wait at the checkpoint
    cap = CYCLE.M_START - 1e-3
  } // else: G1 arrest, no progress
  c.cycle = Math.min(c.cycle + (h / sp.cycleDays) * rate * f.pace, cap)
  c.size = cambialSizeAt(c.cycle)
  if (c.cycle >= 1) divide(f, ctx)

  // --- differentiating xylem and phloem ------------------------------------
  const tempGate = 0.3 + 0.7 * resp.temp
  for (let i = 0; i < f.xylem.length; i++) {
    const x = f.xylem[i]
    if (x.maturity < 1) f.xylem[i] = advanceCell(x, h, EXPAND_DAYS, MATURE_DAYS, resp.expansion, tempGate)
  }
  for (let i = 0; i < f.phloem.length; i++) {
    const p = f.phloem[i]
    if (p.maturity < 1) f.phloem[i] = advanceCell(p, h, PHLOEM_EXPAND_DAYS, PHLOEM_MATURE_DAYS, resp.expansion, tempGate)
  }
}

function advanceCell(
  cell: TissueCell,
  h: number,
  expandDays: number,
  matureDays: number,
  turgorGate: number,
  tempGate: number,
): TissueCell {
  const expand =
    cell.maturity < WALL_LOCK ? Math.min(1, cell.expand + (h / expandDays) * turgorGate) : cell.expand
  const maturity = Math.min(1, cell.maturity + (h / matureDays) * tempGate)
  const size = cell.birthSize + (cell.target - cell.birthSize) * smoothstep(0, 1, expand)
  return { ...cell, expand, maturity, size }
}

/** Periclinal division: one daughter stays cambial, the other leaves as xylem or phloem. */
function divide(f: RadialFile, ctx: StepContext): void {
  const { sp, resp } = ctx
  const half = CAMBIAL_SIZE / 2
  ctx.divisions++
  f.sincePhloem++

  if (f.sincePhloem >= sp.xylemPerPhloem) {
    f.sincePhloem = 0
    const sieve = nextRand(f) < 0.6
    const target = (sieve ? 9 : 5.5) * (0.9 + 0.2 * nextRand(f))
    f.phloem.unshift(
      makeCell('phloem', sieve ? 'sieve' : 'companion', half, target, ctx.ring, ctx.early > 0.5, nextRand(f), 0),
    )
    while (f.phloem.length > PHLOEM_KEEP) f.phloem.pop()
  } else {
    const vessel = nextRand(f) < lerp(sp.vesselLate, sp.vesselEarly, ctx.early)
    const base = lerp(sp.lateSize, sp.earlySize, ctx.early) * (0.9 + 0.2 * nextRand(f))
    f.xylem.push(
      makeCell('xylem', vessel ? 'vessel' : 'fibre', half, vessel ? base * sp.vesselScale : base, ctx.ring, ctx.early > 0.5, nextRand(f), 0),
    )
    const rec = ctx.rings[ctx.ring]
    ctx.rings[ctx.ring] = { ...rec, births: rec.births + 1, stress: rec.stress + (1 - resp.expansion) }
    while (f.xylem.length > WINDOW_CELLS) retire(f, ctx)
  }

  // Carry the overshoot into the next cycle so the division rate does not depend
  // on the step size, plus a little zero-mean jitter so files that were arrested
  // together (dormancy, drought) do not all divide in lock step on release.
  const carry = Math.min(f.cambium.cycle - 1, 0.1)
  const cycle = Math.max(0, carry + (nextRand(f) - 0.5) * 0.04)
  f.cambium = { cycle, size: cambialSizeAt(cycle) }
}

/** The oldest wood leaves the window; its thickness moves into the ring record. */
function retire(f: RadialFile, ctx: StepContext): void {
  const old = f.xylem.shift()!
  f.retired++
  f.retiredSize += old.size
  const rec = ctx.rings[old.ring]
  ctx.rings[old.ring] = {
    ...rec,
    width: rec.width + old.size,
    earlyWidth: rec.earlyWidth + (old.early ? old.size : 0),
    cells: rec.cells + 1,
  }
}

function makeCell(
  kind: TissueCellKind,
  variant: TissueCellVariant,
  birthSize: number,
  target: number,
  ring: number,
  early: boolean,
  tone: number,
  maturity: number,
): TissueCell {
  // Pre-formed (maturity 1) cells start fully grown; a cell never shrinks below
  // the size it was born at (late fibres are simply the ones that barely swell).
  const done = maturity >= 1
  const final = Math.max(target, birthSize)
  return {
    kind,
    variant,
    size: done ? final : birthSize,
    birthSize: done ? final : birthSize,
    target: final,
    expand: done ? 1 : 0,
    maturity,
    ring,
    early,
    tone,
  }
}

// ---------------------------------------------------------------------------
// Layout and aggregates (read-only views of the state)
// ---------------------------------------------------------------------------

export type LayoutKind =
  | 'pith'
  | 'primaryXylem'
  | 'xylem'
  | 'cambium'
  | 'phloem'
  | 'cortex'
  | 'epidermis'

/**
 * Walks one file outwards-from-the-cambium and reports every cell as
 * `[kind, x0, x1, cell]`, with `x` in µm along the radius measured from the
 * *centre of the cambial cell* (positive = towards the bark). Anchoring on the
 * cambium keeps it still on screen while older wood slides inwards as new cells
 * enlarge. Primary tissue (pith, first xylem) only appears until secondary wood
 * has pushed it out of the window.
 */
export function layoutFile(
  f: RadialFile,
  visit: (kind: LayoutKind, x0: number, x1: number, cell: TissueCell | null, index: number) => void,
): void {
  const half = f.cambium.size / 2
  visit('cambium', -half, half, null, 0)

  let x = -half
  for (let i = f.xylem.length - 1; i >= 0; i--) {
    const c = f.xylem[i]
    visit('xylem', x - c.size, x, c, i)
    x -= c.size
  }
  if (f.retired === 0) {
    for (let i = 0; i < PRIMARY_XYLEM_CELLS; i++) {
      visit('primaryXylem', x - PRIMARY_XYLEM_SIZE, x, null, i)
      x -= PRIMARY_XYLEM_SIZE
    }
    for (let i = 0; i < PITH_CELLS; i++) {
      visit('pith', x - PITH_CELL_SIZE, x, null, i)
      x -= PITH_CELL_SIZE
    }
  }

  x = half
  for (let i = 0; i < f.phloem.length; i++) {
    const c = f.phloem[i]
    visit('phloem', x, x + c.size, c, i)
    x += c.size
  }
  for (let i = 0; i < CORTEX_CELLS; i++) {
    visit('cortex', x, x + CORTEX_SIZE, null, i)
    x += CORTEX_SIZE
  }
  visit('epidermis', x, x + EPIDERMIS_SIZE, null, 0)
}

export interface RingBand {
  index: number
  /** Radii from the pith centre, µm. */
  inner: number
  earlyOuter: number
  outer: number
  /** Mean enlargement stress while the ring was laid down, 0 (none) – 1 (drought). */
  stress: number
  /** False for the season still in progress. */
  complete: boolean
}

/** Mean xylem rings across the files, innermost first. */
export function ringProfile(state: TissueState): RingBand[] {
  const n = state.rings.length
  const liveWidth = new Float64Array(n)
  const liveEarly = new Float64Array(n)
  for (const f of state.files) {
    for (const c of f.xylem) {
      liveWidth[c.ring] += c.size
      if (c.early) liveEarly[c.ring] += c.size
    }
  }
  const files = state.files.length
  const current = seasonIndex(state.t)
  const out: RingBand[] = []
  let r = PRIMARY_RADIUS
  for (let i = 0; i < n; i++) {
    const rec = state.rings[i]
    const width = (rec.width + liveWidth[i]) / files
    const early = (rec.earlyWidth + liveEarly[i]) / files
    out.push({
      index: i,
      inner: r,
      earlyOuter: r + early,
      outer: r + width,
      stress: rec.births > 0 ? rec.stress / rec.births : 0,
      complete: i < current,
    })
    r += width
  }
  return out
}

export interface StemMetrics {
  /** Radius to the outside of the xylem, µm. */
  xylemRadius: number
  /** Radius to the outside of the stem, µm. */
  stemRadius: number
  /** Mean radial extent of the conducting phloem, µm. */
  phloemWidth: number
  /** Completed growth rings. */
  ringsComplete: number
  /** Mean width of the last completed ring, µm (0 before the first ring closes). */
  lastRingWidth: number
  /** Files currently in mitosis. */
  mitotic: number
  phaseCounts: Record<CyclePhase, number>
}

/** Pass `profile` if the caller already has it, to avoid walking the rings twice. */
export function stemMetrics(state: TissueState, profile: RingBand[] = ringProfile(state)): StemMetrics {
  const xylemRadius = profile.length ? profile[profile.length - 1].outer : PRIMARY_RADIUS
  let phloem = 0
  const phaseCounts: Record<CyclePhase, number> = {
    G1: 0,
    S: 0,
    G2: 0,
    prophase: 0,
    metaphase: 0,
    anaphase: 0,
    telophase: 0,
  }
  let mitotic = 0
  let cambium = 0
  for (const f of state.files) {
    for (const p of f.phloem) phloem += p.size
    cambium += f.cambium.size
    phaseCounts[cyclePhase(f.cambium.cycle)]++
    if (isMitotic(f.cambium.cycle)) mitotic++
  }
  const files = state.files.length
  const phloemWidth = phloem / files
  const stemRadius =
    xylemRadius + cambium / files + phloemWidth + CORTEX_CELLS * CORTEX_SIZE + EPIDERMIS_SIZE
  const ringsComplete = seasonIndex(state.t)
  const last = ringsComplete > 0 ? profile[ringsComplete - 1] : undefined
  return {
    xylemRadius,
    stemRadius,
    phloemWidth,
    ringsComplete,
    lastRingWidth: last ? last.outer - last.inner : 0,
    mitotic,
    phaseCounts,
  }
}

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

function clamp01(x: number): number {
  return x < 0 ? 0 : x > 1 ? 1 : x
}

const lerp = (a: number, b: number, t: number) => a + (b - a) * t

export function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = clamp01((x - edge0) / (edge1 - edge0))
  return t * t * (3 - 2 * t)
}

/** mulberry32 on the file's own state. Only ever called on a working copy. */
function nextRand(f: { rng: number }): number {
  f.rng = (f.rng + 0x6d2b79f5) >>> 0
  let t = f.rng
  t = Math.imul(t ^ (t >>> 15), t | 1)
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296
}
