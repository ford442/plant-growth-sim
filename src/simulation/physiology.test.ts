import { describe, expect, it } from 'vitest'
import { createSeedling, stepPlant, type PlantSnapshot } from './clock'
import { createCrystalState } from './CrystalGrowth'
import { GEMSTONE_PRESETS } from './GemstonePresets'
import { SPECIES_LSYSTEMS, architectureCap } from './LSystem'
import { MAX_ITERATIONS, MIN_ITERATIONS, stageOf } from './LSystemMorph'
import {
  LODGING_WIND,
  SPECIES_PHYSIOLOGY,
  createPhysiology,
  followSoil,
  growthFactors,
  humidityResponse,
  iterationCeiling,
  lightResponse,
  stepPhysiology,
  temperatureResponse,
  waterResponse,
  windResponse,
  type PhysiologyState,
  type PhysiologyWeather,
} from './physiology'
import type { SpeciesId } from './species'

const SPECIES = Object.keys(SPECIES_PHYSIOLOGY) as SpeciesId[]

/** Still, humid, bright air at a species' own optimum: every limit is 1. */
const ideal = (s: SpeciesId): PhysiologyWeather => ({
  temperature: SPECIES_PHYSIOLOGY[s].tOpt,
  humidity: 1,
  light: 1,
  wind: 0,
})

/** A seedling held at full turgor and nutrition (as under steady rain). */
const wetSeedling = (s: SpeciesId): PhysiologyState => ({ ...createPhysiology(s), waterStatus: 1 })

/** `n` kernel steps of `days` each, water held where it is. */
function run(from: PhysiologyState, weather: PhysiologyWeather, n: number, days = 1 / 30): PhysiologyState {
  let s = from
  for (let i = 0; i < n; i++) s = stepPhysiology(s, weather, days)
  return s
}

describe('the species table', () => {
  it('has a consistent row for every species', () => {
    expect(Object.keys(SPECIES_PHYSIOLOGY).sort()).toEqual(Object.keys(SPECIES_LSYSTEMS).sort())
    for (const s of SPECIES) {
      const p = SPECIES_PHYSIOLOGY[s]
      expect(p.id, s).toBe(s)
      expect(p.tMin, s).toBeLessThan(p.tOpt)
      expect(p.tOpt, s).toBeLessThan(p.tMax)
      expect(p.lightCompensation, s).toBeGreaterThanOrEqual(0)
      expect(p.lightCompensation, s).toBeLessThan(p.lightSaturation)
      expect(p.lightSaturation, s).toBeLessThanOrEqual(1)
      expect(p.droughtFloor, s).toBeGreaterThanOrEqual(0)
      expect(p.droughtFloor, s).toBeLessThan(1)
      expect(p.windLodging, s).toBeGreaterThanOrEqual(0)
      expect(p.windLodging, s).toBeLessThanOrEqual(1)
      expect(p.height0, s).toBeLessThan(p.heightMax)
      expect(p.iterationEveryDays, s).toBeGreaterThan(0)
    }
  })

  it('tells the six presets apart', () => {
    for (const key of ['tOpt', 'heightMax', 'heightRate', 'droughtFloor', 'lightSaturation'] as const) {
      expect(new Set(SPECIES.map((s) => SPECIES_PHYSIOLOGY[s][key])).size, key).toBeGreaterThanOrEqual(5)
    }
  })

  it('keeps the qualitative story: sunflower thirsty, oak tall and slow, fern shade- and humidity-bound', () => {
    const P = SPECIES_PHYSIOLOGY
    expect(P.sunflower.droughtFloor).toBeGreaterThan(P.oak.droughtFloor)
    for (const s of SPECIES) if (s !== 'oak') expect(P.oak.heightMax, s).toBeGreaterThan(P[s].heightMax)
    expect(P.oak.heightRate).toBeLessThan(P.sunflower.heightRate)
    expect(P.bamboo.heightRate).toBeGreaterThan(P.sunflower.heightRate)
    expect(P.fern.lightSaturation).toBeLessThan(P.sunflower.lightSaturation)
    expect(P.fern.humidityNeed).toBeGreaterThan(P.sunflower.humidityNeed)
    expect(P.fern.tOpt).toBeLessThan(P.sunflower.tOpt)
    expect(P.rose.windLodging).toBeGreaterThan(P.ivy.windLodging)
  })

  it('never schedules past the architecture segment budget', () => {
    for (const s of SPECIES) {
      const cap = architectureCap(SPECIES_LSYSTEMS[s], MAX_ITERATIONS)
      expect(iterationCeiling(s), s).toBeLessThanOrEqual(cap)
      expect(iterationCeiling(s), s).toBeLessThanOrEqual(SPECIES_PHYSIOLOGY[s].maxIterations)
      expect(iterationCeiling(s), s).toBeGreaterThanOrEqual(MIN_ITERATIONS)
    }
    // bamboo: iteration 7 would be 78 125 segments; the budget stops it at 5
    expect(iterationCeiling('bamboo')).toBe(5)
  })
})

