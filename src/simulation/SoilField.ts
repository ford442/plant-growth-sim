/**
 * Soil mineral field — pure state + step function (no Three.js), the soil-side
 * counterpart of CrystalGrowth.ts and the bridge between plant and gem modes.
 *
 * A vertical slice of soil under the plant, SOIL_COLS × SOIL_ROWS cells. Each
 * cell holds pore water and two dissolved minerals:
 *   - silica (SiO₂(aq)) — released by weathering silicate grains (volcanic ash,
 *     feldspar); solubility rises with temperature
 *   - calcium carbonate (Ca²⁺ + HCO₃⁻) — released by dissolving calcite;
 *     solubility *falls* with temperature and rises with the CO₂ pressure in the
 *     soil air, i.e. with root respiration
 *
 * Per step:
 *  1. Water: rain infiltrates the top, gravity drains water above field
 *     capacity downwards (carrying solutes: leaching), capillary diffusion
 *     evens it out (and lifts it towards a drying surface), the surface
 *     evaporates, and roots take up water to meet the plant's transpiration
 *     demand. Roots and evaporation take water but leave most solutes behind,
 *     so the rhizosphere concentrates minerals as it dries.
 *  2. Chemistry: undersaturated pore water (S = c / c_eq < 1) dissolves
 *     parent material and earlier cement; root exudates speed silicate
 *     weathering and root CO₂ raises calcite solubility. Calcium also swaps
 *     with a large exchangeable pool on clay and humus, which buffers it
 *     against leaching for weeks.
 *  3. Precipitation: supersaturated water (S > 1) cements pores (shrinking
 *     their water capacity; enough cement becomes a hardpan roots cannot
 *     cross) and nucleates nodules with the classical J ∝ exp(−B / ln²S) law
 *     used for crystals. Roots are the templates: nucleation is several times
 *     likelier where roots are dense, so nodules, rhizoliths and root-channel
 *     geodes form around the root system. Nodules grow with the same BCF law
 *     as the gem crystals.
 *  4. Roots: the root front deepens with the plant's growth rate, but stops at
 *     a hardpan; root density is derived from the front, the species' root
 *     architecture and the cement.
 *
 * Outputs to the plant: `supply` (water uptake ÷ demand), which drives
 * `waterStatus`, and `nutrient` (root-zone calcium vs need), which scales
 * growth. Mineral time is compressed the same way gem growth is: real
 * cementation and geode growth take centuries; here they take weeks so they
 * can be watched alongside the plant.
 */

import type { SpeciesId } from '../stores/simStore'
import { growthLaw, rand } from './CrystalGrowth'
import { clamp01, smoothstep } from './color'

// ---------------------------------------------------------------------------
// Grid
// ---------------------------------------------------------------------------

export const SOIL_COLS = 24
export const SOIL_ROWS = 16
export const SOIL_WIDTH = 4.8 // m
export const SOIL_DEPTH = 2.4 // m
export const CELL_W = SOIL_WIDTH / SOIL_COLS // 0.2 m
export const CELL_H = SOIL_DEPTH / SOIL_ROWS // 0.15 m
export const SOIL_CELLS = SOIL_COLS * SOIL_ROWS

export const cellIndex = (col: number, row: number) => row * SOIL_COLS + col
/** Horizontal cell centre, m (0 = under the stem). */
export const cellX = (col: number) => (col + 0.5) * CELL_W - SOIL_WIDTH / 2
/** Cell centre depth below the surface, m. */
export const cellZ = (row: number) => (row + 0.5) * CELL_H

// ---------------------------------------------------------------------------
// Soil profiles (the "geology" of plant mode)
// ---------------------------------------------------------------------------

export type SoilProfileId = 'loam' | 'volcanic' | 'limestone'
export type SoilMineral = 'silica' | 'calcite'

export interface SoilProfileDef {
  id: SoilProfileId
  name: string
  parent: string // parent material
  blurb: string // what to try
  porosity: number // pore fraction of the bulk soil
  fieldCapacity: number // relative saturation held against gravity
  conductivity: number // 1/day: drainage rate of water above field capacity
  /** Weatherable fraction in the topsoil (ash fall, limestone gravel). */
  surfaceParent: number
  /** Depth (m) where the weathering parent rock / saprolite begins. */
  parentTop: number
  silicaWeathering: number // dissolution rate constant, 1/day at 20 °C
  calciteWeathering: number
  silica0: number // initial pore-water concentration (relative to c_eq at 20 °C)
  calcium0: number
  /** Exchangeable Ca on clay + humus, in multiples of the solution store. */
  exchange: number
}

