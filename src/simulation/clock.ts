/**
 * The simulation clock (pure — no Three.js, no store imports).
 *
 * Real frames arrive at whatever interval the browser feels like: 60 Hz, 144 Hz,
 * a slow phone, a tab that just woke up after ten minutes. If the model were
 * integrated once per frame with that `dt`, growth would depend on the device
 * and a single hitch would apply its whole gap as growth in one step. Instead:
 *
 *  1. a frame is **clamped** to {@link MAX_FRAME_SECONDS} of real time — the
 *     excess is dropped, not queued, so a stall plays as a brief slow-motion
 *     rather than a jump (or a burst of catch-up work afterwards);
 *  2. what is left goes into an **accumulator** and is spent as identical
 *     **fixed steps** of {@link FIXED_STEP_SECONDS}; the leftover (a fraction of
 *     a step, in [0, 1)) is carried to the next frame.
 *
 * So the plant after N seconds of play is a function of N and the speed, not of
 * how those seconds were cut into frames.
 *
 * `advanceClock` is generic over the state it steps — the plant uses
 * {@link advancePlant}; a gem or parasite sim can hand it its own
 * `(state, days) => state` and get the same shape back. Play / pause / speed
 * live in `timeStore` and arrive here as plain inputs.
 */
import { stepCrystal, type CrystalState } from './CrystalGrowth'
import type { GemstoneId, GeologyState } from './GemstonePresets'
import { advanceDevelopment, MIN_ITERATIONS, stageOf } from './LSystemMorph'
import { createSoilState, stepSoil, type SoilProfileId, type SoilState } from './SoilField'
import { createTissueState, stepTissue, type TissueState } from './TissueGrowth'
// type-only (erased at build time): the species / weather vocabulary lives with the store
import type { SpeciesId } from './species'
import type { WeatherState } from '../stores/simStore'

/** Longest real-time frame the sim will integrate. A longer one is cut to this. */
export const MAX_FRAME_SECONDS = 0.1
/** Real seconds per simulation step (at speed 1 = 1 simulated day per second ÷ 30). */
export const FIXED_STEP_SECONDS = 1 / 30

/** Absorbs float error so 0.1 s ÷ (1/30 s) is exactly 3 steps, not 2.9999999999999996. */
const STEP_EPSILON = 1e-9

/** A usable frame time: finite and ≥ 0, cut to {@link MAX_FRAME_SECONDS}. */
export function clampFrame(dtSeconds: number): number {
  if (!(dtSeconds > 0) || !Number.isFinite(dtSeconds)) return 0
  return Math.min(dtSeconds, MAX_FRAME_SECONDS)
}

/** What the shared time controls say for this frame. */
export interface ClockInput {
  /** Real seconds since the previous frame (clamped inside). */
  dt: number
  /** Simulated days per real second (`timeStore.speed`). */
  speed: number
  /** `timeStore.isPlaying`. Paused: nothing advances, nothing accumulates. */
  playing: boolean
}

export interface ClockResult<T> {
  state: T
  /** Part of a step still owed, in [0, 1). Pass it back in next frame. */
  accumulator: number
  /** Fixed steps run this frame. */
  steps: number
}

/**
 * Spend one frame of real time as whole fixed steps. `step(state, days)` must be
 * pure; it is called once per step with `FIXED_STEP_SECONDS × speed` days.
 *
 * When nothing runs (paused, zero speed, or less than a step owed) the *same*
 * `state` object comes back, so a caller can skip a store write by identity.
 */
export function advanceClock<T>(
  state: T,
  step: (state: T, days: number) => T,
  accumulator: number,
  input: ClockInput,
): ClockResult<T> {
  const { speed, playing } = input
  if (!playing || !(speed > 0) || !Number.isFinite(speed)) return { state, accumulator, steps: 0 }

  const owed = accumulator + clampFrame(input.dt) / FIXED_STEP_SECONDS
  const whole = Math.floor(owed + STEP_EPSILON)
  const remainder = Math.max(0, owed - whole)
  if (whole === 0) return { state, accumulator: remainder, steps: 0 }

  const days = FIXED_STEP_SECONDS * speed
  let s = state
  for (let i = 0; i < whole; i++) s = step(s, days)
  return { state: s, accumulator: remainder, steps: whole }
}

// ---------------------------------------------------------------------------
// The plant (and its gem / soil / tissue companions) on this clock
// ---------------------------------------------------------------------------

/** Everything one plant step reads and writes. The store's state is a superset. */
export interface PlantSnapshot {
  species: SpeciesId
  soilProfile: SoilProfileId
  gemstone: GemstoneId
  geology: GeologyState
  weather: WeatherState

