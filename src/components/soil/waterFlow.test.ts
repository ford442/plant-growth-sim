import { describe, expect, it } from 'vitest'
import {
  CELL_W,
  cellIndex,
  cellX,
  cellZ,
  createSoilState,
  rootSystem,
  SOIL_CELLS,
  SOIL_COLS,
  stepSoil,
  type SoilWeather,
} from '../../simulation/SoilField'
import { poseRoots, rootSkeleton } from './rootSkeleton'
import { FLOW, PHASE_FREE, PHASE_ROOT, PHASE_SOIL, PHASE_STEM, WaterFlow } from './waterFlow'

const def = rootSystem('sunflower')
const skeleton = rootSkeleton(def, 'sunflower'.length)
const fullFront = () => ({ rootDepth: def.maxDepth, rootFront: new Array<number>(SOIL_COLS).fill(def.maxDepth) })
const posed = poseRoots(skeleton, def, fullFront())
const STEM_TOP = 1

const field = (fn: (col: number, row: number) => number) =>
  Array.from({ length: SOIL_CELLS }, (_, i) => fn(i % SOIL_COLS, Math.floor(i / SOIL_COLS)))
const uniform = field((col, row) => (row < 8 && Math.abs(col - SOIL_COLS / 2 + 0.5) < 5 ? 0.5 : 0))

function run(flow: WaterFlow, seconds: number, dt = 1 / 30) {
  for (let t = 0; t < seconds; t += dt) flow.step(dt, posed, STEM_TOP)
}

