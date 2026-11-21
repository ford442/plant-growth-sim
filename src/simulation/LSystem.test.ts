import { describe, expect, it } from 'vitest'
import {
  DEFAULT_LEAF,
  SPECIES_LSYSTEMS,
  generateLSystem,
  interpretLSystem,
  leafSpec,
  type LSystemDef,
} from './LSystem'

const plain: LSystemDef = {
  axiom: 'F',
  rules: {},
  angle: 30,
  length: 1,
  lengthDecay: 1,
  thickness: 0.1,
  thicknessDecay: 1,
  color: '#fff',
  branchRoll: 0,
}

const dirOf = (s: { start: number[]; end: number[] }) => {
  const d = [s.end[0] - s.start[0], s.end[1] - s.start[1], s.end[2] - s.start[2]]
  const l = Math.hypot(...d)
  return d.map((c) => c / l)
}
const dot = (a: number[], b: number[]) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]

describe('turtle', () => {
  it('starts straight up', () => {
    const { segments } = interpretLSystem('F', plain)
    expect(segments[0].end).toEqual([0, 1, 0])
  })

  it('turns by exactly the species angle, whatever the heading (yaw, pitch and roll are all rotations of one frame)', () => {
    const a = (30 * Math.PI) / 180
    for (const turn of ['+', '-', '&', '^']) {
      const { segments } = interpretLSystem(`F${turn}F`, plain)
      expect(dot(dirOf(segments[0]), dirOf(segments[1]))).toBeCloseTo(Math.cos(a), 6)
    }
    // …including turns applied after others, once the heading is far from vertical
    const { segments } = interpretLSystem('F+++F+F', plain) // 90°, then 30° more
    expect(dot(dirOf(segments[0]), dirOf(segments[1]))).toBeCloseTo(0, 6)
    expect(dot(dirOf(segments[1]), dirOf(segments[2]))).toBeCloseTo(Math.cos(a), 6)
  })

  it('yaw takes the turtle off the vertical (the old turtle started at the pole, where it did nothing)', () => {
    const { segments } = interpretLSystem('F+F', plain)
    expect(Math.hypot(segments[1].end[0] - segments[1].start[0], segments[1].end[2] - segments[1].start[2])).toBeGreaterThan(0.4)
  })

  it('roll turns the plane that yaw acts in, without moving the heading', () => {
    const flat = interpretLSystem('F+F', plain).segments
    const rolled = interpretLSystem('F\\+F', plain).segments // roll 30°, then yaw 30°
    expect(dirOf(rolled[0])).toEqual([0, 1, 0]) // rolling alone does not move the heading
    // the yaw still turns the heading by the same angle…
    expect(dot(dirOf(rolled[0]), dirOf(rolled[1]))).toBeCloseTo(Math.cos((30 * Math.PI) / 180), 6)
    // …but now carries it somewhere else around the stem
    const [fx, , fz] = dirOf(flat[1])
    const [rx, , rz] = dirOf(rolled[1])
    expect(Math.hypot(fx - rx, fz - rz)).toBeGreaterThan(0.1)
  })

  it('keeps the frame orthonormal over a long, tangled string (segment lengths stay exact)', () => {
    let str = ''
    for (let i = 0; i < 4000; i++) str += 'F+&\\-^/[F]'[(i * 7 + (i >> 3)) % 10]
    const { segments } = interpretLSystem(str, { ...plain, branchRoll: 137.5 })
    expect(segments.length).toBeGreaterThan(300)
    for (const s of segments) {
      expect(Math.hypot(s.end[0] - s.start[0], s.end[1] - s.start[1], s.end[2] - s.start[2])).toBeCloseTo(1, 6)
    }
  })

  it('branch roll fans a branch out of its parent plane; without it the plant stays flat', () => {
    const rules = { X: 'F[+X]F[-X]F' }
    const flat = interpretLSystem(generateLSystem('X', rules, 4), { ...plain, rules, branchRoll: 0 })
    expect(flat.segments.every((s) => s.start[2] === 0 && s.end[2] === 0)).toBe(true)
    const full = interpretLSystem(generateLSystem('X', rules, 4), { ...plain, rules, branchRoll: 137.5 })
    expect(full.segments.some((s) => Math.abs(s.end[2]) > 0.5)).toBe(true)
  })

  it('does not let a branch bend its parent: the frame is restored at `]`', () => {
    const { segments } = interpretLSystem('F[+&\\F]F', { ...plain, branchRoll: 137.5 })
    expect(dirOf(segments[2])).toEqual(dirOf(segments[0]))
    expect(segments[2].start).toEqual(segments[0].end)
  })
})