export const SOIL_PROFILES: Record<SoilProfileId, SoilProfileDef> = {
  loam: {
    id: 'loam',
    name: 'Meadow loam',
    parent: 'Weathered granite',
    blurb:
      'A deep, fertile loam over slowly weathering granite. Plenty of buffered calcium; minerals stay dissolved, so nodules are rare. The control case.',
    porosity: 0.45,
    fieldCapacity: 0.55,
    conductivity: 1.2,
    surfaceParent: 0.15,
    parentTop: 1.6,
    silicaWeathering: 0.04,
    calciteWeathering: 0.08,
    silica0: 0.5,
    calcium0: 0.6,
    exchange: 14,
  },
  volcanic: {
    id: 'volcanic',
    name: 'Volcanic ash',
    parent: 'Rhyolitic ash + glass',
    blurb:
      'Fresh glassy ash weathers fast and floods the pore water with silica. Let the plant dry the root zone between rains: silica precipitates around the roots as chert nodules and root-channel geodes, and cement builds a silcrete. Calcium is scarce, so heavy rain leaches it away.',
    porosity: 0.55,
    fieldCapacity: 0.6,
    conductivity: 2.4,
    surfaceParent: 0.85,
    parentTop: 0.6,
    silicaWeathering: 1.1,
    calciteWeathering: 0.05,
    silica0: 0.9,
    calcium0: 0.25,
    exchange: 4,
  },
  limestone: {
    id: 'limestone',
    name: 'Limestone rendzina',
    parent: 'Karst limestone',
    blurb:
      'Thin soil over limestone. Root CO₂ dissolves calcite in wet spells; when the plant dries the soil, it re-precipitates on the roots as rhizoliths and, cycle by cycle, as a calcrete hardpan that stops the taproot. Warm, dry weather speeds it up.',
    porosity: 0.42,
    fieldCapacity: 0.5,
    conductivity: 2.0,
    surfaceParent: 0.5,
    parentTop: 0.9,
    silicaWeathering: 0.015,
    calciteWeathering: 0.9,
    silica0: 0.3,
    calcium0: 0.95,
    exchange: 6,
  },
}

export const SOIL_PROFILE_IDS = Object.keys(SOIL_PROFILES) as SoilProfileId[]

/** Weatherable parent fraction (0–1) at a depth (m). */
export function parentFraction(p: SoilProfileDef, z: number): number {
  return p.surfaceParent + (1 - p.surfaceParent) * smoothstep(p.parentTop - 0.2, p.parentTop + 0.4, z)
}

// ---------------------------------------------------------------------------
// Root architecture per species
// ---------------------------------------------------------------------------

export type RootKind = 'taproot' | 'fibrous' | 'rhizome'

export interface RootSystemDef {
  kind: RootKind
  maxDepth: number // m
  /** Lateral half-width of the root zone as a fraction of its depth. */
  spread: number
  /** e-folding depth of root density as a fraction of the front depth. */
  concentration: number
  note: string
}

export const SPECIES_ROOTS: Record<SpeciesId, RootSystemDef> = {
  sunflower: {
    kind: 'taproot',
    maxDepth: 2.0,
    spread: 0.55,
    concentration: 0.45,
    note: 'Sunflower drives a taproot down to 2 m and more, so it can mine deep water — unless a hardpan stops it.',
  },
  oak: {
    kind: 'taproot',
    maxDepth: 2.3,
    spread: 1.0,
    concentration: 0.4,
    note: 'Oak seedlings put a deep taproot down first, then a wide sinker-and-lateral system.',
  },
  rose: {
    kind: 'fibrous',
    maxDepth: 1.3,
    spread: 0.8,
    concentration: 0.5,
    note: 'Roses root moderately deep with a fibrous mass in the top half-metre.',
  },
  fern: {
    kind: 'rhizome',
    maxDepth: 0.55,
    spread: 2.4,
    concentration: 0.6,
    note: 'Ferns spread rhizomes and fine roots through the topsoil; they live off shallow water.',
  },
  bamboo: {
    kind: 'rhizome',
    maxDepth: 0.9,
    spread: 2.2,
    concentration: 0.45,
    note: 'Bamboo runs a dense rhizome mat sideways through the top metre.',
  },
  ivy: {
    kind: 'fibrous',
    maxDepth: 0.7,
    spread: 1.4,
    concentration: 0.55,
    note: 'Ivy roots are shallow and fibrous, mostly in the upper half-metre.',
  },
}

export function rootSystem(id: SpeciesId | string): RootSystemDef {
  return SPECIES_ROOTS[id as SpeciesId] ?? SPECIES_ROOTS.sunflower
}

// ---------------------------------------------------------------------------
// Chemistry
// ---------------------------------------------------------------------------

/** Amorphous-silica solubility relative to 20 °C (rises ~2× by 47 °C). */
export function silicaSolubility(tC: number): number {
  return Math.exp(0.026 * (tC - 20))
}

/**
 * Calcite solubility relative to 20 °C and background soil air: c_eq ∝ pCO₂^⅓
 * (carbonic-acid equilibrium) and is retrograde in temperature.
 */
