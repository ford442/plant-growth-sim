import { describe, expect, it } from 'vitest'
import { buildPolyhedron, familyPlanes, polyhedronVolume, symmetryOrbit, millerToNormal } from './CrystalHabit'
import { createCrystalState, specimenPolyhedron, stepCrystal, type CrystalState } from './CrystalGrowth'
import {
  blackbodyColor,
  chroma,
  easeHabit,
  gemAppearance,
  pleochroicTint,
  relaxFrost,
  type HabitPose,
} from './GemOptics'
import { GEMSTONE_PRESETS, type GemstoneId, type GeologyState } from './GemstonePresets'

const IDS = Object.keys(GEMSTONE_PRESETS) as GemstoneId[]

function grow(id: GemstoneId, env: Partial<GeologyState> = {}, days = 40, steps = 80): { s: CrystalState; env: GeologyState } {
  const e = { ...GEMSTONE_PRESETS[id].defaults, ...env }
  let s = createCrystalState(id, e)
  for (let i = 0; i < steps; i++) s = stepCrystal(s, id, e, days / steps)
  return { s, env: e }
}

const rgb = (hex: string) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16))

describe('crystal-system habits', () => {
  it('cubic m-3m: {100} alone is a cube, {111} alone an octahedron', () => {
    const d = GEMSTONE_PRESETS.diamond
    const cube = symmetryOrbit(millerToNormal('cubic', d.cell, [1, 0, 0]), 'm-3m')
    const octa = symmetryOrbit(millerToNormal('cubic', d.cell, [1, 1, 1]), 'm-3m')
    expect(cube).toHaveLength(6)
    expect(octa).toHaveLength(8)
    const p = buildPolyhedron(familyPlanes([{ miller: [1, 1, 1] }], 'cubic', 'm-3m', d.cell), [1])
    expect(p.faces.filter((f) => f.family === 0)).toHaveLength(8)
  })

  it('hexagonal 6/mmm: prism + pinacoid close a hexagonal prism (6 + 2 faces)', () => {
    const e = GEMSTONE_PRESETS.emerald
    const planes = familyPlanes([{ miller: [1, 0, 0] }, { miller: [0, 0, 1] }], 'hexagonal', '6/mmm', e.cell)
    const p = buildPolyhedron(planes, [1, 1.5])
    expect(p.faces.filter((f) => f.family === 0)).toHaveLength(6)
    expect(p.faces.filter((f) => f.family === 1)).toHaveLength(2)
    expect(p.faces.some((f) => f.family === -1)).toBe(false)
  })

  it('trigonal 32: rhombohedra {10-11} and {01-11} are 3+3 per end, not 6', () => {
    const q = GEMSTONE_PRESETS.quartz
    expect(symmetryOrbit(millerToNormal('trigonal', q.cell, [1, 0, 1]), '32')).toHaveLength(6)
    expect(symmetryOrbit(millerToNormal('trigonal', q.cell, [1, 0, 0]), '32')).toHaveLength(6)
  })

  it('orthorhombic mmm: {110} prism is 4 faces, {111} dipyramid 8', () => {
    const t = GEMSTONE_PRESETS.topaz
    expect(symmetryOrbit(millerToNormal('orthorhombic', t.cell, [1, 1, 0]), 'mmm')).toHaveLength(4)
    expect(symmetryOrbit(millerToNormal('orthorhombic', t.cell, [1, 1, 1]), 'mmm')).toHaveLength(8)
  })

  it('every preset grows a closed habit at its formation conditions', () => {
    for (const id of IDS) {
      const { s } = grow(id)
      const p = specimenPolyhedron(GEMSTONE_PRESETS[id], s.h)
      expect(p.faces.some((f) => f.family === -1), id).toBe(false)
      expect(polyhedronVolume(p), id).toBeGreaterThan(0)
    }
  })
})

