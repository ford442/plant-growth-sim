import { create } from 'zustand'
import { createCrystalState, stepCrystal, type CrystalState } from '../simulation/CrystalGrowth'
import { GEMSTONE_PRESETS, type GemstoneId, type GeologyState } from '../simulation/GemstonePresets'
import { advanceDevelopment, MIN_ITERATIONS, stageOf } from '../simulation/LSystemMorph'
import { createSoilState, stepSoil, type SoilProfileId, type SoilState } from '../simulation/SoilField'
import { createTissueState, stepTissue, type TissueState } from '../simulation/TissueGrowth'
import { useTimeStore } from './timeStore'

export type { GemstoneId, GeologyState, SoilProfileId }

export type SpeciesId =
  | 'sunflower'
  | 'oak'
  | 'rose'
  | 'fern'
  | 'bamboo'
  | 'ivy'

export interface WeatherState {
  temperature: number // °C
  humidity: number // 0-1
  light: number // PAR relative 0-1
  precipitation: number // mm/h
  wind: number // m/s
}

export interface SimState {
  // identity
  species: SpeciesId
  setSpecies: (s: SpeciesId) => void

  // time (play/pause + speed live in timeStore, shared by every mode)
  time: number // simulation days
  tick: (dt: number) => void
  reset: () => void

  // weather
  weather: WeatherState
  setWeather: (partial: Partial<WeatherState>) => void

  // plant status (simplified for now)
  age: number // days
  height: number // m
  biomass: number // relative
  waterStatus: number // 0-1 (wilting to turgid); follows root water uptake from the soil field
  nutrientStatus: number // 0-1 calcium nutrition from the root zone; scales growth
  growthRate: number // current relative growth rate

  // L-system development (for architecture view). `lsystemProgress` is the continuous
  // stage — it advances with the weather-driven growth rate, so branching slows, stalls
  // and resumes together with height/biomass. The view blends generation
  // floor(progress) into the next by its fractional part (see LSystemMorph.ts), while
  // `lsystemIterations` stays the whole-iteration count (= floor(progress)).
  lsystemProgress: number
  lsystemIterations: number
  setLsystemIterations: (n: number) => void

  // stem tissue (cambium / xylem / phloem cell files; the cellular view derives its geometry from this)
  tissue: TissueState

  // soil slice under the plant: water, dissolved minerals, cement, nodules, roots
  // (SoilField.ts). Rain reaches the plant only through it.
  soilProfile: SoilProfileId
  /** Switch soil parent material: rebuilds the soil field (the plant keeps growing). */
  setSoilProfile: (p: SoilProfileId) => void
  soil: SoilState

  // gemstone growth (pure state; geometry is derived in the views)
  gemstone: GemstoneId
  /** Switch gemstone: loads its formation conditions and reseeds the crystal. */
  setGemstone: (g: GemstoneId) => void
  geology: GeologyState
  setGeology: (partial: Partial<GeologyState>) => void
  crystal: CrystalState
  resetCrystal: () => void
}

const defaultWeather: WeatherState = {
  temperature: 22,
  humidity: 0.6,
  light: 0.85,
  precipitation: 0,
  wind: 1.2,
}

const defaultGemstone: GemstoneId = 'quartz'
const defaultSoil: SoilProfileId = 'loam'
/** Days for plant water / nutrition to follow the soil (hydraulic + tissue buffering). */
const WATER_LAG_DAYS = 1
const NUTRIENT_LAG_DAYS = 3

export const useSimStore = create<SimState>((set, get) => ({
  species: 'sunflower',
  setSpecies: (species) => set({ species }),

  time: 0,
  tick: (dt) => {
    const { isPlaying, speed } = useTimeStore.getState()
    const { species, weather, waterStatus, nutrientStatus, gemstone, geology, lsystemProgress, soilProfile } = get()
    if (!isPlaying) return

    const days = dt * speed
    // very simple growth model for now
    const tempFactor = Math.max(0, 1 - Math.abs(weather.temperature - 22) / 25)
    const lightFactor = weather.light
    const waterFactor = waterStatus
    // relative growth rate (0-1): scales biomass/height and, through advanceDevelopment,
    // how fast the architecture develops, so the two can never drift apart
    const rate = tempFactor * lightFactor * waterFactor * nutrientStatus
    const growth = days * 0.08 * rate
    const progress = advanceDevelopment(lsystemProgress, days, rate)

    set((s) => {
      // roots draw on the soil; the soil decides how much of the demand they meet
      const soil = stepSoil(
        s.soil,
        soilProfile,
        weather,
        { species, biomass: s.biomass, growth: rate, activity: tempFactor * waterStatus },
        days
      )
      return {
      time: s.time + days,
      age: s.age + days,
      height: Math.min(s.height + growth * 0.35, 4.5),
      biomass: s.biomass + growth,
      waterStatus: Math.max(
        0.05,
        Math.min(1, s.waterStatus + (soil.supply - s.waterStatus) * (1 - Math.exp(-days / WATER_LAG_DAYS)))
      ),
      nutrientStatus: Math.min(
        1,
        s.nutrientStatus + (soil.nutrient - s.nutrientStatus) * (1 - Math.exp(-days / NUTRIENT_LAG_DAYS))
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
        days
      ),
      // crystals share the same clock (days), so plant and gem modes coexist
      crystal: stepCrystal(s.crystal, gemstone, geology, days),
      }
    })
  },
  reset: () => {
    useTimeStore.getState().play()
    set({
      time: 0,
      age: 0,
      height: 0.15,
      biomass: 0.1,
      waterStatus: 0.85,
      nutrientStatus: 1,
      growthRate: 0,
      lsystemProgress: MIN_ITERATIONS,
      lsystemIterations: MIN_ITERATIONS,
      tissue: createTissueState(get().species),
      soil: createSoilState(get().soilProfile, get().species),
    })
  },

  weather: defaultWeather,
  setWeather: (partial) =>
    set((s) => ({ weather: { ...s.weather, ...partial } })),

  age: 0,
  height: 0.15,
  biomass: 0.1,
  waterStatus: 0.85,
  nutrientStatus: 1,
  growthRate: 0,

  lsystemProgress: MIN_ITERATIONS,
  lsystemIterations: MIN_ITERATIONS,
  setLsystemIterations: (n) => set({ lsystemProgress: n, lsystemIterations: stageOf(n) }),

  tissue: createTissueState('sunflower'),

  soilProfile: defaultSoil,
  setSoilProfile: (soilProfile) => set((s) => ({ soilProfile, soil: createSoilState(soilProfile, s.species) })),
  soil: createSoilState(defaultSoil, 'sunflower'),

  gemstone: defaultGemstone,
  setGemstone: (gemstone) => {
    const geology = { ...GEMSTONE_PRESETS[gemstone].defaults }
    set({ gemstone, geology, crystal: createCrystalState(gemstone, geology) })
  },
  geology: { ...GEMSTONE_PRESETS[defaultGemstone].defaults },
  setGeology: (partial) => set((s) => ({ geology: { ...s.geology, ...partial } })),
  crystal: createCrystalState(defaultGemstone, GEMSTONE_PRESETS[defaultGemstone].defaults),
  resetCrystal: () => {
    useTimeStore.getState().play()
    set((s) => ({ crystal: createCrystalState(s.gemstone, s.geology) }))
  },
}))