export function calciteSolubility(tC: number, pco2: number): number {
  return Math.cbrt(Math.max(0.05, pco2)) * Math.exp(-0.012 * (tC - 20))
}

/** Soil pCO₂ relative to root-free soil air: root (and microbial) respiration. */
export function rhizospherePco2(rootDensity: number, activity: number): number {
  return 1 + PCO2_ROOT * rootDensity * activity
}

const weatheringRate = (tC: number) => Math.exp(0.06 * (tC - 20)) // Q10 ≈ 1.8

interface MineralDef {
  /** Roots' nucleation template factor (1 + k·R). */
  rootTemplate: number
  j0: number // nuclei / cell / day
  barrier: number // B in exp(−B / ln²S)
  sigmaCrit: number // BCF crossover for nodule growth
  growth: number // mm/day at σ = 1
  cementS: number // saturation above which grain coatings start to cement the pores
  cementRate: number // 1/day: fraction of the excess that cements per day
}

export const MINERALS: Record<SoilMineral, MineralDef> = {
  silica: { rootTemplate: 4, j0: 0.015, barrier: 0.08, sigmaCrit: 0.4, growth: 1.6, cementS: 1.18, cementRate: 0.25 },
  calcite: { rootTemplate: 6, j0: 0.015, barrier: 0.005, sigmaCrit: 0.25, growth: 2.2, cementS: 1.06, cementRate: 0.5 },
}

// ---------------------------------------------------------------------------
// Tunables
// ---------------------------------------------------------------------------

const MAX_SUBSTEP = 0.1 // days
const WILT = 0.16 // relative saturation below which roots cannot pull water
const CELL_MM = CELL_H * 1000 // mm of soil per cell height
const EVAP = 4 // mm/day potential surface evaporation
const DEMAND = 7 // mm/day transpiration per m² of canopy for a full-size plant in full sun
const K_ROOT = 4 // mm/day uptake per unit root density in moist soil
const DIFF_WATER = 0.7 // 1/day capillary redistribution
const DIFF_SOLUTE = 0.25 // 1/day solute diffusion
const EXCHANGE_RATE = 1.5 // 1/day solution ↔ exchange pool
const CA_NEED = 0.3 // root-zone calcium concentration for full nutrition
const CA_UPTAKE = 0.25 // calcium taken per unit water uptake per unit concentration (the rest piles up at the root surface)
const SI_UPTAKE = 0.35 // silica taken up with the transpiration stream (phytoliths)
const ROOT_ACID = 2 // silicate weathering boost from root exudates (× root density)
const PCO2_ROOT = 3 // rhizosphere pCO₂ boost (× root density × activity)
const CEMENT_PER_UNIT = 0.45 // pore fraction filled per unit of precipitated solute
const NODULE_MM3_PER_UNIT = 9000 // nodule volume per unit of solute
const MAX_CEMENT = 0.92
const CEMENT_DISSOLVE = 0.006 // pore fraction/day of cement redissolved at S = 0 (cements are durable)
export const HARDPAN = 0.5 // cement fraction roots cannot penetrate
const NUCLEATION_S = 1.03 // below this no new nodules
export const MAX_NODULES = 40
export const MAX_NODULE_RADIUS = 48 // mm
const ROOT_SPEED = 0.07 // m/day root front advance at growth rate 1
const SEEDLING_ROOT_DEPTH = 0.3 // m
const MIN_SPREAD = 0.35 // m

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

export interface SoilNodule {
  id: number
  col: number
  row: number
  mineral: SoilMineral
  radius: number // mm
  bornAt: number // soil age (days)
  /** Nucleated on a root (root-channel geode / rhizolith) rather than in open soil. */
  rooted: boolean
  /** Deterministic offsets inside the cell (−0.5…0.5) for drawing. */
  jx: number
  jz: number
}

export interface SoilState {
  t: number // days
  temperature: number // °C (lags the air)
  /** Water as a fraction of the cell's original pore space (≤ 1 − cement). */
  water: number[]
  silica: number[] // dissolved silica amount (concentration × water)
  calcium: number[] // dissolved calcium carbonate amount
  exchange: number[] // exchangeable calcium on clay / humus
  cementSilica: number[] // pore fraction filled by silica cement
  cementCalcite: number[] // pore fraction filled by calcite cement
  roots: number[] // root density 0–1
  rootFront: number[] // per column: depth (m) the roots reach now
  rootReach: number[] // per column: deepest the roots have ever reached (hardpans below it no longer stop them)
  rootDepth: number // m, where the deepest roots would be if nothing stopped them
  /** Depth (m) where a hardpan stops the main root, or null. */
  blockedAt: number | null
  nodules: SoilNodule[]
  nextId: number
  rng: number
  // last-step diagnostics, mm/day per m² of ground
  demand: number // transpiration demand under the canopy
  uptake: number // root water uptake under the canopy
  evaporation: number // bare-surface evaporation, slice mean
  drainage: number // deep drainage out of the slice, slice mean
  supply: number // 0–1 water uptake ÷ demand
  nutrient: number // 0–1 calcium availability
  pco2: number // root-weighted relative pCO₂
  leachedSilica: number // cumulative amount drained out of the slice
  leachedCalcium: number
}

