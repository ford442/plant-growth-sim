import { create } from 'zustand'
import { createCrystalState, stepCrystal, type CrystalState } from '../simulation/CrystalGrowth'
import { GEMSTONE_PRESETS, type GemstoneId, type GeologyState } from '../simulation/GemstonePresets'
import { useTimeStore } from './timeStore'

export type { GemstoneId, GeologyState }

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
  waterStatus: number // 0-1 (wilting to turgid)
  growthRate: number // current relative growth rate

  // L-system iteration (for architecture view)
  lsystemIterations: number
  setLsystemIterations: (n: number) => void

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

export const useSimStore = create<SimState>((set, get) => ({
  species: 'sunflower',
  setSpecies: (species) => set({ species }),

  time: 0,
  tick: (dt) => {
    const { isPlaying, speed } = useTimeStore.getState()
    const { weather, waterStatus, gemstone, geology } = get()
    if (!isPlaying) return

    const days = dt * speed
    // very simple growth model for now
    const tempFactor = Math.max(0, 1 - Math.abs(weather.temperature - 22) / 25)
    const lightFactor = weather.light
    const waterFactor = waterStatus
    const growth = days * 0.08 * tempFactor * lightFactor * waterFactor

    set((s) => ({
      time: s.time + days,
      age: s.age + days,
      height: Math.min(s.height + growth * 0.35, 4.5),
      biomass: s.biomass + growth,
      waterStatus: Math.max(
        0.05,
        Math.min(
          1,
          s.waterStatus +
            (weather.precipitation > 0.5 ? 0.15 : -0.02) * days +
            (weather.humidity - 0.5) * 0.01 * days
        )
      ),
      growthRate: growth / Math.max(days, 0.001),
      lsystemIterations: Math.min(7, Math.floor(s.age / 3) + 2),
      // crystals share the same clock (days), so plant and gem modes coexist
      crystal: stepCrystal(s.crystal, gemstone, geology, days),
    }))
  },
  reset: () => {
    useTimeStore.getState().play()
    set({
      time: 0,
      age: 0,
      height: 0.15,
      biomass: 0.1,
      waterStatus: 0.85,
      growthRate: 0,
      lsystemIterations: 2,
    })
  },

  weather: defaultWeather,
  setWeather: (partial) =>
    set((s) => ({ weather: { ...s.weather, ...partial } })),

  age: 0,
  height: 0.15,
  biomass: 0.1,
  waterStatus: 0.85,
  growthRate: 0,

  lsystemIterations: 2,
  setLsystemIterations: (n) => set({ lsystemIterations: n }),

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
