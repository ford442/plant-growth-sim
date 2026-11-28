import { describe, expect, it } from 'vitest'
import {
  SPECIES_LSYSTEMS,
  architectureCap,
  generateLSystem,
  interpretLSystem,
  type LSystemDef,
} from './LSystem'
import {
  DAYS_PER_ITERATION,
  LEAF_STRIDE,
  MAX_ITERATIONS,
  MIN_ITERATIONS,
  advanceDevelopment,
  createMorphBuilder,
  morphFactor,
  rewriteWithParents,
  sampleLeaves,
  sampleSegments,
  sampleThickness,
  stageOf,
} from './LSystemMorph'

/**
 * The shipped presets only use `+`/`-` (yaw) and get their 3D spread from the turtle's
 * branch roll. The morph must not depend on that, so the same suite also runs on rule
 * sets that tilt with `&`/`^` (pitch) and fan out with `+`/`-` — side branches, nested
 * brackets and an `F → F[…]F` rule with no buds.
 */
const BRANCHING: Record<string, LSystemDef> = {
  'tilted sunflower': {
    ...SPECIES_LSYSTEMS.sunflower,
    rules: { X: 'F[&X]F[^X]&X', F: 'FF' },
  },
  'fanned oak': {
    ...SPECIES_LSYSTEMS.oak,
    rules: { A: 'F[+&A][-&A]F^A', F: 'FF' },
  },
  'tilted rose': {
    ...SPECIES_LSYSTEMS.rose,
    rules: { X: 'F-[[&X]+^X]+F[+&FX]-^X', F: 'FF' },
  },
  'tilted bamboo': {
    ...SPECIES_LSYSTEMS.bamboo,
    rules: { F: 'F[&F]F[+^F]F' },
  },
}
const SPECIES = [...Object.entries(SPECIES_LSYSTEMS), ...Object.entries(BRANCHING)]
const EPS = 1e-4

const segLength = (a: ArrayLike<number>, i: number) =>
  Math.hypot(a[i + 3] - a[i], a[i + 4] - a[i + 1], a[i + 5] - a[i + 2])

function totalLength(a: Float32Array) {
  let sum = 0
  for (let i = 0; i < a.length; i += 6) sum += segLength(a, i)
  return sum
}

function distToSegment(p: number[], a: number[], b: number[]) {
  const ab = [b[0] - a[0], b[1] - a[1], b[2] - a[2]]
  const ap = [p[0] - a[0], p[1] - a[1], p[2] - a[2]]
  const len2 = ab[0] ** 2 + ab[1] ** 2 + ab[2] ** 2
  const u = len2 === 0 ? 0 : Math.min(1, Math.max(0, (ap[0] * ab[0] + ap[1] * ab[1] + ap[2] * ab[2]) / len2))
  return Math.hypot(ap[0] - ab[0] * u, ap[1] - ab[1] * u, ap[2] - ab[2] * u)
}

/**
 * Topology of a generation, from the string alone: the vertex id at each end of
 * every segment. Two segments share a vertex only if the turtle really passed
 * through it (consecutive Fs, or a branch opening where its parent ends) — never
 * because two unrelated twigs happen to cross, which the symmetric species do a lot.
 */
function vertexIds(str: string): [number, number][] {
  const ids: [number, number][] = []
  const stack: number[] = []
  let next = 1
  let cur = 0
  for (const ch of str) {
    if (ch === 'F' || ch === 'G') {
      ids.push([cur, next])
      cur = next++
    } else if (ch === '[') stack.push(cur)
    else if (ch === ']') cur = stack.pop() ?? cur
  }
  return ids
}

describe('interpretLSystem (determinism the morph relies on)', () => {
  it('gives identical geometry every time (no Math.random)', () => {
    for (const [, def] of SPECIES) {
      const str = generateLSystem(def.axiom, def.rules, 4)
      expect(interpretLSystem(str, def)).toEqual(interpretLSystem(str, def))
    }
  })

  it('records which symbol produced each segment and leaf', () => {
    for (const [, def] of SPECIES) {
      const str = generateLSystem(def.axiom, def.rules, 3)
      const { segments, leaves, charPos } = interpretLSystem(str, def)
      expect(charPos.length).toBe(str.length * 3)
      for (const s of segments) expect('FG'.includes(str[s.src])).toBe(true)
      for (const l of leaves) expect(l.src === -1 || str[l.src] === ']').toBe(true)
      // a segment starts where the turtle was when its symbol ran
      for (const s of segments.slice(0, 20)) {
        expect(charPos[s.src * 3]).toBeCloseTo(s.start[0], 5)
        expect(charPos[s.src * 3 + 1]).toBeCloseTo(s.start[1], 5)
      }
    }
  })
})