export interface SoilWeather {
  temperature: number
  humidity: number
  light: number
  precipitation: number // mm/h
  wind: number
}

export interface SoilPlant {
  species: SpeciesId
  /** Relative plant size (biomass); scales transpiration demand. */
  biomass: number
  /** Weather-driven relative growth rate 0–1; drives root extension. */
  growth: number
  /** Respiration activity 0–1 (warmth × turgor); drives rhizosphere CO₂. */
  activity: number
}

// ---------------------------------------------------------------------------
// Construction
// ---------------------------------------------------------------------------

export function createSoilState(
  profileId: SoilProfileId,
  species: SpeciesId,
  seed = 2024,
  temperature = 18,
): SoilState {
  const p = SOIL_PROFILES[profileId]
  const water: number[] = []
  const silica: number[] = []
  const calcium: number[] = []
  const exchange: number[] = []
  for (let row = 0; row < SOIL_ROWS; row++) {
    // moister with depth: a soil a few days after rain
    const w = Math.min(0.95, p.fieldCapacity + 0.08 + 0.12 * (row / SOIL_ROWS))
    const ceqCa = calciteSolubility(temperature, 1)
    for (let col = 0; col < SOIL_COLS; col++) {
      water.push(w)
      silica.push(p.silica0 * silicaSolubility(temperature) * w)
      calcium.push(p.calcium0 * ceqCa * w)
      exchange.push(p.calcium0 * ceqCa * p.fieldCapacity * p.exchange)
    }
  }
  const zeros = () => new Array<number>(SOIL_CELLS).fill(0)
  const cementSilica = zeros()
  const cementCalcite = zeros()
  const root = rootSystem(species)
  const field = rootField(root, SEEDLING_ROOT_DEPTH, cementSilica, cementCalcite)
  return {
    t: 0,
    temperature,
    water,
    silica,
    calcium,
    exchange,
    cementSilica,
    cementCalcite,
    roots: field.roots,
    rootFront: field.fronts,
    rootReach: field.reach,
    rootDepth: SEEDLING_ROOT_DEPTH,
    blockedAt: field.blockedAt,
    nodules: [],
    nextId: 0,
    rng: seed >>> 0,
    demand: 0,
    uptake: 0,
    evaporation: 0,
    drainage: 0,
    supply: 1,
    nutrient: 1,
    pco2: 1,
    leachedSilica: 0,
    leachedCalcium: 0,
  }
}

// ---------------------------------------------------------------------------
// Roots
// ---------------------------------------------------------------------------

/**
 * Depth (m) of the top of the first hardpan cell in a column at or below
 * `below` (the depth roots there have already reached), or Infinity. A hardpan
 * stops roots that have not crossed it yet; roots it engulfs keep working.
 */
function hardpanTop(cementSilica: number[], cementCalcite: number[], col: number, below: number): number {
  for (let row = 0; row < SOIL_ROWS; row++) {
    const i = cellIndex(col, row)
    if (row * CELL_H >= below - 1e-9 && cementSilica[i] + cementCalcite[i] >= HARDPAN) return row * CELL_H
  }
  return Infinity
}

/** Lateral half-width (m) of the root zone. */
export function rootSpread(def: RootSystemDef, depth: number): number {
  return Math.max(MIN_SPREAD, Math.min(SOIL_WIDTH / 2, def.spread * depth))
}

export interface RootFieldResult {
  roots: number[] // density per cell
  fronts: number[] // per column: depth (m) roots can reach there now (root front, or a hardpan above it)
  reach: number[] // per column: deepest the roots have ever reached
  blockedAt: number | null // hardpan depth under the stem, if it stops the main root
}

/**
 * Root density per cell for a root front at `depth`: Gaussian laterally,
 * exponential with depth, a central taproot for taprooted species, nothing
 * below a hardpan the roots have not crossed yet (`reach`, per column), and
 * fewer roots where cement has filled the pores.
 */