describe('WaterFlow', () => {
  it('emits nothing from a field with no uptake', () => {
    const f = new WaterFlow(skeleton)
    f.setSources(posed, new Array<number>(SOIL_CELLS).fill(0))
    run(f, 3)
    expect(f.spawned).toBe(0)
    expect(f.alive).toBe(0)
  })

  it('spawns where the roots are drawing water, and only there', () => {
    // one hot cell beside the stem; every other cell is dry
    const hot = cellIndex(SOIL_COLS / 2 + 1, 3)
    const f = new WaterFlow(skeleton)
    f.setSources(posed, field((col, row) => (cellIndex(col, row) === hot ? 5 : 0)))
    run(f, 0.2)
    let seen = 0
    for (let i = 0; i < f.capacity; i++) {
      if (f.phase[i] !== PHASE_SOIL) continue
      seen++
      expect(Math.abs(f.x[i] - cellX(SOIL_COLS / 2 + 1))).toBeLessThanOrEqual(CELL_W * 0.6)
      expect(Math.abs(-f.y[i] - cellZ(3))).toBeLessThan(0.15)
    }
    expect(seen).toBeGreaterThan(0)
  })

  it('carries water soil → root → stem and hands it off at the top', () => {
    const f = new WaterFlow(skeleton)
    f.setSources(posed, uniform)
    const phases = new Set<number>()
    for (let t = 0; t < 12; t += 1 / 30) {
      f.step(1 / 30, posed, STEM_TOP)
      for (let i = 0; i < f.capacity; i++) phases.add(f.phase[i])
    }
    expect([...phases].sort()).toEqual([PHASE_FREE, PHASE_SOIL, PHASE_ROOT, PHASE_STEM])
    expect(f.delivered).toBeGreaterThan(0)
    // …and every parcel that has been delivered has either risen to the top (and left) or is still in the stem
    expect(f.delivered).toBeLessThanOrEqual(f.spawned)
    let inStem = 0
    for (let i = 0; i < f.capacity; i++) {
      if (f.phase[i] !== PHASE_STEM) continue
      inStem++
      expect(f.y[i]).toBeLessThanOrEqual(STEM_TOP)
      if (f.y[i] > FLOW.collar) expect(Math.abs(f.x[i])).toBeLessThan(1e-3) // up the stem axis
    }
    expect(inStem).toBeGreaterThan(0)
  })

  it('moves a root parcel up toward the stem, never down it', () => {
    const f = new WaterFlow(skeleton)
    f.setSources(posed, uniform)
    run(f, 1.5)
    // follow one root particle until it leaves the roots: its path length to the stem only shrinks
    const dist = (i: number) => {
      let d = 0
      let j = f['seg'][i]
      let s = f['s'][i]
      for (;;) {
        d += s * Math.hypot(posed.x1[j] - posed.x0[j], posed.z1[j] - posed.z0[j])
        const p = skeleton[j].parent
        if (p < 0) return d
        j = p
        s = 1
      }
    }
    const i = Array.from({ length: f.capacity }, (_, n) => n).find((n) => f.phase[n] === PHASE_ROOT)!
    expect(i).toBeDefined()
    let last = dist(i)
    for (let n = 0; n < 20 && f.phase[i] === PHASE_ROOT; n++) {
      f.step(1 / 30, posed, STEM_TOP)
      if (f.phase[i] !== PHASE_ROOT) break
      const d = dist(i)
      expect(d).toBeLessThan(last)
      last = d
    }
  })

  it('does not stack parcels in lockstep at the stem, whatever the frame time', () => {
    // a slow frame (dt = 0.1 s) must not drop everything delivered in it at one height
    const f = new WaterFlow(skeleton)
    f.setSources(posed, uniform)
    run(f, 8, 0.1)
    const heights: number[] = []
    for (let i = 0; i < f.capacity; i++) if (f.phase[i] === PHASE_STEM) heights.push(Math.round(f.y[i] * 1000))
    expect(heights.length).toBeGreaterThan(40)
    const distinct = new Set(heights).size
    expect(distinct / heights.length).toBeGreaterThan(0.85)
  })

  it('emits in proportion to the uptake, and caps at the pool', () => {
    const lo = new WaterFlow(skeleton)
    const hi = new WaterFlow(skeleton)
    lo.setSources(posed, uniform.map((v) => v * 0.5))
    hi.setSources(posed, uniform)
    run(lo, 4)
    run(hi, 4)
    expect(hi.spawned / lo.spawned).toBeGreaterThan(1.7)
    expect(hi.spawned / lo.spawned).toBeLessThan(2.3)

    const flood = new WaterFlow(skeleton, 40)
    flood.setSources(posed, uniform.map((v) => v * 100))
    run(flood, 3)
    expect(flood.alive).toBeLessThanOrEqual(40)
    expect(flood.rate).toBe(FLOW.maxRate)
  })

  it('drains away when the uptake stops', () => {
    const f = new WaterFlow(skeleton)
    f.setSources(posed, uniform)
    run(f, 4)
    expect(f.alive).toBeGreaterThan(0)
    const n = f.spawned
    f.setSources(posed, new Array<number>(SOIL_CELLS).fill(0))
    run(f, 10)
    expect(f.spawned).toBe(n)
    expect(f.alive).toBe(0)
  })

  it('hands a dry cell’s water to the nearest drawn root instead of losing it', () => {
    // a lone sink far off to the side of the drawn roots
    const f = new WaterFlow(skeleton)
    f.setSources(posed, field((col, row) => (col === 1 && row === 12 ? 1 : 0)))
    expect(f.rate).toBeGreaterThan(0)
    run(f, 8)
    expect(f.delivered).toBeGreaterThan(0)
  })

  it('does nothing while paused', () => {
    const f = new WaterFlow(skeleton)
    f.setSources(posed, uniform)
    run(f, 2)
    const before = { x: f.x.slice(), y: f.y.slice(), phase: f.phase.slice(), spawned: f.spawned }
    for (let n = 0; n < 30; n++) f.step(0, posed, STEM_TOP)
    expect(f.spawned).toBe(before.spawned)
    expect(f.x).toEqual(before.x)
    expect(f.y).toEqual(before.y)
    expect(f.phase).toEqual(before.phase)
  })

  it('drops parcels whose root is no longer drawn (roots reset)', () => {
    const f = new WaterFlow(skeleton)
    f.setSources(posed, uniform)
    run(f, 3)
    expect(f.alive).toBeGreaterThan(0)
    const seedling = poseRoots(skeleton, def, { rootDepth: 0.01, rootFront: new Array<number>(SOIL_COLS).fill(0.01) })
    f.setSources(seedling, new Array<number>(SOIL_CELLS).fill(0))
    for (let t = 0; t < 8; t += 1 / 30) f.step(1 / 30, seedling, STEM_TOP)
    expect(f.alive).toBe(0)
  })

  it('is deterministic for a seed', () => {
    const a = new WaterFlow(skeleton, 300, 11)
    const b = new WaterFlow(skeleton, 300, 11)
    for (const f of [a, b]) {
      f.setSources(posed, uniform)
      run(f, 5)
    }
    expect(b.x).toEqual(a.x)
    expect(b.y).toEqual(a.y)
    expect(b.spawned).toBe(a.spawned)
  })

  it('keeps every live particle on screen and finite', () => {
    const f = new WaterFlow(skeleton)
    f.setSources(posed, uniform)
    for (let t = 0; t < 10; t += 1 / 30) {
      f.step(1 / 30, posed, STEM_TOP)
      for (let i = 0; i < f.capacity; i++) {
        if (f.phase[i] === PHASE_FREE) continue
        expect(Number.isFinite(f.x[i] + f.y[i] + f.fade[i])).toBe(true)
        expect(f.fade[i]).toBeGreaterThanOrEqual(0)
        expect(f.fade[i]).toBeLessThanOrEqual(1)
        expect(f.y[i]).toBeLessThanOrEqual(STEM_TOP + 1e-6)
      }
    }
  })
})

describe('WaterFlow on a live soil', () => {
  const DRY: SoilWeather = { temperature: 22, humidity: 0.6, light: 0.85, precipitation: 0, wind: 1.2 }

  it('streams harder from a wet soil than from a drought-stricken one', () => {
    const rate = (weather: SoilWeather, days: number) => {
      let soil = createSoilState('loam', 'sunflower')
      let water = 0.85
      let biomass = 0.1
      for (let d = 0; d < days; d += 0.1) {
        soil = stepSoil(soil, 'loam', weather, { species: 'sunflower', biomass, growth: 0.85 * water, activity: water }, 0.1)
        water += (soil.supply - water) * (1 - Math.exp(-0.1))
        biomass += 0.1 * 0.08 * 0.85 * water
      }
      const f = new WaterFlow(skeleton)
      f.setSources(poseRoots(skeleton, def, soil), soil.uptakeField)
      return f.rate
    }
    // uptake follows the transpiration demand until the soil can no longer give it
    const wet = rate({ ...DRY, precipitation: 4 }, 90)
    const dry = rate(DRY, 90)
    expect(dry).toBeGreaterThan(0)
    expect(wet).toBeGreaterThan(dry * 1.1)
  })
})
