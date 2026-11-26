/**
 * The bed: several individuals under one weather state and one clock (pure).
 *
 * Each individual has its own species, seed and physiology. One of them is the
 * *focus*: its fields are mirrored at the top level of the sim store (so every
 * existing view — architecture, cellular, roots — reads the focused plant
 * unchanged), and it is stepped by `stepPlant` together with the soil. The others
 * are stepped here with the same kernel (`stepPhysiology` → `followSoil`) and
 * their own stem tissue, once per individual per fixed step.
 *
 * The soil slice is shared by the bed (v0): every plant's water follows the same
 * `soil.supply`, so rain or drought reaches every individual through the kernel.
 * Per-plant root zones are #10's.
 */
import { stepPlant, type PlantSnapshot } from './clock'
import { stageOf } from './LSystemMorph'
import { createPhysiology, followSoil, stepPhysiology, type PhysiologyState } from './physiology'
import type { SoilState } from './SoilField'
import type { SpeciesId } from './species'
import { createTissueState, stepTissue, type TissueState } from './TissueGrowth'
import type { WeatherState } from '../stores/simStore'

/** Tissue seed of the first slot: the same as `createTissueState`'s default, so the focus starts as before. */
export const FIRST_SEED = 20260820

export interface Individual extends PhysiologyState {
  id: string
  seed: number
  /** Position in the bed, metres (macro view units). */
  x: number
  z: number
  /** Rotation about the stem, radians (from the seed). */
  yaw: number
  age: number // days since it was planted
  tissue: TissueState
}

/** Fixed bed layout: mixed species, stable positions. Slot 0 is the default focus. */
export const BED_LAYOUT: readonly { species: SpeciesId; x: number; z: number }[] = [
  { species: 'sunflower', x: 0, z: 1.2 },
  { species: 'oak', x: -3.2, z: -1.6 },
  { species: 'rose', x: 2.6, z: 1.0 },
  { species: 'fern', x: -2.4, z: 1.6 },
  { species: 'bamboo', x: 3.4, z: -1.8 },
  { species: 'ivy', x: 0.2, z: -2.2 },
]

/** Stable seed per slot (Weyl sequence, never 0). */
export function slotSeed(slot: number): number {
  return slot === 0 ? FIRST_SEED : (FIRST_SEED + Math.imul(slot, 0x9e3779b9)) >>> 0 || 1
}

export function plantIndividual(slot: number, species: SpeciesId): Individual {
  const { x, z } = BED_LAYOUT[slot % BED_LAYOUT.length]
  const seed = slotSeed(slot)
  return {
    ...createPhysiology(species),
    id: `p${slot}`,
    seed,
    x,
    z,
    yaw: ((seed % 3600) / 3600) * Math.PI * 2,
    age: 0,
    tissue: createTissueState(species, seed),
  }
}

/** A fresh bed; `focusSpecies` replaces slot 0's species (the species picker). */
export function createPlot(focusSpecies: SpeciesId = BED_LAYOUT[0].species): Individual[] {
  return BED_LAYOUT.map((b, i) => plantIndividual(i, i === 0 ? focusSpecies : b.species))
}

/** One fixed step for a non-focus individual: kernel → soil → tissue, as `stepPlant` does for the focus. */
export function stepIndividual(
  ind: Individual,
  weather: WeatherState,
  soil: Pick<SoilState, 'supply' | 'nutrient'>,
  days: number,
): Individual {
  const grown = stepPhysiology(ind, weather, days)
  const plant = followSoil(grown, soil, days)
  return {
    ...ind,
    ...plant,
    age: ind.age + days,
    tissue: stepTissue(
      ind.tissue,
      ind.species,
      { temperature: weather.temperature, light: weather.light, water: ind.waterStatus },
      days,
    ),
  }
}

/** The fields an individual shares with the top-level (focused) plant. */
export type FocusFields = Pick<
  PlantSnapshot,
  'species' | 'age' | 'height' | 'biomass' | 'waterStatus' | 'nutrientStatus' | 'growthRate' | 'lsystemProgress' | 'lsystemIterations' | 'tissue'
>

export function focusFields(ind: Individual): FocusFields {
  return {
    species: ind.species,
    age: ind.age,
    height: ind.height,
    biomass: ind.biomass,
    waterStatus: ind.waterStatus,
    nutrientStatus: ind.nutrientStatus,
    growthRate: ind.growthRate,
    lsystemProgress: ind.lsystemProgress,
    lsystemIterations: stageOf(ind.lsystemProgress),
    tissue: ind.tissue,
  }
}

/** Copy the top-level plant back into its slot (new array; the input is untouched). */
export function syncFocus(plot: readonly Individual[], focusId: string, f: FocusFields): Individual[] {
  return plot.map((ind) =>
    ind.id !== focusId
      ? ind
      : {
          ...ind,
          species: f.species,
          age: f.age,
          height: f.height,
          biomass: f.biomass,
          waterStatus: f.waterStatus,
          nutrientStatus: f.nutrientStatus,
          growthRate: f.growthRate,
          lsystemProgress: f.lsystemProgress,
          tissue: f.tissue,
        },
  )
}

/** Everything one bed step reads and writes. */
export interface GardenSnapshot extends PlantSnapshot {
  plot: Individual[]
  focusId: string
}

/**
 * One fixed step of the whole bed. The focus (with the soil, tissue and crystal)
 * goes through `stepPlant`; every other individual through {@link stepIndividual}
 * against the soil that step produced. Pure.
 */
export function stepGarden(s: GardenSnapshot, days: number): GardenSnapshot {
  const next = stepPlant(s, days)
  const plot = s.plot.map((ind) => (ind.id === s.focusId ? ind : stepIndividual(ind, s.weather, next.soil, days)))
  return { ...next, plot: syncFocus(plot, s.focusId, next), focusId: s.focusId }
}