export function rootField(
  def: RootSystemDef,
  depth: number,
  cementSilica: number[],
  cementCalcite: number[],
  reach: number[] = new Array<number>(SOIL_COLS).fill(0),
): RootFieldResult {
  const roots = new Array<number>(SOIL_CELLS).fill(0)
  const fronts = new Array<number>(SOIL_COLS).fill(0)
  const nextReach = reach.slice()
  const spread = rootSpread(def, depth)
  const centre = SOIL_COLS / 2 // the stem sits between cols centre-1 and centre
  let blockedAt: number | null = null
  for (let col = 0; col < SOIL_COLS; col++) {
    const x = cellX(col)
    const pan = hardpanTop(cementSilica, cementCalcite, col, reach[col])
    const front = Math.min(depth, pan)
    if ((col === centre || col === centre - 1) && pan < depth) blockedAt = blockedAt === null ? pan : Math.min(blockedAt, pan)
    const efold = def.concentration * front + 0.08
    const lateral = Math.exp(-((x / spread) ** 2))
    const tap = def.kind === 'taproot' ? 0.6 * Math.exp(-((x / 0.16) ** 2)) : 0
    let deepest = 0
    for (let row = 0; row < SOIL_ROWS; row++) {
      const z = cellZ(row)
      if (z > front) break
      const i = cellIndex(col, row)
      // roots proliferate just above a hardpan (perched water, nowhere else to go)
      const perched = pan < depth && z > pan - CELL_H * 1.5 ? 1.35 : 1
      const r = (Math.exp(-z / efold) * lateral + tap) * perched
      roots[i] = clamp01(r) * (1 - clamp01(cementSilica[i] + cementCalcite[i]))
      if (r > 0.04) deepest = z
    }
    fronts[col] = front
    if (deepest > 0) nextReach[col] = Math.max(reach[col], Math.min(front, deepest + CELL_H / 2))
  }
  return { roots, fronts, reach: nextReach, blockedAt }
}

// ---------------------------------------------------------------------------
// Step
// ---------------------------------------------------------------------------

/** Concentration of an amount in a water fraction (guards dry cells). */
const conc = (amount: number, water: number) => amount / Math.max(water, 1e-3)

