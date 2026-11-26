import { create } from 'zustand'
import { createCrystalState, type CrystalState } from '../simulation/CrystalGrowth'
import { GEMSTONE_PRESETS, type GemstoneId, type GeologyState } from '../simulation/GemstonePresets'
import { advanceClock, createSeedling } from '../simulation/clock'
import { createPlot, focusFields, plantIndividual, stepGarden, syncFocus, type GardenSnapshot, type Individual } from '../simulation/plot'
import { createSoilState, type SoilProfileId, type SoilState } from '../simulation/SoilField'
import type { TissueState } from '../simulation/TissueGrowth'
import { useTimeStore } from './timeStore'

export type { GemstoneId, GeologyState, SoilProfileId }

export type { SpeciesId } from '../simulation/species'
import type { SpeciesId } from '../simulation/species'

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

  // the bed (simulation/plot.ts): every individual under the same weather and clock.
  // The top-level plant fields below mirror the focused one; `tick` keeps its slot in sync.
  plot: Individual[]
  focusId: string
  /** Focus another individual: its fields become the top-level plant. Time does not move. */
  setFocus: (id: string) => void
  /** Replant the focused slot as a new seedling of `species`; the rest of the bed keeps growing. */
  replantFocus: (species: SpeciesId) => void

  // time (play/pause + speed live in timeStore, shared by every mode)
  time: number // simulation days
  /**
   * Spend `dt` real seconds on the shared clock (`simulation/clock.ts`): the frame is
   * clamped, accumulated and run as fixed steps. Called from exactly one place — the
   * driver in `clockDriver.ts`.
   */
  tick: (dt: number) => void
  /** Part of a fixed step already owed, in [0, 1); carried between frames by `tick`. */
  clockAccumulator: number
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
  // `lsystemIterations` is that count's whole part, derived by the stepper (nothing sets it).
  lsystemProgress: number
  lsystemIterations: number

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

/** The slice of store state one plant step reads and writes (no actions). */
function snapshotOf(s: SimState): GardenSnapshot {
  return {
    plot: s.plot,
    focusId: s.focusId,
    species: s.species,
    soilProfile: s.soilProfile,
    gemstone: s.gemstone,
    geology: s.geology,
    weather: s.weather,
    time: s.time,
    age: s.age,
    height: s.height,
    biomass: s.biomass,
    waterStatus: s.waterStatus,
    nutrientStatus: s.nutrientStatus,
    growthRate: s.growthRate,
    lsystemProgress: s.lsystemProgress,
    lsystemIterations: s.lsystemIterations,
    tissue: s.tissue,
    soil: s.soil,
    crystal: s.crystal,
  }
}

const seedling = createSeedling('sunflower', defaultSoil)
const plot0 = createPlot('sunflower')

export const useSimStore = create<SimState>((set, get) => ({
  species: 'sunflower',
  // the stepper reads `species` from the state it steps, so this is also the swap of the
  // physiology table; SpeciesSelector follows it with reset() to start the new seedling
  setSpecies: (species) => set({ species }),

  plot: plot0,
  focusId: plot0[0].id,
  setFocus: (id) => {
    const s = get()
    if (id === s.focusId) return
    const plot = syncFocus(s.plot, s.focusId, s)
    const target = plot.find((p) => p.id === id)
    if (!target) return
    set({ plot, focusId: id, ...focusFields(target) })
  },
  replantFocus: (species) => {
    const s = get()
    const slot = s.plot.findIndex((p) => p.id === s.focusId)
    const fresh = plantIndividual(slot, species)
    set({ plot: s.plot.map((p, i) => (i === slot ? fresh : p)), ...focusFields(fresh) })
  },

  time: seedling.time,
  clockAccumulator: 0,
  tick: (dt) => {
    const { isPlaying, speed } = useTimeStore.getState()
    const before = get()
    // the whole bed on the one clock: every individual, once per fixed step
    const r = advanceClock(snapshotOf(before), stepGarden, before.clockAccumulator, { dt, speed, playing: isPlaying })
    if (r.steps === 0) {
      // paused, or less than one step owed: only the part-step bookkeeping may have moved
      if (r.accumulator !== before.clockAccumulator) set({ clockAccumulator: r.accumulator })
      return
    }
    set({ ...r.state, clockAccumulator: r.accumulator })
  },
  reset: () => {
    useTimeStore.getState().play()
    const { species, soilProfile } = get()
    const plot = createPlot(species)
    // slot 0 is the focus after a reset; its tissue seed matches createSeedling's default
    set({ ...createSeedling(species, soilProfile), plot, focusId: plot[0].id, tissue: plot[0].tissue, clockAccumulator: 0 })
  },

  weather: defaultWeather,
  setWeather: (partial) =>
    set((s) => ({ weather: { ...s.weather, ...partial } })),

  age: seedling.age,
  height: seedling.height,
  biomass: seedling.biomass,
  waterStatus: seedling.waterStatus,
  nutrientStatus: seedling.nutrientStatus,
  growthRate: seedling.growthRate,

  lsystemProgress: seedling.lsystemProgress,
  lsystemIterations: seedling.lsystemIterations,

  tissue: seedling.tissue,

  soilProfile: defaultSoil,
  setSoilProfile: (soilProfile) => set((s) => ({ soilProfile, soil: createSoilState(soilProfile, s.species) })),
  soil: seedling.soil,

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