describe('gemAppearance', () => {
  it('only cubic gems lack pleochroism', () => {
    for (const id of IDS) {
      const def = GEMSTONE_PRESETS[id]
      expect(def.look.pleochroism === null, id).toBe(def.system === 'cubic')
    }
  })

  it('gives each gem a distinct look', () => {
    const looks = IDS.map((id) => {
      const { s, env } = grow(id)
      const a = gemAppearance(GEMSTONE_PRESETS[id], s, env)
      return `${a.body}|${a.ior}|${a.dispersion.toFixed(3)}|${GEMSTONE_PRESETS[id].look.inclusions.kind}`
    })
    expect(new Set(looks).size).toBe(IDS.length)
    // and the inclusion scenes are all different
    expect(new Set(IDS.map((id) => GEMSTONE_PRESETS[id].look.inclusions.kind)).size).toBe(IDS.length)
  })

  it('pleochroism needs a chromophore: undoped ruby shows none, chromium ruby strong dichroism', () => {
    const def = GEMSTONE_PRESETS.ruby
    const pale = grow('ruby', { impurity: 0 })
    const deep = grow('ruby', { impurity: 0.9 })
    const a0 = gemAppearance(def, pale.s, pale.env)
    const a1 = gemAppearance(def, deep.s, deep.env)
    expect(chroma(a0.body)).toBeLessThan(0.15)
    const spread = (a: { alongC: string; acrossC: string }) =>
      rgb(a.alongC).reduce((d, c, i) => d + Math.abs(c - rgb(a.acrossC)[i]), 0)
    expect(spread(a1)).toBeGreaterThan(3 * spread(a0) + 10)
    // ω (down c) is the purplish one: more blue than the orange-red ε
    expect(rgb(a1.alongC)[2]).toBeGreaterThan(rgb(a1.acrossC)[2])
  })

  it('pleochroicTint shifts hue but leaves white alone', () => {
    expect(pleochroicTint('#ffffff', '#ff0000')).toBe('#ffffff')
    // a bluish-green tint on a green body: less red, so blue/red rises (hue moves toward the tint)
    const body = rgb('#40c060')
    const t = rgb(pleochroicTint('#40c060', '#22c3a8'))
    expect(t[2] / t[0]).toBeGreaterThan(body[2] / body[0])
  })

  it('deeper colour sooner with more dopant (Beer–Lambert distance shrinks)', () => {
    const def = GEMSTONE_PRESETS.emerald
    const lo = grow('emerald', { impurity: 0.1 })
    const hi = grow('emerald', { impurity: 0.9 })
    expect(gemAppearance(def, hi.s, hi.env).attenuationMm).toBeLessThan(gemAppearance(def, lo.s, lo.env).attenuationMm)
  })

  it('fluorescence follows the dopant: ruby glows red, quartz does not', () => {
    const r = grow('ruby')
    const rubyF = gemAppearance(GEMSTONE_PRESETS.ruby, r.s, r.env)
    const q = grow('quartz')
    expect(gemAppearance(GEMSTONE_PRESETS.quartz, q.s, q.env).fluorescence).toBe(0)
    expect(rubyF.fluorescence).toBeGreaterThan(0.5)
    const e = grow('emerald')
    expect(gemAppearance(GEMSTONE_PRESETS.emerald, e.s, e.env).fluorescence).toBeLessThan(rubyF.fluorescence)
    const r0 = grow('ruby', { impurity: 0 })
    expect(gemAppearance(GEMSTONE_PRESETS.ruby, r0.s, r0.env).fluorescence).toBeLessThan(0.05)
  })

  it('colour vs temperature: cool crystals do not glow, an HPHT diamond does, hot ruby greys toward green', () => {
    const q = grow('quartz')
    expect(gemAppearance(GEMSTONE_PRESETS.quartz, q.s, q.env).incandescence).toBe(0)
    const d = grow('diamond')
    expect(gemAppearance(GEMSTONE_PRESETS.diamond, d.s, d.env).incandescence).toBeGreaterThan(0.1)

    const r = grow('ruby')
    const cool = gemAppearance(GEMSTONE_PRESETS.ruby, r.s, { ...r.env, temperature: 450 })
    const hot = gemAppearance(GEMSTONE_PRESETS.ruby, r.s, { ...r.env, temperature: 1100 })
    const greenShare = (c: string) => rgb(c)[1] / (rgb(c)[0] + 1)
    expect(greenShare(hot.body)).toBeGreaterThan(greenShare(cool.body))
  })

  it('blackbody: hotter is whiter (more green relative to red), red-dominated below 2000 °C', () => {
    const ratio = (c: string) => rgb(c)[1] / rgb(c)[0]
    expect(ratio(blackbodyColor(1500))).toBeGreaterThan(ratio(blackbodyColor(900)))
    expect(rgb(blackbodyColor(900))[0]).toBe(255)
  })

  it('fast growth traps inclusions: high supersaturation gives a more included crystal', () => {
    const def = GEMSTONE_PRESETS.quartz
    const slow = grow('quartz', { saturation: 1.1 }, 200)
    const fast = grow('quartz', { saturation: 2.2 }, 40)
    expect(gemAppearance(def, fast.s, fast.env).inclusions).toBeGreaterThan(gemAppearance(def, slow.s, slow.env).inclusions)
  })

  it('dissolution frosts the surface; growth does not', () => {
    const def = GEMSTONE_PRESETS.quartz
    const g = grow('quartz')
    expect(gemAppearance(def, g.s, g.env).frostTarget).toBe(0)
    const etchEnv = { ...g.env, saturation: 0.6 }
    const etched = stepCrystal(g.s, 'quartz', etchEnv, 0.5)
    expect(gemAppearance(def, etched, etchEnv).frostTarget).toBeGreaterThan(0.5)
  })

  it('is pure', () => {
    const { s, env } = grow('amethyst')
    const frozen = JSON.stringify(s)
    gemAppearance(GEMSTONE_PRESETS.amethyst, s, env)
    expect(JSON.stringify(s)).toBe(frozen)
  })
})