export function stepSoil(
  state: SoilState,
  profileId: SoilProfileId,
  weather: SoilWeather,
  plant: SoilPlant,
  days: number,
): SoilState {
  if (days <= 0) return state
  const p = SOIL_PROFILES[profileId]
  const root = rootSystem(plant.species)
  const poreMM = p.porosity * CELL_MM // mm of water in a full cell

  const water = state.water.slice()
  const silica = state.silica.slice()
  const calcium = state.calcium.slice()
  const exchange = state.exchange.slice()
  const cementSi = state.cementSilica.slice()
  const cementCa = state.cementCalcite.slice()
  let roots = state.roots
  let reach = state.rootReach
  let nodules = state.nodules.map((n) => ({ ...n }))
  const noduleAt = new Map<number, SoilNodule>()
  for (const n of nodules) noduleAt.set(cellIndex(n.col, n.row), n)
  let { rng, nextId, rootDepth } = state
  let temperature = state.temperature
  let leachedSilica = state.leachedSilica
  let leachedCalcium = state.leachedCalcium

  let canopy = 1 // canopy width in columns (for per-area diagnostics)
  let sumDemand = 0
  let sumUptake = 0
  let sumEvap = 0
  let sumDrain = 0
  let supply = state.supply

  const cap = (i: number) => Math.max(0.02, 1 - cementSi[i] - cementCa[i])
  const steps = Math.max(1, Math.ceil(days / MAX_SUBSTEP))
  const dt = days / steps
  const pco2 = new Array<number>(SOIL_CELLS)

  for (let s = 0; s < steps; s++) {
    // soil temperature lags the air by ~2 days
    temperature += (weather.temperature - temperature) * (1 - Math.exp(-dt / 2))
    const vpd = clamp01((temperature + 5) / 30) * (0.35 + 0.65 * (1 - weather.humidity)) * (1 + 0.05 * weather.wind)

    // --- 1a. infiltration: rain fills the top, the overflow cascades down ---
    const rain = (weather.precipitation * 24 * dt) / poreMM // in pore fractions
    for (let col = 0; col < SOIL_COLS && rain > 0; col++) {
      let add = rain
      for (let row = 0; row < 4 && add > 0; row++) {
        const i = cellIndex(col, row)
        const room = Math.max(0, cap(i) - water[i])
        const take = Math.min(room, add)
        water[i] += take
        add -= take
      }
      // what doesn't fit runs off
    }

    // --- 1b. surface evaporation (solutes stay behind) ---
    for (let col = 0; col < SOIL_COLS; col++) {
      const i = cellIndex(col, 0)
      const e = Math.min(water[i] * 0.5, ((EVAP * vpd * (water[i] / cap(i))) * dt) / poreMM)
      water[i] -= e
      sumEvap += e * poreMM
    }

    // --- 1c. gravity drainage, bottom-up so freed space can be refilled ---
    const kd = 1 - Math.exp(-p.conductivity * dt)
    for (let row = SOIL_ROWS - 1; row >= 0; row--) {
      for (let col = 0; col < SOIL_COLS; col++) {
        const i = cellIndex(col, row)
        const excess = water[i] - p.fieldCapacity * cap(i)
        if (excess <= 0) continue
        // cemented pores also conduct less
        let q = excess * kd * cap(i)
        const below = row + 1 < SOIL_ROWS ? cellIndex(col, row + 1) : -1
        if (below >= 0) q = Math.min(q, Math.max(0, cap(below) - water[below]))
        if (q <= 0) continue
        const f = q / water[i]
        const qs = silica[i] * f
        const qc = calcium[i] * f
        water[i] -= q
        silica[i] -= qs
        calcium[i] -= qc
        if (below >= 0) {
          water[below] += q
          silica[below] += qs
          calcium[below] += qc
        } else {
          sumDrain += q * poreMM
          leachedSilica += qs
          leachedCalcium += qc
        }
      }
    }

    // --- 1d. capillary redistribution + solute diffusion (Jacobi) ---
    {
      const dw = new Array<number>(SOIL_CELLS).fill(0)
      const dsi = new Array<number>(SOIL_CELLS).fill(0)
      const dca = new Array<number>(SOIL_CELLS).fill(0)
      const kw = DIFF_WATER * dt
      const ks = DIFF_SOLUTE * dt
      const pair = (a: number, b: number) => {
        const ca = cap(a)
        const cb = cap(b)
        // water flows down the relative-saturation gradient, carrying solute upwind
        const q = (kw * (water[a] / ca - water[b] / cb) * Math.min(ca, cb)) / 2
        const src = q > 0 ? a : b
        const csi = conc(silica[src], water[src])
        const cca = conc(calcium[src], water[src])
        dw[a] -= q
        dw[b] += q
        dsi[a] -= q * csi
        dsi[b] += q * csi
        dca[a] -= q * cca
        dca[b] += q * cca
        // molecular diffusion
        const wm = Math.min(water[a], water[b]) / 2
        const fsi = ks * wm * (conc(silica[a], water[a]) - conc(silica[b], water[b]))
        const fca = ks * wm * (conc(calcium[a], water[a]) - conc(calcium[b], water[b]))
        dsi[a] -= fsi
        dsi[b] += fsi
        dca[a] -= fca
        dca[b] += fca
      }
      for (let row = 0; row < SOIL_ROWS; row++) {
        for (let col = 0; col < SOIL_COLS; col++) {
          const i = cellIndex(col, row)
          if (col + 1 < SOIL_COLS) pair(i, i + 1)
          if (row + 1 < SOIL_ROWS) pair(i, i + SOIL_COLS)
        }
      }
      for (let i = 0; i < SOIL_CELLS; i++) {
        water[i] = Math.max(0, water[i] + dw[i])
        silica[i] = Math.max(0, silica[i] + dsi[i])
        calcium[i] = Math.max(0, calcium[i] + dca[i])
      }
    }

    // --- 1e. root water uptake (solutes mostly excluded) ---
    // demand over the slice: per-area transpiration × the width the canopy shades
    const size = Math.min(1.6, 0.35 + plant.biomass * 0.6)
    const canopyCols = (2 * rootSpread(root, rootDepth) * Math.min(1, size)) / CELL_W
    const demand = DEMAND * size * clamp01(weather.light) * vpd * canopyCols
    let potential = 0
    const pot = new Array<number>(SOIL_CELLS).fill(0)
    const band = (p.fieldCapacity - WILT) || 0.3
    for (let i = 0; i < SOIL_CELLS; i++) {
      if (roots[i] <= 0) continue
      // hydraulic conductivity of drying soil collapses faster than its water content
      const avail = clamp01((water[i] / cap(i) - WILT) / band) ** 1.5
      pot[i] = roots[i] * K_ROOT * avail
      potential += pot[i]
    }
    supply = demand < 1e-3 ? 1 : Math.min(1, potential / demand)
    const actual = Math.min(demand, potential) * dt // mm this substep
    if (actual > 0 && potential > 0) {
      for (let i = 0; i < SOIL_CELLS; i++) {
        if (pot[i] <= 0) continue
        const floor = WILT * cap(i)
        const take = Math.min((actual * pot[i]) / potential / poreMM, Math.max(0, water[i] - floor))
        if (take <= 0) continue
        const cCa = conc(calcium[i], water[i])
        const cSi = conc(silica[i], water[i])
        water[i] -= take
        calcium[i] = Math.max(0, calcium[i] - CA_UPTAKE * take * cCa)
        silica[i] = Math.max(0, silica[i] - SI_UPTAKE * take * cSi)
        sumUptake += take * poreMM
      }
    }
    sumDemand += demand * dt
    canopy = canopyCols

    // --- 2. chemistry, 3. precipitation ---
    const kx = 1 - Math.exp(-EXCHANGE_RATE * dt)
    const wr = weatheringRate(temperature)
    const ceqSi = silicaSolubility(temperature)
    for (let i = 0; i < SOIL_CELLS; i++) {
      const row = Math.floor(i / SOIL_COLS)
      const R = roots[i]
      const w = water[i]
      pco2[i] = rhizospherePco2(R, plant.activity)
      if (w < 1e-3) continue
      const ceqCa = calciteSolubility(temperature, pco2[i])

      // exchangeable calcium buffers the solution: the pool holds `exchange`
      // times what a soil at field capacity holds in solution at the same concentration
      {
        const total = calcium[i] + exchange[i]
        const cStar = total / (w + p.exchange * p.fieldCapacity)
        const f = (cStar * w - calcium[i]) * kx
        exchange[i] -= f
        calcium[i] += f
      }

      const parent = parentFraction(p, cellZ(row))
      for (const mineral of ['silica', 'calcite'] as const) {
        const amount = mineral === 'silica' ? silica : calcium
        const cement = mineral === 'silica' ? cementSi : cementCa
        const ceq = mineral === 'silica' ? ceqSi : ceqCa
        const S = conc(amount[i], w) / ceq
        const m = MINERALS[mineral]
        if (S < 1) {
          // dissolve earlier cement first, then parent material (root exudates attack silicates)
          let room = (ceq * w - amount[i]) * (1 - Math.exp(-4 * dt))
          const back = Math.min(cement[i], CEMENT_DISSOLVE * wr * (1 - S) * dt, room * CEMENT_PER_UNIT)
          cement[i] -= back
          amount[i] += back / CEMENT_PER_UNIT
          room -= back / CEMENT_PER_UNIT
          const k = mineral === 'silica' ? p.silicaWeathering * (1 + ROOT_ACID * R) : p.calciteWeathering
          amount[i] += Math.max(0, Math.min(room, k * parent * wr * (1 - S) * ceq * w * dt))
        } else if (S > m.cementS) {
          const excess = (S - m.cementS) * ceq * w
          const prec = excess * (1 - Math.exp(-m.cementRate * dt))
          const room = (MAX_CEMENT - cementSi[i] - cementCa[i]) / CEMENT_PER_UNIT
          const take = Math.max(0, Math.min(prec, room))
          amount[i] -= take
          cement[i] += take * CEMENT_PER_UNIT
        }

        // nodules: growth / dissolution on an existing one, or nucleation
        const n = noduleAt.get(i)
        const S2 = conc(amount[i], w) / ceq
        if (n && n.mineral === mineral) {
          const sigma = S2 - 1
          let dr = m.growth * wr * growthLaw(sigma, m.sigmaCrit) * dt
          if (sigma < 0) dr *= 0.35 // dissolution only works at the outer rind
          const r0 = n.radius
          let r1 = Math.min(MAX_NODULE_RADIUS, Math.max(0, r0 + dr))
          const dV = (4 / 3) * Math.PI * (r1 ** 3 - r0 ** 3) // mm³
          let dAmount = dV / NODULE_MM3_PER_UNIT
          if (dAmount > 0) {
            const avail = Math.max(0, amount[i] - ceq * w)
            if (dAmount > avail) {
              dAmount = avail
              r1 = Math.cbrt(r0 ** 3 + (dAmount * NODULE_MM3_PER_UNIT * 3) / (4 * Math.PI))
            }
          }
          amount[i] = Math.max(0, amount[i] - dAmount)
          n.radius = r1
        } else if (!n && row > 0 && S2 > NUCLEATION_S && nodules.length < MAX_NODULES) {
          // (the surface row only crusts: nodules need a little burial)
          const ln = Math.log(S2)
          const J = m.j0 * (1 + m.rootTemplate * R) * Math.exp(-m.barrier / (ln * ln))
          let u: number
          ;[u, rng] = rand(rng)
          if (u < J * dt) {
            let jx: number, jz: number
            ;[jx, rng] = rand(rng)
            ;[jz, rng] = rand(rng)
            const nod: SoilNodule = {
              id: nextId++,
              col: i % SOIL_COLS,
              row,
              mineral,
              radius: 1.5,
              bornAt: state.t + (s + 1) * dt,
              rooted: R > 0.15,
              jx: jx - 0.5,
              jz: jz - 0.5,
            }
            nodules.push(nod)
            noduleAt.set(i, nod)
            amount[i] = Math.max(0, amount[i] - ((4 / 3) * Math.PI * 1.5 ** 3) / NODULE_MM3_PER_UNIT)
          }
        }
      }
      // cement squeezes water out of the pores it fills
      water[i] = Math.min(water[i], cap(i))
    }
    nodules = nodules.filter((n) => {
      if (n.radius > 0.5) return true
      noduleAt.delete(cellIndex(n.col, n.row))
      return false
    })

    // --- 4. roots deepen with growth, up to the species' depth ---
    rootDepth = Math.min(
      root.maxDepth,
      rootDepth + ROOT_SPEED * clamp01(plant.growth) * (1 - rootDepth / (root.maxDepth + 0.05)) * dt,
    )
    const f = rootField(root, rootDepth, cementSi, cementCa, reach)
    roots = f.roots
    reach = f.reach
  }

  const field = rootField(root, rootDepth, cementSi, cementCa, reach)
  // the plant cannot pull a taproot past a hardpan: the front waits on top of it
  if (field.blockedAt !== null) rootDepth = Math.min(rootDepth, field.blockedAt + CELL_H * 0.5)

  // root-weighted calcium and pCO₂ for the plant / UI
  let rSum = 0
  let caSum = 0
  let pSum = 0
  for (let i = 0; i < SOIL_CELLS; i++) {
    const R = field.roots[i]
    if (R <= 0) continue
    rSum += R
    caSum += R * conc(calcium[i], water[i])
    pSum += R * pco2[i]
  }
  const nutrient = rSum > 0 ? clamp01(caSum / rSum / CA_NEED) : 0

  return {
    t: state.t + days,
    temperature,
    water,
    silica,
    calcium,
    exchange,
    cementSilica: cementSi,
    cementCalcite: cementCa,
    roots: field.roots,
    rootFront: field.fronts,
    rootReach: field.reach,
    rootDepth,
    blockedAt: field.blockedAt,
    nodules,
    nextId,
    rng,
    demand: sumDemand / days / canopy,
    uptake: sumUptake / days / canopy,
    evaporation: sumEvap / days / SOIL_COLS,
    drainage: sumDrain / days / SOIL_COLS,
    supply,
    nutrient,
    pco2: rSum > 0 ? pSum / rSum : 1,
    leachedSilica,
    leachedCalcium,
  }
}

