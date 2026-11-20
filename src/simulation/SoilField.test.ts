import { describe, expect, it } from 'vitest'
import {
  calciteSolubility,
  CELL_H,
  cellIndex,
  createSoilState,
  HARDPAN,
  largestGeode,
  noduleLabel,
  rhizospherePco2,
  rootField,
  rootSystem,
  silicaSolubility,
  SOIL_CELLS,
  SOIL_COLS,
  SOIL_PROFILE_IDS,
  SOIL_ROWS,
  soilMetrics,
  stepSoil,
  type SoilPlant,
  type SoilProfileId,
  type SoilState,
  type SoilWeather,
} from './SoilField'

const DRY: SoilWeather = { temperature: 22, humidity: 0.6, light: 0.85, precipitation: 0, wind: 1.2 }
const RAIN: SoilWeather = { ...DRY, precipitation: 4 }

function deepFreeze<T>(o: T): T {
  if (o && typeof o === 'object' && !Object.isFrozen(o)) {
    Object.freeze(o)
    for (const v of Object.values(o)) deepFreeze(v)
  }
  return o
}

/**
 * A plant on the soil with the store's coupling (water status follows supply
 * with a 1-day lag, growth = 0.85 light × water), so the soil feels the
 * feedback of its own drought.
 */
function run(
  profile: SoilProfileId,
  days: number,
  weather: (day: number) => SoilWeather,
  init?: (s: SoilState) => SoilState,
): { soil: SoilState; water: number; minWater: number } {
  let soil = createSoilState(profile, 'sunflower')
  if (init) soil = init(soil)
  let water = 0.85
  let minWater = 1
  let biomass = 0.1
  const dt = 0.1
  for (let day = 0; day < days; day += dt) {
    const growth = 0.85 * water
    const plant: SoilPlant = { species: 'sunflower', biomass, growth, activity: water }
    soil = stepSoil(soil, profile, weather(day), plant, dt)
    water += (soil.supply - water) * (1 - Math.exp(-dt))
    minWater = Math.min(minWater, water)
    biomass += dt * 0.08 * growth
  }
  return { soil, water, minWater }
}

const sum = (a: number[]) => a.reduce((x, y) => x + y, 0)
const wetCycles = (day: number) => (Math.floor(day / 6) % 3 === 0 ? RAIN : DRY)

describe('chemistry', () => {
  it('silica is more soluble when warm; calcite less, and more under root CO₂', () => {
    expect(silicaSolubility(30)).toBeGreaterThan(silicaSolubility(10))
    expect(calciteSolubility(30, 1)).toBeLessThan(calciteSolubility(10, 1))
    expect(calciteSolubility(20, rhizospherePco2(0.8, 1))).toBeGreaterThan(calciteSolubility(20, 1))
    expect(rhizospherePco2(0, 1)).toBe(1)
    expect(rhizospherePco2(0.8, 0)).toBe(1) // a dormant plant does not respire
  })
})

