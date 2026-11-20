import { describe, expect, it } from 'vitest'
import {
  ARREST_ACTIVITY,
  CAMBIAL_SIZE,
  cambialResponse,
  cambialSizeAt,
  cellPlateProgress,
  createTissueState,
  CYCLE,
  cyclePhase,
  DORMANT_FRACTION,
  earlywoodness,
  FILE_COUNT,
  layoutFile,
  PHLOEM_KEEP,
  PRIMARY_RADIUS,
  ringProfile,
  SEASON_DAYS,
  SPECIES_TISSUE,
  stemMetrics,
  stepTissue,
  tissueStatus,
  WINDOW_CELLS,
  type TissueInputs,
  type TissueState,
} from './TissueGrowth'

const GOOD: TissueInputs = { temperature: 22, light: 0.85, water: 0.9 }
const DROUGHT: TissueInputs = { ...GOOD, water: 0.2 }

/** Runs the sim in frame-sized steps, the way the store ticks it. */
function run(state: TissueState, env: TissueInputs, days: number, species = 'oak', dt = 0.05): TissueState {
  let s = state
  for (let t = 0; t < days - 1e-9; t += dt) s = stepTissue(s, species, env, Math.min(dt, days - t))
  return s
}

function deepFreeze<T>(o: T): T {
  if (o && typeof o === 'object' && !Object.isFrozen(o)) {
    Object.freeze(o)
    for (const v of Object.values(o)) deepFreeze(v)
  }
  return o
}

const xylemCount = (s: TissueState) => s.files.reduce((n, f) => n + f.xylem.length + f.retired, 0)
const phloemBorn = (s: TissueState) => s.divisions - xylemCount(s)

describe('cambial response', () => {
  it('is near full speed in mild, wet, bright weather', () => {
    const r = cambialResponse(GOOD)
    expect(r.activity).toBeGreaterThan(0.8)
    expect(r.limiting).toBe('none')
  })

  it('slows division as water status falls, and stops it in drought', () => {
    const wet = cambialResponse({ ...GOOD, water: 0.9 }).activity
    const dry = cambialResponse({ ...GOOD, water: 0.3 }).activity
    const parched = cambialResponse({ ...GOOD, water: 0.1 }).activity
    expect(dry).toBeLessThan(wet)
    expect(parched).toBeLessThan(ARREST_ACTIVITY)
    expect(cambialResponse({ ...GOOD, water: 0.3 }).limiting).toBe('water')
  })

  it('is monotonic in water, light and (below optimum) temperature', () => {
    let prev = -1
    for (let w = 0.05; w <= 1; w += 0.05) {
      const a = cambialResponse({ ...GOOD, water: w }).activity
      expect(a).toBeGreaterThanOrEqual(prev)
      prev = a
    }
    prev = -1
    for (let l = 0; l <= 1; l += 0.1) {
      const a = cambialResponse({ ...GOOD, light: l }).activity
      expect(a).toBeGreaterThanOrEqual(prev)
      prev = a
    }
    prev = -1
    for (let T = -5; T <= 22; T += 1) {
      const a = cambialResponse({ ...GOOD, temperature: T }).activity
      expect(a).toBeGreaterThanOrEqual(prev)
      prev = a
    }
  })

  it('shuts the cambium in the cold and in heat, and names which', () => {
    const cold = cambialResponse({ ...GOOD, temperature: 0 })
    const hot = cambialResponse({ ...GOOD, temperature: 44 })
    expect(cold.activity).toBeLessThan(ARREST_ACTIVITY)
    expect(cold.limiting).toBe('cold')
    expect(hot.activity).toBeLessThan(ARREST_ACTIVITY)
    expect(hot.limiting).toBe('heat')
  })

  it('makes cell enlargement more drought-sensitive than division', () => {
    const r = cambialResponse({ ...GOOD, water: 0.4 })
    expect(r.water).toBeGreaterThan(r.expansion)
  })

  it('blames darkness when light is the weakest driver', () => {
    expect(cambialResponse({ ...GOOD, light: 0.2 }).limiting).toBe('dark')
  })
})