// ---------------------------------------------------------------------------
// Read-only helpers for views / UI
// ---------------------------------------------------------------------------

/** Relative saturation (0–1) of the open pore space. */
export function cellMoisture(s: SoilState, i: number): number {
  return clamp01(s.water[i] / Math.max(0.02, 1 - s.cementSilica[i] - s.cementCalcite[i]))
}

/** Saturation index S = c / c_eq of a cell for one mineral (activity = current). */
export function cellSaturation(s: SoilState, i: number, mineral: SoilMineral, activity = 1): number {
  const w = s.water[i]
  if (mineral === 'silica') return conc(s.silica[i], w) / silicaSolubility(s.temperature)
  return conc(s.calcium[i], w) / calciteSolubility(s.temperature, rhizospherePco2(s.roots[i], activity))
}

export function noduleLabel(n: Pick<SoilNodule, 'mineral' | 'rooted' | 'radius'>): string {
  if (n.mineral === 'silica') return n.rooted && n.radius > 10 ? 'Root-channel geode' : 'Chert nodule'
  return n.rooted ? 'Rhizolith' : 'Calcite nodule'
}

export interface SoilMetrics {
  rootZoneMoisture: number // root-weighted relative saturation
  silicaS: number // root-weighted saturation index
  calciteS: number
  maxCement: number
  cementDepth: number | null // shallowest depth (m) where cement exceeds 25%
  nodules: { silica: number; calcite: number }
  largest: SoilNodule | null
}

