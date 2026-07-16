import { create } from 'zustand'

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

  // time
  time: number // simulation days
  isPlaying: boolean
  speed: number // days per real second
  play: () => void
  pause: () => void
  setSpeed: (s: number) => void
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
}

const defaultWeather: WeatherState = {
  temperature: 22,
  humidity: 0.6,
  light: 0.85,
  precipitation: 0,
  wind: 1.2,
}

export const useSimStore = create<SimState>((set, get) => ({
  species: 'sunflower',
  setSpecies: (species) => set({ species }),

  time: 0,
  isPlaying: true,
  speed: 0.5,
  play: () => set({ isPlaying: true }),
  pause: () => set({ isPlaying: false }),
  setSpeed: (speed) => set({ speed }),
  tick: (dt) => {
    const { isPlaying, speed, weather, waterStatus } = get()
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
    }))
  },
  reset: () =>
    set({
      time: 0,
      age: 0,
      height: 0.15,
      biomass: 0.1,
      waterStatus: 0.85,
      growthRate: 0,
      lsystemIterations: 2,
      isPlaying: true,
    }),

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
}))