describe('cell cycle', () => {
  it('walks G1 → S → G2 → mitosis in order', () => {
    const phases = [0.1, 0.4, 0.6, 0.7, 0.78, 0.85, 0.95].map(cyclePhase)
    expect(phases).toEqual(['G1', 'S', 'G2', 'prophase', 'metaphase', 'anaphase', 'telophase'])
  })

  it('grows the cambial cell from half to full size before mitosis', () => {
    expect(cambialSizeAt(0)).toBeCloseTo(CAMBIAL_SIZE / 2)
    expect(cambialSizeAt(CYCLE.M_START)).toBeCloseTo(CAMBIAL_SIZE)
    expect(cambialSizeAt(0.95)).toBeCloseTo(CAMBIAL_SIZE)
  })

  it('only grows the cell plate after anaphase', () => {
    expect(cellPlateProgress(CYCLE.ANAPHASE_END)).toBe(0)
    expect(cellPlateProgress(0.5)).toBe(0)
    expect(cellPlateProgress(1)).toBe(1)
  })
})

describe('stepTissue', () => {
  it('does nothing when no time passes', () => {
    const s = createTissueState('oak')
    expect(stepTissue(s, 'oak', GOOD, 0)).toBe(s)
    expect(stepTissue(s, 'oak', GOOD, -1)).toBe(s)
  })

  it('never mutates its input (deep-frozen state steps cleanly)', () => {
    const s = deepFreeze(run(createTissueState('oak'), GOOD, 30))
    expect(() => stepTissue(s, 'oak', GOOD, 1)).not.toThrow()
    const next = stepTissue(s, 'oak', GOOD, 1)
    expect(next).not.toBe(s)
    expect(next.t).toBeCloseTo(s.t + 1)
  })

  it('is deterministic for a given seed and input history', () => {
    const a = run(createTissueState('oak', 7), GOOD, 25)
    const b = run(createTissueState('oak', 7), GOOD, 25)
    expect(b).toEqual(a)
    const other = run(createTissueState('oak', 8), GOOD, 25)
    expect(other).not.toEqual(a)
  })

  it('gives the same result whether the days arrive in big or small slices', () => {
    const fine = run(createTissueState('oak'), GOOD, 6, 'oak', 0.02)
    const coarse = stepTissue(createTissueState('oak'), 'oak', GOOD, 6)
    // progress is carried across divisions, so step size only moves a division
    // across the 6-day boundary, never changes the rate
    expect(Math.abs(coarse.divisions - fine.divisions)).toBeLessThanOrEqual(2)
    expect(coarse.t).toBeCloseTo(fine.t)
  })

  it('divides cambial cells and makes xylem and phloem in the right ratio', () => {
    const s = run(createTissueState('oak'), GOOD, SEASON_DAYS * 0.8)
    expect(s.divisions).toBeGreaterThan(FILE_COUNT * 8)
    const xylem = xylemCount(s)
    const phloem = phloemBorn(s)
    expect(phloem).toBeGreaterThan(0)
    // oak makes ~5 xylem per phloem cell
    expect(xylem / phloem).toBeGreaterThan(3.5)
    expect(xylem / phloem).toBeLessThan(7)
  })

  it('keeps the cambial cell alive and in range after dividing', () => {
    const s = run(createTissueState('oak'), GOOD, 15)
    for (const f of s.files) {
      expect(f.cambium.cycle).toBeGreaterThanOrEqual(0)
      expect(f.cambium.cycle).toBeLessThan(1)
      expect(f.cambium.size).toBeGreaterThanOrEqual(CAMBIAL_SIZE / 2 - 1e-9)
      expect(f.cambium.size).toBeLessThanOrEqual(CAMBIAL_SIZE + 1e-9)
    }
  })

  it('bounds memory: old wood leaves the window and old phloem is crushed', () => {
    const s = run(createTissueState('oak'), GOOD, SEASON_DAYS * 5)
    for (const f of s.files) {
      expect(f.xylem.length).toBeLessThanOrEqual(WINDOW_CELLS)
      expect(f.phloem.length).toBeLessThanOrEqual(PHLOEM_KEEP)
      expect(f.retired).toBeGreaterThan(0)
    }
  })

  it('opens a new ring each season', () => {
    const s = run(createTissueState('oak'), GOOD, SEASON_DAYS * 3 + 1)
    expect(s.rings.map((r) => r.index)).toEqual([0, 1, 2, 3])
    expect(stemMetrics(s).ringsComplete).toBe(3)
  })

  it('lays earlywood (big cells) before latewood (small cells) within a ring', () => {
    const s = run(createTissueState('oak'), GOOD, SEASON_DAYS * 0.95)
    const cells = s.files[0].xylem.filter((c) => c.ring === 0)
    expect(cells.length).toBeGreaterThan(6)
    const first = cells.slice(0, 3).reduce((a, c) => a + c.target, 0) / 3
    const last = cells.slice(-3).reduce((a, c) => a + c.target, 0) / 3
    expect(first).toBeGreaterThan(last * 1.5)
    expect(earlywoodness(0)).toBe(1)
    expect(earlywoodness(0.9)).toBe(0)
  })

  it('makes ring-porous oak earlywood vessel-rich and latewood vessel-poor', () => {
    const s = run(createTissueState('oak'), GOOD, SEASON_DAYS * 0.95)
    const cells = s.files.flatMap((f) => f.xylem).filter((c) => c.ring === 0)
    const earlyV = cells.filter((c) => c.early && c.variant === 'vessel').length / cells.filter((c) => c.early).length
    const lateV = cells.filter((c) => !c.early && c.variant === 'vessel').length / cells.filter((c) => !c.early).length
    expect(earlyV).toBeGreaterThan(0.45)
    expect(lateV).toBeLessThan(0.2)
  })

  it('has no vessels in a fern (tracheids only)', () => {
    const s = run(createTissueState('fern'), GOOD, SEASON_DAYS, 'fern')
    expect(s.files.flatMap((f) => f.xylem).some((c) => c.variant === 'vessel')).toBe(false)
  })

  it('matures xylem: enlarges, thickens its wall, then completes', () => {
    const s = run(createTissueState('oak'), GOOD, 12)
    const f = s.files[0]
    const oldest = f.xylem[0]
    expect(oldest.maturity).toBe(1)
    expect(oldest.expand).toBe(1)
    expect(oldest.size).toBeCloseTo(Math.max(oldest.target, oldest.birthSize), 5)
  })
})