describe('rewriteWithParents', () => {
  it('agrees with generateLSystem and maps every symbol to its producer', () => {
    for (const [, def] of SPECIES) {
      const a = generateLSystem(def.axiom, def.rules, 3)
      const { next, parent } = rewriteWithParents(a, def.rules)
      expect(next).toBe(generateLSystem(def.axiom, def.rules, 4))
      expect(parent.length).toBe(next.length)
      for (let j = 0; j < next.length; j++) {
        const rep = def.rules[a[parent[j]]] ?? a[parent[j]]
        expect(rep).toContain(next[j])
        if (j > 0) expect(parent[j]).toBeGreaterThanOrEqual(parent[j - 1])
      }
    }
  })
})

describe('development stage helpers', () => {
  it('advances by days × rate per iteration and stops at the last iteration', () => {
    expect(advanceDevelopment(2, DAYS_PER_ITERATION, 1)).toBeCloseTo(3, 10)
    expect(advanceDevelopment(2, DAYS_PER_ITERATION, 0.5)).toBeCloseTo(2.5, 10)
    expect(advanceDevelopment(2, 10, 0)).toBe(2)
    expect(advanceDevelopment(6.9, 100, 1)).toBe(MAX_ITERATIONS)
  })

  it('splits progress into a whole stage and a clamped factor', () => {
    expect(stageOf(3.75)).toBe(3)
    expect(stageOf(99)).toBe(MAX_ITERATIONS)
    expect(morphFactor(3.75, 3)).toBeCloseTo(0.75, 10)
    // a viewer still on the previous stage keeps showing the end of its morph…
    expect(morphFactor(4.02, 3)).toBe(1)
    // …and one that is ahead of the store shows the start
    expect(morphFactor(3.1, 4)).toBe(0)
    expect(morphFactor(MAX_ITERATIONS, MAX_ITERATIONS)).toBe(0)
  })
})