describe('responses', () => {
  it('temperature: 0 at the limits, exactly 1 at the optimum, rising then falling', () => {
    for (const s of SPECIES) {
      const p = SPECIES_PHYSIOLOGY[s]
      expect(temperatureResponse(p.tMin, p), s).toBe(0)
      expect(temperatureResponse(p.tMax, p), s).toBe(0)
      expect(temperatureResponse(p.tOpt, p), s).toBeCloseTo(1, 12)
      expect(temperatureResponse(p.tOpt - 3, p), s).toBeLessThan(1)
      expect(temperatureResponse(p.tOpt + 3, p), s).toBeLessThan(1)
      expect(temperatureResponse(p.tMin + 1, p), s).toBeLessThan(temperatureResponse(p.tOpt - 1, p))
      expect(temperatureResponse(-30, p), s).toBe(0)
      expect(temperatureResponse(60, p), s).toBe(0)
    }
  })

  it('light: nothing at the compensation point, saturates at the saturation point', () => {
    for (const s of SPECIES) {
      const p = SPECIES_PHYSIOLOGY[s]
      expect(lightResponse(p.lightCompensation, p), s).toBe(0)
      expect(lightResponse(0, p), s).toBe(0)
      expect(lightResponse(p.lightSaturation, p), s).toBe(1)
      expect(lightResponse(1, p), s).toBe(1)
      const mid = (p.lightCompensation + p.lightSaturation) / 2
      expect(lightResponse(mid, p), s).toBeGreaterThan(0.5) // concave
    }
    // a fern is already at full rate in light that leaves a sunflower short
    const dim = 0.4
    expect(lightResponse(dim, SPECIES_PHYSIOLOGY.fern)).toBe(1)
    expect(lightResponse(dim, SPECIES_PHYSIOLOGY.sunflower)).toBeLessThan(0.8)
  })

  it('water and humidity: zero at the floor / dry air, one when satisfied', () => {
    for (const s of SPECIES) {
      const p = SPECIES_PHYSIOLOGY[s]
      expect(waterResponse(p.droughtFloor, p), s).toBe(0)
      expect(waterResponse(1, p), s).toBe(1)
      expect(waterResponse(0, p), s).toBe(0)
      expect(humidityResponse(p.humidityNeed, p), s).toBe(1)
      expect(humidityResponse(0, p), s).toBe(0)
    }
  })

  it('wind: none in still air, the lodging coefficient at 15 m/s, never negative', () => {
    for (const s of SPECIES) {
      const p = SPECIES_PHYSIOLOGY[s]
      expect(windResponse(0, p), s).toBe(1)
      expect(windResponse(LODGING_WIND, p), s).toBeCloseTo(1 - p.windLodging, 12)
      expect(windResponse(60, p), s).toBeCloseTo(1 - p.windLodging, 12)
      expect(windResponse(5, p), s).toBeGreaterThan(windResponse(10, p))
    }
  })
})

