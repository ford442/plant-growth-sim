/**
 * Species physiology (pure — no Three.js, no store imports).
 *
 * One table of plain numbers per species ({@link SPECIES_PHYSIOLOGY}) and a few
 * pure functions over it. Everything that used to be a magic constant in the
 * plant step lives here: the cardinal-temperature response, light compensation
 * and saturation, the drought floor, wind lodging, the height ceiling, how often
 * the architecture takes another L-system iteration, and how fast plant water
 * follows the soil.
 *
 * The model is one **relative growth rate** `rate ∈ [0, 1]` — the product of
 * independent 0–1 limits (temperature × light × water × wind × nutrition). Height,
 * biomass and architecture all advance by it, so they cannot drift apart. It is
 * deliberately not an FSPM: no organ pools, no allometry, no nitrogen.
 *
 * Rain is *not* an input here. Water reaches the plant only through the soil
 * field (`SoilField.ts`): `waterStatus` relaxes towards the soil's `supply`
 * ({@link followSoil}), with a per-species lag. The sim does not add a direct
 * rain → water shortcut.
 *
 * Time flows one way: `clock.ts` calls {@link stepPhysiology} on the fixed step.
 */
import { SPECIES_LSYSTEMS, architectureCap } from './LSystem'
import { MAX_ITERATIONS, MIN_ITERATIONS, advanceDevelopment } from './LSystemMorph'
import type { SpeciesId } from './species'
// type-only (erased at build time): the weather vocabulary lives with the store
import type { WeatherState } from '../stores/simStore'

export interface SpeciesPhysiology {
  id: SpeciesId
  /** Height of a seedling, m. */
  height0: number
  /** Height the species levels off at, m (logistic ceiling). */
  heightMax: number
  /** Relative height growth per day at rate 1, 1/day (logistic r). */
  heightRate: number

  /** Air temperature below which nothing grows, °C. */
  tMin: number
  /** Air temperature of fastest growth, °C. */
  tOpt: number
  /** Air temperature above which nothing grows, °C. */
  tMax: number

  /** PAR (relative 0–1) at which photosynthesis just pays for respiration: no growth at or below it. */
  lightCompensation: number
  /** PAR (relative 0–1) at which the light response saturates: more light adds nothing. */
  lightSaturation: number

  /** Plant water status (0–1) at which growth stops; it rises linearly to full growth at 1. A high floor = thirsty. */
  droughtFloor: number
  /** Relative humidity (0–1) the leaves want; drier air scales growth down in proportion. */
  humidityNeed: number
  /** Days for plant water to follow the soil's supply (hydraulic buffering: a tall tree holds water longer). */
  waterLagDays: number

  /** Fraction of growth lost at {@link LODGING_WIND} (m/s) and above; scales with wind speed squared. */
  windLodging: number

  /** Days of ideal growth (rate 1) per added L-system iteration. */
  iterationEveryDays: number
  /** Last iteration the sim develops; also clamped by the architecture segment budget (see {@link iterationCeiling}). */
  maxIterations: number
}

/** Wind speed (m/s) at which {@link SpeciesPhysiology.windLodging} is fully applied. */
export const LODGING_WIND = 15
/** Biomass gained per day at rate 1 (relative units). */
export const BIOMASS_PER_DAY = 0.08
/** Days for nutrition to follow the soil's calcium availability. */
export const NUTRIENT_LAG_DAYS = 3
/** Plant water never reads below this (a wilted plant is still alive). */
export const MIN_WATER_STATUS = 0.05
/** Every limit at or above this counts as "not limiting". */
export const LIMIT_THRESHOLD = 0.9

/**
 * The six presets. Numbers are tuned to read plausibly and to diverge visibly, not
 * calibrated against field data — keep them here, never inline.
 */
