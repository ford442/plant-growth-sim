import { beforeEach, describe, expect, it } from 'vitest'
import { BED_LAYOUT, createPlot, slotSeed, stepGarden, type GardenSnapshot } from './plot'
import { useSimStore } from '../stores/simStore'
import { useTimeStore } from '../stores/timeStore'

const sim = () => useSimStore.getState()
const DRY = { temperature: 22, humidity: 0.5, light: 0.9, precipitation: 0, wind: 1 }
const WET = { ...DRY, precipitation: 6 }

function deepFreeze<T>(o: T): T {
  if (o && typeof o === 'object' && !Object.isFrozen(o)) {
    Object.freeze(o)
    for (const v of Object.values(o)) deepFreeze(v)
  }
  return o
}

beforeEach(() => {
  useTimeStore.getState().play()
  useTimeStore.getState().setSpeed(1)
  sim().reset()
})

describe('the bed', () => {
  it('holds 5–9 individuals of mixed species with stable, distinct seeds', () => {
    const plot = createPlot()
    expect(plot.length).toBeGreaterThanOrEqual(5)
    expect(plot.length).toBeLessThanOrEqual(9)
    expect(new Set(plot.map((p) => p.species)).size).toBeGreaterThan(3)
    expect(new Set(plot.map((p) => p.seed)).size).toBe(plot.length)
    expect(createPlot().map((p) => p.seed)).toEqual(plot.map((p) => p.seed))
    expect(plot.map((p) => p.seed)).toEqual(BED_LAYOUT.map((_, i) => slotSeed(i)))
  })

  it('steps every individual once per fixed step, purely', () => {
    const s = sim()
    const snap = deepFreeze({ ...s } as unknown as GardenSnapshot)
    const next = stepGarden(snap, 1)
    for (const [i, ind] of next.plot.entries()) {
      expect(ind.age).toBeCloseTo(snap.plot[i].age + 1, 9)
      expect(ind.height).toBeGreaterThanOrEqual(snap.plot[i].height)
    }
  })

  it('individuals of different species diverge under one weather', () => {
    sim().setWeather(WET)
    for (let i = 0; i < 300; i++) sim().tick(0.1) // 30 days
    const heights = sim().plot.map((p) => p.height / p.lsystemProgress)
    expect(new Set(heights.map((h) => h.toFixed(4))).size).toBe(heights.length)
  })

  it('rain reaches every individual through the soil and the kernel', () => {
    sim().setWeather(DRY)
    for (let i = 0; i < 600; i++) sim().tick(0.1)
    const dry = sim().plot.map((p) => p.waterStatus)
    sim().reset()
    sim().setWeather(WET)
    for (let i = 0; i < 600; i++) sim().tick(0.1)
    const wet = sim().plot.map((p) => p.waterStatus)
    wet.forEach((w, i) => expect(w).toBeGreaterThan(dry[i]))
  })

  it('the focused slot mirrors the top-level plant after every tick', () => {
    for (let i = 0; i < 50; i++) sim().tick(0.1)
    const s = sim()
    const f = s.plot.find((p) => p.id === s.focusId)!
    expect(f.age).toBe(s.age)
    expect(f.height).toBe(s.height)
    expect(f.waterStatus).toBe(s.waterStatus)
    expect(f.tissue).toBe(s.tissue)
  })

  it('switching focus loads that individual without moving time', () => {
    for (let i = 0; i < 50; i++) sim().tick(0.1)
    const before = sim()
    const other = before.plot[1]
    sim().setFocus(other.id)
    const s = sim()
    expect(s.focusId).toBe(other.id)
    expect(s.species).toBe(other.species)
    expect(s.age).toBe(other.age)
    expect(s.height).toBe(other.height)
    expect(s.tissue).toBe(other.tissue)
    expect(s.time).toBe(before.time)
    // the old focus kept its state in its slot
    expect(s.plot[0].height).toBe(before.height)
  })

  it('replanting the focus leaves the rest of the bed growing', () => {
    for (let i = 0; i < 50; i++) sim().tick(0.1)
    const before = sim().plot
    sim().replantFocus('oak')
    const s = sim()
    expect(s.species).toBe('oak')
    expect(s.age).toBe(0)
    expect(s.plot[0].species).toBe('oak')
    expect(s.plot.slice(1)).toEqual(before.slice(1))
  })
})