describe('growth under the same ideal weather', () => {
  it('runs at relative rate 1 at the optimum, in full light, wet and still', () => {
    for (const s of SPECIES) {
      const f = growthFactors(s, ideal(s), 1, 1)
      expect(f.rate, s).toBeCloseTo(1, 12)
      expect(f.limiting, s).toBe('none')
    }
  })

  it('sunflower gains height faster than oak (each at its own optimum, full light, wet soil)', () => {
    const week = 7 * 30
    const sunflower = run(wetSeedling('sunflower'), ideal('sunflower'), week)
    const oak = run(wetSeedling('oak'), ideal('oak'), week)
    expect(sunflower.height - SPECIES_PHYSIOLOGY.sunflower.height0).toBeGreaterThan(
      oak.height - SPECIES_PHYSIOLOGY.oak.height0,
    )
    expect(sunflower.lsystemProgress).toBeGreaterThan(oak.lsystemProgress)
  })

  it('also in the *same* weather (20 °C, bright): sunflower outgrows oak', () => {
    const weather: PhysiologyWeather = { temperature: 20, humidity: 0.7, light: 0.9, wind: 1 }
    const a = run(wetSeedling('sunflower'), weather, 300)
    const b = run(wetSeedling('oak'), weather, 300)
    expect(a.height).toBeGreaterThan(b.height)
  })

  it('height rises monotonically and levels off at heightMax, never above', () => {
    for (const s of SPECIES) {
      const p = SPECIES_PHYSIOLOGY[s]
      let state = wetSeedling(s)
      let last = state.height
      for (let i = 0; i < 400; i++) {
        state = stepPhysiology(state, ideal(s), 0.5) // 200 days at rate 1
        expect(state.height, s).toBeGreaterThanOrEqual(last)
        expect(state.height, s).toBeLessThanOrEqual(p.heightMax)
        last = state.height
      }
    }
    // the fast ones are there within 200 days
    expect(run(wetSeedling('sunflower'), ideal('sunflower'), 400, 0.5).height).toBeGreaterThan(0.95 * 2.5)
    expect(run(wetSeedling('bamboo'), ideal('bamboo'), 400, 0.5).height).toBeGreaterThan(0.95 * 5)
  })

  it('bamboo climbs fastest', () => {
    const heights = Object.fromEntries(SPECIES.map((s) => [s, run(wetSeedling(s), ideal(s), 30 * 20).height - SPECIES_PHYSIOLOGY[s].height0]))
    for (const s of SPECIES) if (s !== 'bamboo') expect(heights.bamboo, s).toBeGreaterThan(heights[s])
  })
})

describe('limits', () => {
  it('at 2 °C (and at freezing, and at scorching 45 °C) nobody grows', () => {
    for (const s of SPECIES) {
      for (const temperature of [2, -5, 45]) {
        const start = wetSeedling(s)
        const after = run(start, { ...ideal(s), temperature }, 90)
        expect(after.height, `${s} ${temperature}`).toBe(start.height)
        expect(after.biomass, `${s} ${temperature}`).toBe(start.biomass)
        expect(after.lsystemProgress, `${s} ${temperature}`).toBe(start.lsystemProgress)
        expect(after.growthRate, `${s} ${temperature}`).toBe(0)
      }
    }
  })

  it('at light ≤ the compensation point nobody grows', () => {
    for (const s of SPECIES) {
      const start = wetSeedling(s)
      const after = run(start, { ...ideal(s), light: SPECIES_PHYSIOLOGY[s].lightCompensation }, 30)
      expect(after.biomass, s).toBe(start.biomass)
    }
  })

  it('at 15 m/s wind the lodging coefficient cuts growth by exactly that fraction', () => {
    for (const s of SPECIES) {
      const calm = stepPhysiology(wetSeedling(s), ideal(s), 1)
      const gale = stepPhysiology(wetSeedling(s), { ...ideal(s), wind: 15 }, 1)
      const p = SPECIES_PHYSIOLOGY[s]
      expect(gale.biomass - 0.1, s).toBeCloseTo((calm.biomass - 0.1) * (1 - p.windLodging), 10)
      expect(gale.lsystemProgress - MIN_ITERATIONS, s).toBeCloseTo(
        (calm.lsystemProgress - MIN_ITERATIONS) * (1 - p.windLodging),
        10,
      )
      if (p.windLodging > 0) expect(gale.height, s).toBeLessThan(calm.height)
    }
    // …and the rose, the wind-sensitive one, loses more than the ivy that clings
    const loss = (s: SpeciesId) => 1 - windResponse(15, SPECIES_PHYSIOLOGY[s])
    expect(loss('rose')).toBeGreaterThan(loss('ivy'))
  })

  it('a thirsty sunflower stops at a water status an oak still grows at', () => {
    const w = 0.3
    expect(growthFactors('sunflower', ideal('sunflower'), w, 1).rate).toBe(0)
    expect(growthFactors('oak', ideal('oak'), w, 1).rate).toBeGreaterThan(0.2)
  })

  it('dry air slows a fern more than an oak', () => {
    const dry = (s: SpeciesId) => growthFactors(s, { ...ideal(s), humidity: 0.3 }, 1, 1).rate
    expect(dry('fern')).toBeLessThan(dry('oak'))
  })

  it('names the limiting factor', () => {
    const s = 'sunflower'
    const p = SPECIES_PHYSIOLOGY[s]
    const at = (w: Partial<PhysiologyWeather>, water = 1, nutrient = 1) =>
      growthFactors(s, { ...ideal(s), ...w }, water, nutrient).limiting
    expect(at({})).toBe('none')
    expect(at({ temperature: p.tOpt - 12 })).toBe('cold')
    expect(at({ temperature: p.tOpt + 10 })).toBe('heat')
    expect(at({ light: 0.2 })).toBe('dark')
    expect(at({}, 0.45)).toBe('drought')
    expect(at({ humidity: 0.1 })).toBe('drought')
    expect(at({ wind: 15 })).toBe('wind') // 35 % loss
    expect(at({}, 1, 0.5)).toBe('nutrient')
    // the *weakest* of several wins
    expect(at({ light: 0.2, temperature: p.tOpt - 1 })).toBe('dark')
  })
})