describe('smooth growth between ticks', () => {
  const target = (h: number[], radius: number, age: number): HabitPose => ({ h, radius, age })

  it('snaps on the first frame and on a reseed', () => {
    const a = easeHabit(null, target([1, 2], 1, 5), 0.016)
    expect(a.h).toEqual([1, 2])
    const reseed = easeHabit(a, target([0.3, 0.4], 0.35, 0), 0.016)
    expect(reseed.h).toEqual([0.3, 0.4])
    expect(reseed.radius).toBe(0.35)
  })

  it('converges and is frame-rate independent', () => {
    const from = target([1, 1], 1, 0)
    const to = target([2, 3], 2, 1)
    const once = easeHabit(from, to, 0.1)
    const twice = easeHabit(easeHabit(from, to, 0.05), to, 0.05)
    once.h.forEach((x, i) => expect(twice.h[i]).toBeCloseTo(x, 10))
    let p = from
    for (let i = 0; i < 200; i++) p = easeHabit(p, to, 0.016)
    expect(p.h[1]).toBeCloseTo(3, 6)
  })

  it('every in-between pose is a real polyhedron (α-quartz prism → β-quartz bipyramid)', () => {
    const def = GEMSTONE_PRESETS.quartz
    const alpha = grow('quartz', { temperature: 400 }).s
    const beta = grow('quartz', { temperature: 700, pressure: 1 }).s
    let p: HabitPose = { h: alpha.h, radius: alpha.nuclei[0].radius, age: 0 }
    const to: HabitPose = { h: beta.h, radius: beta.nuclei[0].radius, age: 1 }
    for (let i = 0; i < 20; i++) {
      p = easeHabit(p, to, 0.03)
      const poly = specimenPolyhedron(def, p.h)
      expect(polyhedronVolume(poly)).toBeGreaterThan(0)
      expect(poly.faces.some((f) => f.family === -1)).toBe(false)
    }
  })

  it('frost: comes on fast, heals slowly, holds while paused', () => {
    const on = relaxFrost(0, 1, 1)
    const off = 1 - relaxFrost(1, 0, 1)
    expect(on).toBeGreaterThan(off)
    expect(relaxFrost(0.4, 0, 0)).toBe(0.4)
  })
})