export const SPECIES_PHYSIOLOGY: Record<SpeciesId, SpeciesPhysiology> = {
  // fast annual: warm, sun-hungry, thirsty, a tall stem that lodges in gales
  sunflower: {
    id: 'sunflower',
    height0: 0.15,
    heightMax: 2.5,
    heightRate: 0.09,
    tMin: 6,
    tOpt: 24,
    tMax: 38,
    lightCompensation: 0.12,
    lightSaturation: 0.85,
    droughtFloor: 0.35,
    humidityNeed: 0.4,
    waterLagDays: 1,
    windLodging: 0.35,
    iterationEveryDays: 3,
    maxIterations: 7,
  },
  // slow, cool-temperate, huge in the end, holds water in its wood
  oak: {
    id: 'oak',
    height0: 0.15,
    heightMax: 7,
    heightRate: 0.03,
    tMin: 3,
    tOpt: 18,
    tMax: 34,
    lightCompensation: 0.1,
    lightSaturation: 0.7,
    droughtFloor: 0.12,
    humidityNeed: 0.35,
    waterLagDays: 4,
    windLodging: 0.1,
    iterationEveryDays: 6,
    maxIterations: 7,
  },
  // moderate shrub: flowering-range temperatures, a wind-sensitive stem
  rose: {
    id: 'rose',
    height0: 0.15,
    heightMax: 1.8,
    heightRate: 0.055,
    tMin: 5,
    tOpt: 21,
    tMax: 32,
    lightCompensation: 0.15,
    lightSaturation: 0.75,
    droughtFloor: 0.25,
    humidityNeed: 0.5,
    waterLagDays: 1.5,
    windLodging: 0.5,
    iterationEveryDays: 4,
    maxIterations: 6,
  },
  // understory: saturates in dim light, needs humid air, prefers cool
  fern: {
    id: 'fern',
    height0: 0.1,
    heightMax: 1.2,
    heightRate: 0.045,
    tMin: 4,
    tOpt: 17,
    tMax: 28,
    lightCompensation: 0.04,
    lightSaturation: 0.4,
    droughtFloor: 0.3,
    humidityNeed: 0.75,
    waterLagDays: 2,
    windLodging: 0.3,
    iterationEveryDays: 4,
    maxIterations: 6,
  },
  // very fast vertical; its architecture is the most expensive, so the budget clamps it
  bamboo: {
    id: 'bamboo',
    height0: 0.15,
    heightMax: 5,
    heightRate: 0.14,
    tMin: 8,
    tOpt: 27,
    tMax: 38,
    lightCompensation: 0.15,
    lightSaturation: 0.9,
    droughtFloor: 0.3,
    humidityNeed: 0.55,
    waterLagDays: 1.5,
    windLodging: 0.2,
    iterationEveryDays: 2,
    maxIterations: 7,
  },
  // slow climber: tolerates deep shade, little wind lodging (it clings)
  ivy: {
    id: 'ivy',
    height0: 0.1,
    heightMax: 3,
    heightRate: 0.035,
    tMin: 3,
    tOpt: 19,
    tMax: 33,
    lightCompensation: 0.03,
    lightSaturation: 0.5,
    droughtFloor: 0.2,
    humidityNeed: 0.45,
    waterLagDays: 2,
    windLodging: 0.05,
    iterationEveryDays: 5,
    maxIterations: 7,
  },
}

/**
 * The last iteration the sim develops for a species: its own `maxIterations`,
 * the global ceiling, and the architecture's segment budget — whichever is
 * lowest. The budget wins, so a bamboo cannot schedule a 78 k-segment string.
 */
const ceilings = new Map<SpeciesId, number>()
export function iterationCeiling(species: SpeciesId): number {
  let n = ceilings.get(species)
  if (n === undefined) {
    n = Math.min(
      SPECIES_PHYSIOLOGY[species].maxIterations,
      MAX_ITERATIONS,
      architectureCap(SPECIES_LSYSTEMS[species], MAX_ITERATIONS),
    )
    n = Math.max(MIN_ITERATIONS, n)
    ceilings.set(species, n)
  }
  return n
}

// ---------------------------------------------------------------------------
// Responses (each 0–1)
// ---------------------------------------------------------------------------

const clamp01 = (x: number) => (x < 0 ? 0 : x > 1 ? 1 : x)

/**
 * Cardinal-temperature (beta) response: 0 at and beyond `tMin` / `tMax`, exactly
 * 1 at `tOpt`, skewed so the fall-off past the optimum is as steep as the
 * species' `tMax − tOpt` makes it (Yan & Hunt 1999).
 */
export function temperatureResponse(t: number, p: Pick<SpeciesPhysiology, 'tMin' | 'tOpt' | 'tMax'>): number {
  if (!(t > p.tMin) || !(t < p.tMax)) return 0
  const a = (p.tOpt - p.tMin) / (p.tMax - p.tOpt)
  return clamp01(((p.tMax - t) / (p.tMax - p.tOpt)) * ((t - p.tMin) / (p.tOpt - p.tMin)) ** a)
}

/** Light response: 0 at the compensation point, concave, 1 from the saturation point up. */
export function lightResponse(par: number, p: Pick<SpeciesPhysiology, 'lightCompensation' | 'lightSaturation'>): number {
  const x = clamp01((par - p.lightCompensation) / (p.lightSaturation - p.lightCompensation))
  return 1 - (1 - x) * (1 - x)
}

/** Water response: 0 at the drought floor, linear to 1 at a fully turgid plant. */
export function waterResponse(water: number, p: Pick<SpeciesPhysiology, 'droughtFloor'>): number {
  return clamp01((water - p.droughtFloor) / (1 - p.droughtFloor))
}

/** Air-dryness response: 1 once humidity meets the species' need, proportionally less below it. */
export function humidityResponse(humidity: number, p: Pick<SpeciesPhysiology, 'humidityNeed'>): number {
  return clamp01(humidity / p.humidityNeed)
}

/** Wind response: 1 in still air, `1 − windLodging` at {@link LODGING_WIND}; drag grows with speed². */
export function windResponse(wind: number, p: Pick<SpeciesPhysiology, 'windLodging'>): number {
  const x = clamp01(wind / LODGING_WIND)
  return 1 - p.windLodging * x * x
}