export function soilMetrics(s: SoilState, activity = 1): SoilMetrics {
  let rSum = 0
  let m = 0
  let si = 0
  let ca = 0
  let maxCement = 0
  let cementDepth: number | null = null
  for (let i = 0; i < SOIL_CELLS; i++) {
    const c = s.cementSilica[i] + s.cementCalcite[i]
    maxCement = Math.max(maxCement, c)
    if (c > 0.25) {
      const z = Math.floor(i / SOIL_COLS) * CELL_H
      cementDepth = cementDepth === null ? z : Math.min(cementDepth, z)
    }
    const R = s.roots[i]
    if (R <= 0) continue
    rSum += R
    m += R * cellMoisture(s, i)
    si += R * cellSaturation(s, i, 'silica', activity)
    ca += R * cellSaturation(s, i, 'calcite', activity)
  }
  let largest: SoilNodule | null = null
  const count = { silica: 0, calcite: 0 }
  for (const n of s.nodules) {
    count[n.mineral]++
    if (!largest || n.radius > largest.radius) largest = n
  }
  return {
    rootZoneMoisture: rSum > 0 ? m / rSum : 0,
    silicaS: rSum > 0 ? si / rSum : 0,
    calciteS: rSum > 0 ? ca / rSum : 0,
    maxCement,
    cementDepth,
    nodules: count,
    largest,
  }
}

/** Largest silica nodule big enough to call a geode, if any. */
export function largestGeode(s: SoilState): SoilNodule | null {
  let best: SoilNodule | null = null
  for (const n of s.nodules) if (n.mineral === 'silica' && n.radius > 10 && (!best || n.radius > best.radius)) best = n
  return best
}
