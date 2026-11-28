import { describe, expect, it } from 'vitest'
import { ADAPTIVE_LOD_BAND, LOD_TIERS } from '../../../rendering/lod/adaptiveLod'
import { NICHES } from '../../../simulation/parasite/hostImmunity'
import { CYST_MAX_BRADYZOITES } from '../../../simulation/parasite/stages'
import { MATURE_CYST_BRADYZOITES } from '../../../simulation/parasite/world'
import { cystStage, describeCyst, formatAge } from './cystInfo'
import { pickSphere } from './cystPick'
import { relativeLuminance, SLICE_PALETTES } from './palette'
import { niceScaleBar, scaleBarLabel } from './scaleBar'
import { CYST_CAPACITY, maxLatticeCells } from './sliceLayout'
import {
  cellTriangles,
  crescentTriangles,
  DEFAULT_LOD_TIER,
  MAX_BRADYZOITE_INSTANCES,
  SLICE_LOD,
  sphereTriangles,
} from './sliceLod'

describe('cystStage', () => {
  it('uses the sim’s own maturity line, not a new one', () => {
    expect(cystStage(MATURE_CYST_BRADYZOITES - 1).id).toBe('growing')
    expect(cystStage(MATURE_CYST_BRADYZOITES).id).toBe('mature')
    expect(cystStage(CYST_MAX_BRADYZOITES).id).toBe('mature')
    expect(cystStage(2).label).toMatch(/growing/i)
  })
})

describe('formatAge', () => {
  it('reads in hours, then days, then months', () => {
    expect(formatAge(5)).toBe('5 h')
    expect(formatAge(48)).toBe('2.0 d')
    expect(formatAge(24 * 89)).toBe('89.0 d')
    expect(formatAge(24 * 90)).toBe('3.0 mo')
  })
})

describe('describeCyst', () => {
  const base = { niche: 'retina', diameter: 41.234, wall: 0.3171, bradyzoites: 312, ageHours: 72 } as const

  it('gives stage, age, bradyzoite count, size, wall and niche', () => {
    const info = describeCyst(base)
    expect(info.title).toBe('Mature tissue cyst')
    expect(Object.fromEntries(info.rows)).toEqual({
      Age: '3.0 d',
      Bradyzoites: '312',
      Diameter: '41.2 µm',
      Wall: '0.32 µm',
      Niche: 'Retina',
    })
  })

  it('marks a cyst at the 1 024 cap as full', () => {
    expect(Object.fromEntries(describeCyst({ ...base, bradyzoites: CYST_MAX_BRADYZOITES }).rows).Bradyzoites).toMatch(/full/)
  })
})

describe('niceScaleBar', () => {
  it('only ever picks 1, 2 or 5 × 10ⁿ µm', () => {
    for (const umPerPx of [0.01, 0.07, 0.3, 0.9, 2.2, 5, 11, 48, 130]) {
      const { um } = niceScaleBar(umPerPx)
      const mantissa = um / 10 ** Math.floor(Math.log10(um))
      expect([1, 2, 5].some((m) => Math.abs(mantissa - m) < 1e-9)).toBe(true)
    }
  })

  it('stays within a readable width and is true to the scale', () => {
    for (let umPerPx = 0.02; umPerPx < 200; umPerPx *= 1.17) {
      const bar = niceScaleBar(umPerPx)
      expect(bar.px).toBeGreaterThan(60)
      expect(bar.px).toBeLessThan(260)
      expect(bar.px * umPerPx).toBeCloseTo(bar.um, 6) // width really covers `um` micrometres
    }
  })

  it('gives a 100 µm bar at 0.8 µm per pixel', () => {
    expect(niceScaleBar(0.8).label).toBe('100 µm')
  })

  it('labels in nm, µm and mm', () => {
    expect(scaleBarLabel(0.5)).toBe('500 nm')
    expect(scaleBarLabel(20)).toBe('20 µm')
    expect(scaleBarLabel(1000)).toBe('1 mm')
    expect(scaleBarLabel(2000)).toBe('2 mm')
  })
})