describe('weather stress', () => {
  it('drought slows division: far fewer cells in the same time', () => {
    const wet = run(createTissueState('oak'), GOOD, 12)
    const dry = run(createTissueState('oak'), DROUGHT, 12)
    expect(dry.divisions).toBeLessThan(wet.divisions * 0.5)
  })

  it('severe drought arrests the cambium at a checkpoint', () => {
    const parched = run(createTissueState('oak'), { ...GOOD, water: 0.05 }, 20)
    const arrestedBefore = parched.divisions
    const later = run(parched, { ...GOOD, water: 0.05 }, 10)
    // every cell either sits in G1 or at the G2/M checkpoint, so nothing divides
    expect(later.divisions - arrestedBefore).toBeLessThanOrEqual(0)
    for (const f of later.files) {
      const ph = cyclePhase(f.cambium.cycle)
      expect(['G1', 'G2']).toContain(ph)
    }
  })

  it('drought leaves small cells: enlargement is gated by turgor', () => {
    const meanSize = (s: TissueState) => {
      const cells = s.files.flatMap((f) => f.xylem).filter((c) => c.maturity >= 1 && c.early)
      return cells.reduce((a, c) => a + c.size, 0) / cells.length
    }
    const wet = run(createTissueState('oak'), GOOD, 14)
    // mildly dry: division continues but cells cannot swell
    const mild = run(createTissueState('oak'), { ...GOOD, water: 0.4 }, 14)
    expect(meanSize(mild)).toBeLessThan(meanSize(wet) * 0.85)
  })

  it('drought narrows the ring and the stem ends up thinner', () => {
    const wet = stemMetrics(run(createTissueState('oak'), GOOD, SEASON_DAYS * 1.5))
    const dry = stemMetrics(run(createTissueState('oak'), DROUGHT, SEASON_DAYS * 1.5))
    expect(dry.lastRingWidth).toBeGreaterThan(0)
    expect(dry.lastRingWidth).toBeLessThan(wet.lastRingWidth * 0.5)
    expect(dry.stemRadius).toBeLessThan(wet.stemRadius)
  })

  it('records drought as stress on the ring, and none when well watered', () => {
    const wet = ringProfile(run(createTissueState('oak'), GOOD, SEASON_DAYS * 0.9))[0]
    const dry = ringProfile(run(createTissueState('oak'), DROUGHT, SEASON_DAYS * 0.9))[0]
    expect(wet.stress).toBeLessThan(0.05)
    expect(dry.stress).toBeGreaterThan(0.7)
  })

  it('stops dividing in the cold, and resumes when it warms', () => {
    const cold = run(createTissueState('oak'), { ...GOOD, temperature: 0 }, 15)
    const base = cold.divisions
    const warm = run(cold, GOOD, 6)
    expect(warm.divisions).toBeGreaterThan(base + FILE_COUNT)
  })

  it('rests the cambium in the dormant tail of every season', () => {
    const start = SEASON_DAYS * (1 - DORMANT_FRACTION)
    const at = run(createTissueState('oak'), GOOD, start + 1) // 1 day to let in-flight mitoses finish
    const during = run(at, GOOD, SEASON_DAYS - start - 1.2)
    expect(during.divisions - at.divisions).toBeLessThanOrEqual(FILE_COUNT)
    // and growth picks up again in the next season
    const next = run(during, GOOD, 6)
    expect(next.divisions - during.divisions).toBeGreaterThan(FILE_COUNT)
  })

  it('reports status for the panel', () => {
    const s = createTissueState('oak')
    expect(tissueStatus(s, GOOD).id).toBe('active')
    expect(tissueStatus(s, { ...GOOD, water: 0.3 }).id).toBe('slowed')
    expect(tissueStatus(s, { ...GOOD, water: 0.05 }).id).toBe('arrested')
    const dormant = { ...s, t: SEASON_DAYS * 0.97 }
    expect(tissueStatus(dormant, GOOD).id).toBe('dormant')
  })
})