describe('water follows the soil', () => {
  it('falls under drought (low soil supply) and recovers under rain (full supply)', () => {
    for (const s of SPECIES) {
      let plant = wetSeedling(s)
      for (let i = 0; i < 30 * 20; i++) plant = followSoil(plant, { supply: 0.2, nutrient: 1 }, 1 / 30)
      expect(plant.waterStatus, s).toBeLessThan(0.3)
      const dry = plant.waterStatus
      for (let i = 0; i < 30 * 20; i++) plant = followSoil(plant, { supply: 1, nutrient: 1 }, 1 / 30)
      expect(plant.waterStatus, s).toBeGreaterThan(dry)
      expect(plant.waterStatus, s).toBeGreaterThan(0.95)
    }
  })

  it('stays inside [0.05, 1] whatever the soil says', () => {
    let plant = wetSeedling('oak')
    for (let i = 0; i < 400; i++) plant = followSoil(plant, { supply: 0, nutrient: 0 }, 1)
    expect(plant.waterStatus).toBeGreaterThanOrEqual(0.05)
    plant = followSoil(plant, { supply: 7, nutrient: 7 }, 100)
    expect(plant.waterStatus).toBeLessThanOrEqual(1)
    expect(plant.nutrientStatus).toBeLessThanOrEqual(1)
  })

  it('an oak buffers water longer than a sunflower', () => {
    const after = (s: SpeciesId) => followSoil(wetSeedling(s), { supply: 0, nutrient: 1 }, 2).waterStatus
    expect(after('oak')).toBeGreaterThan(after('sunflower'))
  })

  it('does not touch growth', () => {
    const a = wetSeedling('rose')
    const b = followSoil(a, { supply: 0.1, nutrient: 0.1 }, 1)
    expect({ h: b.height, m: b.biomass, p: b.lsystemProgress }).toEqual({ h: a.height, m: a.biomass, p: a.lsystemProgress })
  })
})

describe('architecture development', () => {
  it('the iteration index is monotonic with age, steps every iterationEveryDays, and stops at the ceiling', () => {
    for (const s of SPECIES) {
      const p = SPECIES_PHYSIOLOGY[s]
      let plant = wetSeedling(s)
      let last = stageOf(plant.lsystemProgress)
      for (let i = 0; i < 30 * 160; i++) {
        plant = stepPhysiology(plant, ideal(s), 1 / 30)
        const stage = stageOf(plant.lsystemProgress)
        expect(stage, s).toBeGreaterThanOrEqual(last)
        expect(stage, s).toBeLessThanOrEqual(iterationCeiling(s))
        last = stage
      }
      expect(last, s).toBe(iterationCeiling(s))

      // pace: one iteration per iterationEveryDays of ideal weather
      const oneStep = run(wetSeedling(s), ideal(s), 30 * 3, 1 / 30) // 3 days
      expect(oneStep.lsystemProgress - MIN_ITERATIONS, s).toBeCloseTo(3 / p.iterationEveryDays, 8)
    }
  })

  it('a faster species reaches the same iteration sooner', () => {
    const days = (s: SpeciesId, n: number) => {
      let plant = wetSeedling(s)
      let d = 0
      while (stageOf(plant.lsystemProgress) < n && d < 400) {
        plant = stepPhysiology(plant, ideal(s), 0.1)
        d += 0.1
      }
      return d
    }
    expect(days('bamboo', 4)).toBeLessThan(days('sunflower', 4))
    expect(days('sunflower', 4)).toBeLessThan(days('oak', 4))
  })

  it('a stalled plant stays on its iteration', () => {
    const plant = run(wetSeedling('oak'), { ...ideal('oak'), temperature: 2 }, 300)
    expect(stageOf(plant.lsystemProgress)).toBe(MIN_ITERATIONS)
  })
})