  time: number // simulation days
  age: number // days
  height: number // m
  biomass: number // relative
  waterStatus: number // 0-1 (wilting to turgid); follows root water uptake from the soil field
  nutrientStatus: number // 0-1 calcium nutrition from the root zone; scales growth
  growthRate: number // current relative growth rate

  /** Continuous L-system stage; `lsystemIterations` is its whole part (see `stageOf`). */
  lsystemProgress: number
  lsystemIterations: number

  tissue: TissueState
  soil: SoilState
  crystal: CrystalState
}

/** The fields a fresh seedling resets (weather, soil choice and crystal are the user's, not the plant's). */
export type PlantFields = Pick<
  PlantSnapshot,
  | 'time'
  | 'age'
  | 'height'
  | 'biomass'
  | 'waterStatus'
  | 'nutrientStatus'
  | 'growthRate'
  | 'lsystemProgress'
  | 'lsystemIterations'
  | 'tissue'
  | 'soil'
>

/** The documented seedling: day 0, 15 cm, iteration 2, 85 % turgid, full calcium, fresh tissue and soil. */
export function createSeedling(species: SpeciesId, soilProfile: SoilProfileId): PlantFields {
  return {
    time: 0,
    age: 0,
    height: 0.15,
    biomass: 0.1,
    waterStatus: 0.85,
    nutrientStatus: 1,
    growthRate: 0,
    lsystemProgress: MIN_ITERATIONS,
    lsystemIterations: MIN_ITERATIONS,
    tissue: createTissueState(species),
    soil: createSoilState(soilProfile, species),
  }
}

/** Days of lag for plant water / nutrition to follow the soil (hydraulic + tissue buffering). */
const WATER_LAG_DAYS = 1
const NUTRIENT_LAG_DAYS = 3

/**
 * One integration step of `days` simulated days. Pure: the input is not mutated.
 * (The steps it composes — soil, tissue, crystal — are pure too.)
 *
 * The iteration count is *derived* here: `lsystemIterations = stageOf(progress)`,
 * and `progress` advances with the weather-driven growth rate, so architecture
 * develops in lockstep with biomass and height. Nothing sets it from outside.
 */
export function stepPlant(s: PlantSnapshot, days: number): PlantSnapshot {
  const { species, weather, waterStatus, nutrientStatus, gemstone, geology, lsystemProgress, soilProfile } = s

  // very simple growth model for now
  const tempFactor = Math.max(0, 1 - Math.abs(weather.temperature - 22) / 25)
  const lightFactor = weather.light
  const waterFactor = waterStatus
  // relative growth rate (0-1): scales biomass/height and, through advanceDevelopment,
  // how fast the architecture develops, so the two can never drift apart
  const rate = tempFactor * lightFactor * waterFactor * nutrientStatus
  const growth = days * 0.08 * rate
  const progress = advanceDevelopment(lsystemProgress, days, rate)

  // roots draw on the soil; the soil decides how much of the demand they meet
  const soil = stepSoil(
    s.soil,
    soilProfile,
    weather,
    { species, biomass: s.biomass, growth: rate, activity: tempFactor * waterStatus },
    days,
  )

  return {
    ...s,
    time: s.time + days,
    age: s.age + days,
    height: Math.min(s.height + growth * 0.35, 4.5),
    biomass: s.biomass + growth,
    waterStatus: Math.max(
      0.05,
      Math.min(1, s.waterStatus + (soil.supply - s.waterStatus) * (1 - Math.exp(-days / WATER_LAG_DAYS))),
    ),
    nutrientStatus: Math.min(
      1,
      s.nutrientStatus + (soil.nutrient - s.nutrientStatus) * (1 - Math.exp(-days / NUTRIENT_LAG_DAYS)),
    ),
    soil,
    growthRate: growth / Math.max(days, 0.001),
    lsystemProgress: progress,
    lsystemIterations: stageOf(progress),
    // cambium divides on the same clock, driven by the same weather and turgor
    tissue: stepTissue(
      s.tissue,
      species,
      { temperature: weather.temperature, light: weather.light, water: waterStatus },
      days,
    ),
    // crystals share the same clock (days), so plant and gem modes coexist
    crystal: stepCrystal(s.crystal, gemstone, geology, days),
  }
}

/** One frame of the plant on the shared clock: clamp, accumulate, fixed steps. */
export function advancePlant(
  snapshot: PlantSnapshot,
  accumulator: number,
  input: ClockInput,
): ClockResult<PlantSnapshot> {
  return advanceClock(snapshot, stepPlant, accumulator, input)
}