export type LimitingFactor = 'cold' | 'heat' | 'dark' | 'drought' | 'wind' | 'nutrient' | 'none'

export interface GrowthFactors {
  temperature: number
  light: number
  /** Soil water × air dryness: both are "not enough water" to the plant. */
  water: number
  wind: number
  nutrient: number
  /** The product of the above: relative growth rate, 0–1. */
  rate: number
  /** The smallest factor, if it is below {@link LIMIT_THRESHOLD}; otherwise `'none'`. */
  limiting: LimitingFactor
}

/** What the plant reads each step. Units follow {@link WeatherState}. */
export type PhysiologyWeather = Pick<WeatherState, 'temperature' | 'humidity' | 'light' | 'wind'>

/** The plant fields the kernel reads and writes (the store's state is a superset). */
export interface PhysiologyState {
  species: SpeciesId
  height: number // m
  biomass: number // relative
  waterStatus: number // 0–1 (wilted → turgid)
  nutrientStatus: number // 0–1
  growthRate: number // biomass per day (relative)
  lsystemProgress: number // continuous L-system stage
}

/** The limits on growth right now, and which one binds. Pure; the UI calls it too, so it stays live while paused. */
export function growthFactors(
  species: SpeciesId,
  weather: PhysiologyWeather,
  waterStatus: number,
  nutrientStatus: number,
): GrowthFactors {
  const p = SPECIES_PHYSIOLOGY[species]
  const temperature = temperatureResponse(weather.temperature, p)
  const light = lightResponse(weather.light, p)
  const water = waterResponse(waterStatus, p) * humidityResponse(weather.humidity, p)
  const wind = windResponse(weather.wind, p)
  const nutrient = clamp01(nutrientStatus)
  const rate = temperature * light * water * wind * nutrient

  const candidates: [number, LimitingFactor][] = [
    [temperature, weather.temperature < p.tOpt ? 'cold' : 'heat'],
    [light, 'dark'],
    [water, 'drought'],
    [wind, 'wind'],
    [nutrient, 'nutrient'],
  ]
  let [lowest, limiting] = candidates[0]
  for (const [v, name] of candidates) if (v < lowest) [lowest, limiting] = [v, name]
  return { temperature, light, water, wind, nutrient, rate, limiting: lowest >= LIMIT_THRESHOLD ? 'none' : limiting }
}

// ---------------------------------------------------------------------------
// The step
// ---------------------------------------------------------------------------

/** A fresh seedling's plant fields: day 0, the species' seedling height, iteration 2, 85 % turgid, full calcium. */
export function createPhysiology(species: SpeciesId): PhysiologyState {
  return {
    species,
    height: SPECIES_PHYSIOLOGY[species].height0,
    biomass: 0.1,
    waterStatus: 0.85,
    nutrientStatus: 1,
    growthRate: 0,
    lsystemProgress: MIN_ITERATIONS,
  }
}

/**
 * One integration step of `days` simulated days. Pure: the input is not mutated.
 *
 * Grows height (logistic towards `heightMax`), biomass and the architecture's
 * development stage by the same relative rate. The plant's water and nutrition
 * are left as they were; {@link followSoil} moves them once the soil has been
 * stepped with this step's `rate` (see `GrowthFactors.rate`).
 */
export function stepPhysiology(plant: PhysiologyState, weather: PhysiologyWeather, days: number): PhysiologyState {
  const p = SPECIES_PHYSIOLOGY[plant.species]
  const { rate } = growthFactors(plant.species, weather, plant.waterStatus, plant.nutrientStatus)
  const growth = days * BIOMASS_PER_DAY * rate
  const h = plant.height
  const height = Math.min(p.heightMax, Math.max(h, h + days * rate * p.heightRate * h * (1 - h / p.heightMax)))
  return {
    ...plant,
    height,
    biomass: plant.biomass + growth,
    growthRate: growth / Math.max(days, 0.001),
    lsystemProgress: advanceDevelopment(
      plant.lsystemProgress,
      days,
      rate,
      p.iterationEveryDays,
      iterationCeiling(plant.species),
    ),
  }
}

/**
 * Let plant water and nutrition relax towards what the root zone delivers
 * (`soil.supply`, `soil.nutrient`, both 0–1) over `days`. Under drought the
 * supply drops and the plant follows within `waterLagDays`; under rain it
 * recovers the same way. This is the only way water gets into the plant.
 */
export function followSoil(
  plant: PhysiologyState,
  soil: { supply: number; nutrient: number },
  days: number,
): PhysiologyState {
  const p = SPECIES_PHYSIOLOGY[plant.species]
  const water = plant.waterStatus + (soil.supply - plant.waterStatus) * (1 - Math.exp(-days / p.waterLagDays))
  const nutrient = plant.nutrientStatus + (soil.nutrient - plant.nutrientStatus) * (1 - Math.exp(-days / NUTRIENT_LAG_DAYS))
  return {
    ...plant,
    waterStatus: Math.max(MIN_WATER_STATUS, Math.min(1, water)),
    nutrientStatus: Math.min(1, nutrient),
  }
}