describe('pickSphere', () => {
  // x, y, z, radius: sphere 0 at the origin, sphere 1 behind it on the Z axis, sphere 2 off to the side
  const spheres = new Float32Array([0, 0, 0, 5, 0, 0, -30, 5, 20, 0, 0, 10])

  it('picks the nearest sphere the ray enters, whichever way it comes from', () => {
    expect(pickSphere(0, 0, 100, 0, 0, -1, spheres, 3)).toBe(0) // sphere 1 is hidden behind sphere 0
    expect(pickSphere(0, 0, -100, 0, 0, 1, spheres, 3)).toBe(1) // from the far side, sphere 1 comes first
    expect(pickSphere(100, 0, 0, -1, 0, 0, spheres, 3)).toBe(2)
  })

  it('misses when the ray passes wide of everything', () => {
    expect(pickSphere(50, 0, 100, 0, 0, -1, spheres, 3)).toBe(-1)
  })

  it('does not pick a sphere behind the origin', () => {
    expect(pickSphere(0, 0, 100, 0, 0, 1, spheres, 3)).toBe(-1)
  })

  it('widens tiny cysts to a minimum radius so they can be pointed at', () => {
    const tiny = new Float32Array([0, 0, 0, 2.5])
    expect(pickSphere(5, 0, 100, 0, 0, -1, tiny, 1)).toBe(-1)
    expect(pickSphere(5, 0, 100, 0, 0, -1, tiny, 1, 6)).toBe(0)
  })

  it('normalises the direction it is given', () => {
    expect(pickSphere(0, 0, 100, 0, 0, -40, spheres, 3)).toBe(0)
  })

  it('only looks at the first n spheres', () => {
    expect(pickSphere(0, 0, 100, 0, 0, -1, spheres, 2)).toBe(0)
  })
})

describe('slice palettes', () => {
  it('cover every niche (a new niche is a compile error, and this keeps the table honest)', () => {
    for (const id of NICHES) expect(SLICE_PALETTES[id]).toBeDefined()
  })

  it('are dark-field dark: tissue never competes with the cysts for brightness', () => {
    for (const id of NICHES) {
      expect(relativeLuminance(SLICE_PALETTES[id].cell)).toBeLessThan(0.07)
      expect(relativeLuminance(SLICE_PALETTES[id].matrix)).toBeLessThan(0.012)
      // the matrix showing between tiles is always darker than the tiles, or there is no mosaic
      expect(relativeLuminance(SLICE_PALETTES[id].matrix)).toBeLessThan(relativeLuminance(SLICE_PALETTES[id].cell))
    }
  })

  it('look different from one another', () => {
    expect(new Set(NICHES.map((id) => SLICE_PALETTES[id].cell)).size).toBe(NICHES.length)
  })

  it('computes luminance sensibly', () => {
    expect(relativeLuminance('#000000')).toBe(0)
    expect(relativeLuminance('#ffffff')).toBeCloseTo(1, 6)
  })
})

describe('LOD tiers', () => {
  it('are defined for exactly the ladder’s tiers, cheapest first', () => {
    expect(Object.keys(SLICE_LOD).sort()).toEqual([...LOD_TIERS].sort())
    const budgets = LOD_TIERS.map((t) => SLICE_LOD[t].bradyzoiteBudget)
    expect([...budgets].sort((a, b) => a - b)).toEqual(budgets)
    expect(new Set(budgets).size).toBe(budgets.length)
  })

  it('make the default tier the ~20 k bradyzoite acceptance case', () => {
    expect(DEFAULT_LOD_TIER).toBe('high')
    expect(SLICE_LOD[DEFAULT_LOD_TIER].bradyzoiteBudget).toBe(20_000)
    expect(ADAPTIVE_LOD_BAND).toContain(DEFAULT_LOD_TIER)
  })

  it('size the shared buffer for the largest tier, so a tier change never reallocates', () => {
    expect(MAX_BRADYZOITE_INSTANCES).toBe(SLICE_LOD.ultra.bradyzoiteBudget)
  })

  it('keep the worst case — a full garden at the tier’s budget — to a bounded triangle count', () => {
    const ceiling: Record<(typeof LOD_TIERS)[number], number> = { low: 0.4e6, medium: 0.8e6, high: 1.6e6, ultra: 3.4e6 }
    for (const tier of LOD_TIERS) {
      const c = SLICE_LOD[tier]
      const triangles =
        c.bradyzoiteBudget * crescentTriangles(c) + 2 * CYST_CAPACITY * sphereTriangles(c) + maxLatticeCells() * cellTriangles(c)
      expect(triangles).toBeLessThan(ceiling[tier])
    }
  })

  it('get strictly finer with the tier', () => {
    const detail = LOD_TIERS.map((t) => crescentTriangles(SLICE_LOD[t]))
    expect([...detail].sort((a, b) => a - b)).toEqual(detail)
  })
})