describe.each(Object.entries(SPECIES_LSYSTEMS))('%s', (_name, def) => {
  const { segments, leaves } = interpretLSystem(generateLSystem(def.axiom, def.rules, 4), def)

  it('grows sideways as well as up, in both horizontal directions (was a single vertical line)', () => {
    expect(segments.some((s) => Math.abs(s.end[0]) > 0.3)).toBe(true)
    expect(segments.some((s) => Math.abs(s.end[2]) > 0.3)).toBe(true)
  })

  it('has leaves with a unit heading, a positive size and a position on the plant', () => {
    expect(leaves.length).toBeGreaterThan(0)
    const points = new Set(segments.flatMap((s) => [s.start.join(), s.end.join()]))
    for (const l of leaves) {
      expect(Math.hypot(...l.direction)).toBeCloseTo(1, 6)
      expect(l.size).toBeGreaterThan(0)
      expect(points.has(l.position.join())).toBe(true) // attached to the twig, not floating
    }
  })

  it("scales its leaves by the species' leaf size", () => {
    const spec = leafSpec(def)
    const base = interpretLSystem(generateLSystem(def.axiom, def.rules, 3), { ...def, leaf: { ...def.leaf, size: 1 } })
    const scaled = interpretLSystem(generateLSystem(def.axiom, def.rules, 3), def)
    expect(scaled.leaves.length).toBe(base.leaves.length)
    scaled.leaves.forEach((l, i) => expect(l.size / base.leaves[i].size).toBeCloseTo(spec.size, 5))
  })
})

describe('leaf placement', () => {
  const def: LSystemDef = { ...plain, leaf: { spread: 50 } }

  it('opens the blade away from its twig by the species spread', () => {
    const { segments, leaves } = interpretLSystem('F[+F]', def)
    expect(leaves[0].src).toBe(4)
    const twig = dirOf(segments[1])
    expect(dot(twig, leaves[0].direction)).toBeCloseTo(Math.cos((50 * Math.PI) / 180), 6)
  })

  it('lets spread 0 lay the leaf along the twig', () => {
    const { segments, leaves } = interpretLSystem('F[+F]', { ...def, leaf: { spread: 0 } })
    expect(leaves[0].direction.map((c) => Math.abs(c))).toEqual(dirOf(segments[1]).map((c) => expect.closeTo(Math.abs(c), 6)))
  })

  it('sits on the end of the shoot it closes', () => {
    const { segments, leaves } = interpretLSystem('F[+F[-F]]', def)
    expect(leaves[0].position).toEqual(segments[2].end) // the inner shoot closes first
    expect(leaves[1].position).toEqual(segments[1].end)
  })

  it('is deterministic', () => {
    const str = generateLSystem(SPECIES_LSYSTEMS.oak.axiom, SPECIES_LSYSTEMS.oak.rules, 4)
    expect(interpretLSystem(str, SPECIES_LSYSTEMS.oak)).toEqual(interpretLSystem(str, SPECIES_LSYSTEMS.oak))
  })
})

describe('leafSpec', () => {
  it('fills missing fields from the default leaf and keeps the species ones', () => {
    expect(leafSpec(plain)).toEqual(DEFAULT_LEAF)
    expect(leafSpec({ ...plain, leaf: { shape: 'lobed', size: 2 } })).toEqual({ ...DEFAULT_LEAF, shape: 'lobed', size: 2 })
  })

  it('gives every species its own leaf (shape, size or aspect differ between species)', () => {
    const forms = Object.values(SPECIES_LSYSTEMS).map((d) => {
      const s = leafSpec(d)
      return `${s.shape}:${s.aspect}:${s.size}`
    })
    expect(new Set(forms).size).toBe(forms.length)
  })
})