describe('layout and aggregates', () => {
  it('lays cells end to end around the cambium, with no gaps or overlaps', () => {
    const s = run(createTissueState('oak'), GOOD, 15)
    for (const f of s.files) {
      const items: { kind: string; x0: number; x1: number }[] = []
      layoutFile(f, (kind, x0, x1) => items.push({ kind, x0, x1 }))
      items.sort((a, b) => a.x0 - b.x0)
      for (let i = 1; i < items.length; i++) expect(items[i].x0).toBeCloseTo(items[i - 1].x1, 6)
      const cam = items.find((i) => i.kind === 'cambium')!
      expect(cam.x0).toBeCloseTo(-cam.x1)
      expect(items.at(-1)!.kind).toBe('epidermis')
    }
  })

  it('shows pith and primary xylem until wood has been retired', () => {
    const kinds = (s: TissueState) => {
      const set = new Set<string>()
      layoutFile(s.files[0], (k) => set.add(k))
      return set
    }
    const young = createTissueState('oak')
    expect(kinds(young)).toContain('pith')
    expect(kinds(young)).toContain('primaryXylem')
    const old = run(young, GOOD, SEASON_DAYS * 5)
    expect(kinds(old)).not.toContain('pith')
    expect(kinds(old)).toContain('xylem')
  })

  it('keeps ring widths consistent with the cells, including wood that left the window', () => {
    const s = run(createTissueState('oak'), GOOD, SEASON_DAYS * 6)
    const rings = ringProfile(s)
    expect(rings[0].inner).toBe(PRIMARY_RADIUS)
    for (let i = 1; i < rings.length; i++) expect(rings[i].inner).toBeCloseTo(rings[i - 1].outer)
    for (const r of rings) {
      expect(r.earlyOuter).toBeGreaterThanOrEqual(r.inner)
      expect(r.earlyOuter).toBeLessThanOrEqual(r.outer + 1e-9)
    }
    // total xylem radius = primary + Σ per-file xylem thickness, averaged
    const perFile = s.files.map((f) => f.retiredSize + f.xylem.reduce((a, c) => a + c.size, 0))
    const mean = perFile.reduce((a, b) => a + b, 0) / perFile.length
    expect(stemMetrics(s).xylemRadius).toBeCloseTo(PRIMARY_RADIUS + mean, 4)
  })

  it('thickens the stem as it ages', () => {
    const a = stemMetrics(run(createTissueState('oak'), GOOD, SEASON_DAYS))
    const b = stemMetrics(run(createTissueState('oak'), GOOD, SEASON_DAYS * 3))
    expect(b.stemRadius).toBeGreaterThan(a.stemRadius)
  })

  it('counts cells per cycle phase across the files', () => {
    const m = stemMetrics(createTissueState('oak'))
    const total = Object.values(m.phaseCounts).reduce((a, b) => a + b, 0)
    expect(total).toBe(FILE_COUNT)
  })

  it('has a tissue preset for every species, with sane numbers', () => {
    for (const sp of Object.values(SPECIES_TISSUE)) {
      expect(sp.cycleDays).toBeGreaterThan(0.3)
      expect(sp.xylemPerPhloem).toBeGreaterThan(1)
      expect(sp.earlySize).toBeGreaterThanOrEqual(sp.lateSize)
      expect(sp.note.length).toBeGreaterThan(10)
    }
  })
})