describe('purity', () => {
  it('stepPhysiology and followSoil return new objects and leave their input alone', () => {
    const plant = Object.freeze(wetSeedling('oak'))
    const weather = Object.freeze(ideal('oak'))
    const grown = stepPhysiology(plant, weather, 0.1)
    expect(grown).not.toBe(plant)
    expect(grown.height).toBeGreaterThan(plant.height)
    const wetted = followSoil(plant, Object.freeze({ supply: 0.1, nutrient: 0.5 }), 1)
    expect(wetted).not.toBe(plant)
    expect(plant.waterStatus).toBe(1)
  })

  it('is deterministic', () => {
    const a = run(wetSeedling('fern'), ideal('fern'), 100)
    const b = run(wetSeedling('fern'), ideal('fern'), 100)
    expect(a).toEqual(b)
  })
})

describe('through the plant step (soil, tissue, crystal)', () => {
  function snapshot(species: SpeciesId, weather: PlantSnapshot['weather']): PlantSnapshot {
    return {
      species,
      soilProfile: 'loam',
      gemstone: 'quartz',
      geology: { ...GEMSTONE_PRESETS.quartz.defaults },
      weather,
      ...createSeedling(species, 'loam'),
      crystal: createCrystalState('quartz', GEMSTONE_PRESETS.quartz.defaults),
    }
  }
  const advance = (from: PlantSnapshot, steps: number, days = 1 / 30) => {
    let s = from
    for (let i = 0; i < steps; i++) s = stepPlant(s, days)
    return s
  }
  const weather = { temperature: 20, humidity: 0.5, light: 0.8, precipitation: 0, wind: 4 }

  it('starts each species from its own seedling height', () => {
    for (const s of SPECIES) expect(createSeedling(s, 'loam').height).toBe(SPECIES_PHYSIOLOGY[s].height0)
  })

  it('two species left under the same weather for the same steps end at different heights and water status', () => {
    const a = advance(snapshot('sunflower', weather), 30 * 60)
    const b = advance(snapshot('oak', weather), 30 * 60)
    expect(Math.abs(a.height - b.height)).toBeGreaterThan(0.05)
    expect(Math.abs(a.waterStatus - b.waterStatus)).toBeGreaterThan(0.005)
    expect(a.age).toBe(b.age)
  })

  it('switching the species in the snapshot swaps the physiology the stepper uses', () => {
    const base = advance(snapshot('sunflower', weather), 60)
    const swapped = advance({ ...base, species: 'oak', ...createSeedling('oak', 'loam') }, 60)
    const fresh = advance(snapshot('oak', weather), 60)
    expect(swapped.height).toBeCloseTo(fresh.height, 12)
    expect(swapped.lsystemProgress).toBeCloseTo(fresh.lsystemProgress, 12)
  })

  it('water falls in drought and recovers under rain, through the soil', () => {
    const dryWeather = { ...weather, precipitation: 0, humidity: 0.4 }
    let s = advance(snapshot('sunflower', { ...weather, precipitation: 5 }), 30 * 5)
    expect(s.waterStatus).toBeGreaterThan(0.95)
    s = advance({ ...s, weather: dryWeather }, 30 * 40, 0.1) // 120 days without rain
    const dry = s.waterStatus
    expect(dry).toBeLessThan(0.7)
    s = advance({ ...s, weather: { ...weather, precipitation: 8 } }, 30 * 15)
    expect(s.waterStatus).toBeGreaterThan(dry + 0.15)
  })

  it('the soil is stepped at the physiology growth rate: a stalled plant sends no roots down', () => {
    const cold = advance(snapshot('sunflower', { ...weather, temperature: 2 }), 30 * 30)
    expect(cold.biomass).toBeCloseTo(0.1, 12)
    expect(cold.lsystemIterations).toBe(MIN_ITERATIONS)
    expect(cold.soil.rootDepth).toBeCloseTo(snapshot('sunflower', weather).soil.rootDepth, 6)
  })
})