describe('LSystemMorph', () => {
  it('the branching test rule sets really leave the trunk axis (so the checks below are geometric)', () => {
    for (const def of Object.values(BRANCHING)) {
      const { segments } = interpretLSystem(generateLSystem(def.axiom, def.rules, 4), def)
      expect(segments.some((s) => Math.hypot(s.end[0], s.end[2]) > 0.5)).toBe(true)
    }
  })

  describe.each(SPECIES)('%s', (_name, def) => {
    const builder = createMorphBuilder(def)

    it('starts as exactly generation n and ends as exactly generation n + 1', () => {
      // every morph up to the species' budget cap; the synthetic ones stop by 5 → 6 to keep the suite quick
      const cap = architectureCap(def, MAX_ITERATIONS)
      const last = Math.min(cap, Object.values(BRANCHING).includes(def) ? 6 : cap) - 1
      for (let n = MIN_ITERATIONS; n <= last; n++) {
        const m = builder.morph(n)
        expect(m.isStatic).toBe(false)
        const a = interpretLSystem(generateLSystem(def.axiom, def.rules, n), def)
        const b = interpretLSystem(generateLSystem(def.axiom, def.rules, n + 1), def)

        // t = 1: identical to the next generation
        expect(m.segmentCount).toBe(b.segments.length)
        expect(m.leafCount).toBe(b.leaves.length)
        const end = new Float32Array(m.segmentsTo.length)
        sampleSegments(m, 1, end)
        // exact: at t = 1 the pose *is* the next generation (set() rounds to float32, as the morph does)
        const expected = new Float32Array(b.segments.length * 6)
        b.segments.forEach((s, i) => {
          expected.set(s.start, i * 6)
          expected.set(s.end, i * 6 + 3)
        })
        expect(end).toEqual(expected)

        // t = 0: the old plant, no more and no less. Children tile their parents…
        const start = new Float32Array(m.segmentsTo.length)
        sampleSegments(m, 0, start)
        const oldLength = a.segments.reduce(
          (sum, s) => sum + Math.hypot(s.end[0] - s.start[0], s.end[1] - s.start[1], s.end[2] - s.start[2]),
          0
        )
        expect(Math.abs(totalLength(start) - oldLength) / oldLength).toBeLessThan(1e-6)

        // …every old leaf is still where it was, and nothing else is visible yet
        const leaves = new Float32Array(m.leafCount * LEAF_STRIDE)
        sampleLeaves(m, 0, leaves)
        const seen: string[] = []
        for (let j = 0; j < m.leafCount; j++) {
          const o = j * LEAF_STRIDE
          if (m.leafIsNew[j]) expect(leaves[o + 6]).toBe(0)
          else seen.push([leaves[o], leaves[o + 1], leaves[o + 2], leaves[o + 6]].map((v) => v.toFixed(3)).join(','))
        }
        // (the morph stores float32, so compare against the float32-rounded originals)
        const old = a.leaves.map((l) =>
          [...l.position, l.size].map((v) => Math.fround(v).toFixed(3)).join(',')
        )
        expect(seen.sort()).toEqual(old.sort())
      }
    }, 30_000)

    it('covers the old geometry at t = 0 (small generations, exhaustive check)', () => {
      const n = 3
      const m = builder.morph(n)
      const old = interpretLSystem(generateLSystem(def.axiom, def.rules, n), def).segments
      const start = new Float32Array(m.segmentsTo.length)
      sampleSegments(m, 0, start)
      for (let i = 0; i < start.length; i += 6) {
        if (segLength(start, i) < EPS) continue
        for (const p of [
          [start[i], start[i + 1], start[i + 2]],
          [start[i + 3], start[i + 4], start[i + 5]],
        ]) {
          expect(Math.min(...old.map((s) => distToSegment(p, s.start, s.end)))).toBeLessThan(EPS)
        }
      }
    })

    it('grows new branches out of the existing plant, collapsed at t = 0', () => {
      for (const n of [2, 3]) {
        const m = builder.morph(n)
        const old = interpretLSystem(generateLSystem(def.axiom, def.rules, n), def).segments
        let sprouts = 0
        for (let i = 0; i < m.segmentsFrom.length; i += 6) {
          if (segLength(m.segmentsFrom, i) >= EPS) continue
          sprouts++
          const f = m.segmentsFrom
          // a collapsed segment sits on a bud (a segment end, or the root) or on the stem it peels off
          const p = [f[i], f[i + 1], f[i + 2]]
          const onPlant =
            Math.hypot(...p) < EPS || old.some((s) => distToSegment(p, s.start, s.end) < EPS)
          expect(onPlant).toBe(true)
        }
        expect(sprouts).toBeGreaterThan(0)
      }
    })

    it('never tears: segments that share a vertex keep sharing it at every t', () => {
      for (const n of [3, 4]) {
        const m = builder.morph(n)
        const topo = vertexIds(generateLSystem(def.axiom, def.rules, n + 1))
        expect(topo.length).toBe(m.segmentCount)
        for (const t of [0, 0.13, 0.5, 0.87, 1]) {
          const pose = new Float32Array(m.segmentsTo.length)
          sampleSegments(m, t, pose)
          const at = new Map<number, number[]>()
          topo.forEach(([a, b], seg) => {
            for (const [id, o] of [[a, seg * 6], [b, seg * 6 + 3]] as const) {
              const p = [pose[o], pose[o + 1], pose[o + 2]]
              const q = at.get(id)
              if (!q) at.set(id, p)
              else for (let c = 0; c < 3; c++) expect(Math.abs(q[c] - p[c])).toBeLessThan(EPS)
            }
          })
        }
      }
    })

    it('never shrinks the plant: total branch length grows monotonically with t', () => {
      const m = builder.morph(4)
      const pose = new Float32Array(m.segmentsTo.length)
      let prev = -1
      for (let t = 0; t <= 1.0001; t += 0.125) {
        sampleSegments(m, t, pose)
        const len = totalLength(pose)
        expect(len).toBeGreaterThanOrEqual(prev - 1e-3)
        prev = len
      }
    })

    it('fades new leaves in late and never shrinks an old leaf out of existence', () => {
      const m = builder.morph(4)
      const at = (t: number) => {
        const out = new Float32Array(m.leafCount * LEAF_STRIDE)
        sampleLeaves(m, t, out)
        return out
      }
      const early = at(0.3)
      const mid = at(0.75)
      const end = at(1)
      let newLeaves = 0
      for (let j = 0; j < m.leafCount; j++) {
        const s = j * LEAF_STRIDE + 6
        // unit direction at every t
        const d = j * LEAF_STRIDE + 3
        expect(Math.hypot(mid[d], mid[d + 1], mid[d + 2])).toBeCloseTo(1, 4)
        if (m.leafIsNew[j]) {
          newLeaves++
          expect(early[s]).toBe(0) // not before the twig has grown
          expect(mid[s]).toBeGreaterThan(0)
          expect(mid[s]).toBeLessThan(end[s])
          expect(end[s]).toBeCloseTo(m.leavesTo[s], 6)
        } else {
          expect(early[s]).toBeGreaterThan(0.05)
        }
      }
      expect(newLeaves).toBeGreaterThan(0)
    })
  })

  describe('thickness', () => {
    for (const [name, def] of SPECIES) {
      it(`${name}: t = 1 is the interpreter's thickness for every segment of the next generation`, () => {
        const m = createMorphBuilder(def).morph(3)
        const ref = interpretLSystem(generateLSystem(def.axiom, def.rules, 4), def)
        const out = new Float32Array(m.segmentCount)
        sampleThickness(m, 1, out)
        expect(out).toHaveLength(ref.segments.length)
        ref.segments.forEach((s, i) => expect(out[i]).toBeCloseTo(s.thickness, 6))
      })

      it(`${name}: segments that tile an existing one keep its thickness; new twigs start at 0`, () => {
        const m = createMorphBuilder(def).morph(3)
        let kept = 0
        let sprouting = 0
        for (let j = 0; j < m.segmentCount; j++) {
          const collapsed = segLength(m.segmentsFrom, j * 6) < EPS
          if (collapsed) {
            expect(m.thicknessFrom[j]).toBe(0)
            sprouting++
          } else {
            // a trunk link: identical width before and after, so nothing visibly changes at t = 0
            expect(m.thicknessFrom[j]).toBeCloseTo(m.thicknessTo[j], 6)
            kept++
          }
        }
        expect(kept).toBeGreaterThan(0)
        expect(sprouting).toBeGreaterThan(0)
      })
    }

    it('is a straight blend between the two ends and static at the final iteration', () => {
      const m = createMorphBuilder(SPECIES_LSYSTEMS.oak).morph(3)
      const mid = new Float32Array(m.segmentCount)
      sampleThickness(m, 0.5, mid)
      for (let j = 0; j < m.segmentCount; j++) {
        expect(mid[j]).toBeCloseTo((m.thicknessFrom[j] + m.thicknessTo[j]) / 2, 6)
      }
      const last = createMorphBuilder(SPECIES_LSYSTEMS.oak).morph(MAX_ITERATIONS)
      const a = new Float32Array(last.segmentCount)
      const b = new Float32Array(last.segmentCount)
      sampleThickness(last, 0, a)
      sampleThickness(last, 0.7, b)
      expect(a).toEqual(b)
    })
  })

  it('is static at the final iteration', () => {
    const builder = createMorphBuilder(SPECIES_LSYSTEMS.oak)
    const m = builder.morph(MAX_ITERATIONS)
    expect(m.isStatic).toBe(true)
    const a = new Float32Array(m.segmentsTo.length)
    const b = new Float32Array(m.segmentsTo.length)
    sampleSegments(m, 0, a)
    sampleSegments(m, 0.6, b)
    expect(a).toEqual(b)
    const ref = interpretLSystem(
      generateLSystem(SPECIES_LSYSTEMS.oak.axiom, SPECIES_LSYSTEMS.oak.rules, MAX_ITERATIONS),
      SPECIES_LSYSTEMS.oak
    )
    expect(m.segmentCount).toBe(ref.segments.length)
    // a request past the end is clamped, not an error
    expect(builder.morph(MAX_ITERATIONS + 3).isStatic).toBe(true)
  })

  it('builds the same morph whether or not the generation cache is warm', () => {
    const def = SPECIES_LSYSTEMS.rose
    const warm = createMorphBuilder(def)
    warm.morph(2)
    warm.morph(3)
    const cold = createMorphBuilder(def)
    const a = warm.morph(4)
    const b = cold.morph(4)
    expect(a.segmentsFrom).toEqual(b.segmentsFrom)
    expect(a.segmentsTo).toEqual(b.segmentsTo)
    expect(a.leavesFrom).toEqual(b.leavesFrom)
    // and going backwards is fine too
    expect(warm.morph(2).segmentCount).toBe(createMorphBuilder(def).morph(2).segmentCount)
  })

  it('is pure: frozen species definitions are never mutated', () => {
    const def: LSystemDef = structuredClone(SPECIES_LSYSTEMS.fern)
    Object.freeze(def.rules)
    Object.freeze(def)
    const builder = createMorphBuilder(def)
    const m = builder.morph(3)
    sampleSegments(m, 0.5, new Float32Array(m.segmentsTo.length))
    sampleLeaves(m, 0.5, new Float32Array(m.leafCount * LEAF_STRIDE))
    expect(def).toEqual(SPECIES_LSYSTEMS.fern)
  })
})