describe('roots', () => {
  const zeros = () => new Array<number>(SOIL_CELLS).fill(0)

  it('fill the soil down to the front and nowhere below it', () => {
    const { roots, blockedAt } = rootField(rootSystem('sunflower'), 0.9, zeros(), zeros())
    expect(blockedAt).toBeNull()
    const centre = SOIL_COLS / 2
    expect(roots[cellIndex(centre, 0)]).toBeGreaterThan(0.5)
    expect(roots[cellIndex(centre, 5)]).toBeGreaterThan(0) // z = 0.825 m
    for (let row = 6; row < SOIL_ROWS; row++) expect(roots[cellIndex(centre, row)]).toBe(0)
    expect(roots[cellIndex(0, 0)]).toBeLessThan(0.05) // far edge of the slice
  })

  it('shallow rhizome species spread wide, taproots go deep', () => {
    const fern = rootSystem('fern')
    const sunflower = rootSystem('sunflower')
    expect(fern.maxDepth).toBeLessThan(sunflower.maxDepth)
    const wide = rootField(fern, fern.maxDepth, zeros(), zeros()).roots
    const deep = rootField(sunflower, fern.maxDepth, zeros(), zeros()).roots
    expect(wide[cellIndex(3, 0)]).toBeGreaterThan(deep[cellIndex(3, 0)])
  })

  it('cannot cross a hardpan', () => {
    const cem = zeros()
    for (let col = 0; col < SOIL_COLS; col++) cem[cellIndex(col, 4)] = HARDPAN + 0.05
    const { roots, blockedAt } = rootField(rootSystem('sunflower'), 1.8, cem, zeros())
    expect(blockedAt).toBeCloseTo(4 * CELL_H, 10)
    for (let row = 4; row < SOIL_ROWS; row++)
      for (let col = 0; col < SOIL_COLS; col++) expect(roots[cellIndex(col, row)]).toBe(0)
  })

  it('deepen while the plant grows and stall when it does not', () => {
    const s0 = createSoilState('loam', 'sunflower')
    const plant: SoilPlant = { species: 'sunflower', biomass: 0.5, growth: 1, activity: 1 }
    const grown = stepSoil(s0, 'loam', RAIN, plant, 5)
    const stalled = stepSoil(s0, 'loam', RAIN, { ...plant, growth: 0 }, 5)
    expect(grown.rootDepth).toBeGreaterThan(s0.rootDepth + 0.2)
    expect(stalled.rootDepth).toBe(s0.rootDepth)
  })

  it('stop at a hardpan even while the plant keeps growing', () => {
    const { soil } = run('loam', 30, () => RAIN, (s) => {
      const cementCalcite = s.cementCalcite.slice()
      for (let col = 0; col < SOIL_COLS; col++) cementCalcite[cellIndex(col, 5)] = 0.7
      return { ...s, cementCalcite }
    })
    expect(soil.blockedAt).toBeCloseTo(5 * CELL_H, 10)
    expect(soil.rootDepth).toBeLessThanOrEqual(5 * CELL_H + CELL_H)
    expect(soil.roots[cellIndex(SOIL_COLS / 2, 8)]).toBe(0)
  })

  it('a crust or hardpan that forms around established roots does not cut them off', () => {
    const s0 = createSoilState('loam', 'sunflower') // seedling roots reach 0.3 m
    const cementCalcite = s0.cementCalcite.slice()
    for (let col = 0; col < SOIL_COLS; col++) cementCalcite[cellIndex(col, 0)] = 0.7 // evaporite crust
    const plant: SoilPlant = { species: 'sunflower', biomass: 1, growth: 0.8, activity: 1 }
    const s = stepSoil({ ...s0, cementCalcite }, 'loam', RAIN, plant, 1)
    expect(s.blockedAt).toBeNull()
    expect(s.roots[cellIndex(SOIL_COLS / 2, 1)]).toBeGreaterThan(0.3)
    expect(s.supply).toBe(1)
    // …but it does stop roots spreading sideways under it into new ground
    expect(s.roots[cellIndex(1, 1)]).toBe(0)
  })
})

describe('water', () => {
  it('meets the full demand in wet soil (rain reaches the plant through the soil)', () => {
    const { soil, minWater } = run('loam', 10, () => RAIN)
    expect(soil.supply).toBe(1)
    expect(minWater).toBeGreaterThan(0.85)
  })

  it('a long drought dries the root zone until the roots cannot keep up; rain restores it', () => {
    const dry = run('loam', 90, () => DRY)
    expect(dry.soil.supply).toBeLessThan(0.8)
    expect(soilMetrics(dry.soil).rootZoneMoisture).toBeLessThan(0.3)
    const plant: SoilPlant = { species: 'sunflower', biomass: 5, growth: 0.5, activity: 0.5 }
    const rained = stepSoil(dry.soil, 'loam', { ...DRY, precipitation: 8 }, plant, 2)
    expect(rained.supply).toBe(1)
  })

  it('no light, no transpiration demand', () => {
    const s = stepSoil(createSoilState('loam', 'oak'), 'loam', { ...DRY, light: 0 }, {
      species: 'oak',
      biomass: 2,
      growth: 0,
      activity: 1,
    }, 1)
    expect(s.demand).toBe(0)
    expect(s.uptake).toBe(0)
    expect(s.supply).toBe(1)
  })

  it('rain drains through and leaches solutes out of the bottom', () => {
    const { soil } = run('loam', 15, () => ({ ...RAIN, precipitation: 10 }))
    expect(soil.drainage).toBeGreaterThan(0)
    expect(soil.leachedCalcium).toBeGreaterThan(0)
    expect(soil.leachedSilica).toBeGreaterThan(0)
  })

  it('cemented pores hold less water', () => {
    const s0 = createSoilState('loam', 'sunflower')
    const cementSilica = s0.cementSilica.slice()
    cementSilica[cellIndex(3, 2)] = 0.6
    const s = stepSoil({ ...s0, cementSilica }, 'loam', { ...RAIN, precipitation: 10 }, {
      species: 'sunflower',
      biomass: 0.1,
      growth: 0,
      activity: 1,
    }, 1)
    const i = cellIndex(3, 2)
    expect(s.cementSilica[i]).toBeGreaterThan(0.55) // cements are durable
    expect(s.water[i]).toBeLessThanOrEqual(1 - s.cementSilica[i] + 1e-9)
    expect(s.water[cellIndex(4, 2)]).toBeGreaterThan(0.5)
  })
})

describe('mineral–root interactions', () => {
  it('heavy rain leaches calcium from a poorly buffered ash soil: nutrition falls', () => {
    const { soil } = run('volcanic', 12, () => RAIN)
    expect(soil.nutrient).toBeLessThan(0.85)
    const loam = run('loam', 12, () => RAIN)
    expect(loam.soil.nutrient).toBe(1)
  })

  it('volcanic ash under a drying plant grows silica nodules around the roots, then geodes', () => {
    const { soil } = run('volcanic', 80, () => DRY)
    const silica = soil.nodules.filter((n) => n.mineral === 'silica')
    expect(silica.length).toBeGreaterThan(5)
    const rooted = silica.filter((n) => n.rooted).length
    expect(rooted / silica.length).toBeGreaterThan(0.6)
    const geode = largestGeode(soil)
    expect(geode).not.toBeNull()
    expect(noduleLabel(geode!)).toBe('Root-channel geode')
  })

  it('the loam control stays nodule-free over the same first weeks', () => {
    const { soil } = run('loam', 40, () => DRY)
    expect(soil.nodules.length).toBe(0)
  })

  it('limestone wet/dry cycles precipitate calcite on the roots (rhizoliths) and cement a calcic horizon', () => {
    const { soil } = run('limestone', 110, wetCycles)
    const calcite = soil.nodules.filter((n) => n.mineral === 'calcite')
    expect(calcite.length).toBeGreaterThan(5)
    expect(calcite.some((n) => noduleLabel(n) === 'Rhizolith')).toBe(true)
    expect(Math.max(...soil.cementCalcite)).toBeGreaterThan(0.3)
    // the calcic horizon sits deep, below most of the roots
    const m = soilMetrics(soil)
    expect(m.cementDepth).not.toBeNull()
    expect(m.cementDepth!).toBeGreaterThan(1)
  })

  it('silica stays in solution when the soil is kept wet', () => {
    const { soil } = run('volcanic', 40, () => RAIN)
    expect(soil.nodules.length).toBe(0)
  })
})

describe('purity & determinism', () => {
  it('never mutates its input', () => {
    const s0 = deepFreeze(run('volcanic', 30, () => DRY).soil)
    const plant: SoilPlant = { species: 'sunflower', biomass: 2, growth: 0.6, activity: 0.8 }
    expect(() => stepSoil(s0, 'volcanic', DRY, plant, 0.3)).not.toThrow()
    expect(() => stepSoil(s0, 'volcanic', RAIN, plant, 0.3)).not.toThrow()
  })

  it('replays exactly for the same inputs', () => {
    const a = run('volcanic', 50, () => DRY).soil
    const b = run('volcanic', 50, () => DRY).soil
    expect(b.nodules).toEqual(a.nodules)
    expect(b.water).toEqual(a.water)
  })

  it('keeps every quantity finite and in range', () => {
    for (const p of SOIL_PROFILE_IDS) {
      const { soil } = run(p, 60, wetCycles)
      for (let i = 0; i < SOIL_CELLS; i++) {
        const cement = soil.cementSilica[i] + soil.cementCalcite[i]
        expect(cement).toBeGreaterThanOrEqual(0)
        expect(cement).toBeLessThanOrEqual(0.93)
        expect(soil.water[i]).toBeGreaterThanOrEqual(0)
        expect(soil.water[i]).toBeLessThanOrEqual(1 - cement + 1e-9)
        expect(soil.silica[i]).toBeGreaterThanOrEqual(0)
        expect(soil.calcium[i]).toBeGreaterThanOrEqual(0)
        expect(soil.exchange[i]).toBeGreaterThanOrEqual(0)
        expect(Number.isFinite(soil.silica[i] + soil.calcium[i] + soil.exchange[i])).toBe(true)
      }
      expect(sum(soil.roots)).toBeGreaterThan(0)
    }
  })

  it('zero days is a no-op', () => {
    const s0 = createSoilState('loam', 'rose')
    expect(stepSoil(s0, 'loam', DRY, { species: 'rose', biomass: 1, growth: 1, activity: 1 }, 0)).toBe(s0)
  })
})
