/**
 * Smooth growth between discrete L-system generations (pure — no Three.js).
 *
 * An L-system only exists at whole iterations: generation n is a string, and
 * generation n + 1 is a *different* string whose turtle path is not a small
 * perturbation of the first (`F → FF` doubles every internal, side branches
 * slide up the stem, new buds open). Rendering `floor(progress)` therefore
 * jumps. This module instead tracks **lineage** through the rewrite, so every
 * vertex of generation n + 1 knows where its ancestor sat in generation n, and
 * the plant can be drawn at any point `t ∈ [0, 1]` of the way between them:
 *
 *  - a segment descended from an `F` and lying on its trunk (outside any
 *    bracket of the replacement, e.g. both Fs of `F → FF`) takes a slot of that
 *    parent. At t = 0 the `m` trunk children tile the parent exactly (nothing
 *    visibly moves at the start of a morph), and they stretch out to their
 *    real size as t → 1;
 *  - a side branch in an `F` replacement (`F → F[+F]F`) starts collapsed at the
 *    point of the parent where its bracket opens, so it peels off the stem;
 *  - a segment descended from a bud (`X`, `A`, …) is *grown from its parent*: it
 *    starts collapsed to a point at the bud and expands uniformly from there,
 *    so a new branch always stays attached to the twig it sprouts from;
 *  - a leaf whose `]` already existed rides its tip from the old place to the
 *    new one; a leaf with no ancestor fades in once its twig has mostly grown.
 *
 * Because every endpoint is the straight-line blend of two well-defined
 * positions, vertices shared between segments stay shared at every t (the
 * plant never tears), and t = 0 / t = 1 reproduce generations n / n + 1
 * exactly, so crossing a generation boundary is continuous.
 *
 * `LSystem.ts` stays the single turtle implementation; this module only
 * post-processes its output. The viewer samples a morph each frame — the
 * simulation itself never sees the interpolation factor.
 */
import {
  generateLSystem,
  interpretLSystem,
  type LSystemDef,
  type LSystemRule,
} from './LSystem'

/** Iterations of a freshly sown plant, and the most the model develops. */
export const MIN_ITERATIONS = 2
export const MAX_ITERATIONS = 7
/** Days of ideal growing weather (rate 1) it takes to add one iteration. */
export const DAYS_PER_ITERATION = 3

/**
 * Advance the continuous development stage. `rate` is the weather-driven
 * relative growth rate (0–1, the same factor that scales biomass and height),
 * so architecture develops in lockstep with growth: it slows with the weather,
 * stops when growth stops, and follows pause / speed through `days`.
 */
export function advanceDevelopment(progress: number, days: number, rate: number): number {
  return Math.min(MAX_ITERATIONS, progress + (days * rate) / DAYS_PER_ITERATION)
}

/** Whole iteration shown at the start of the morph that `progress` is in. */
export function stageOf(progress: number): number {
  return Math.min(MAX_ITERATIONS, Math.max(0, Math.floor(progress)))
}

/**
 * Interpolation factor for a morph that starts at `stage`. Clamped rather than
 * wrapped, so a viewer still holding last frame's stage keeps showing the end
 * of its morph (t = 1) until it catches up, instead of snapping backwards.
 */
export function morphFactor(progress: number, stage: number): number {
  return Math.min(1, Math.max(0, progress - stage))
}

/** Floats per leaf in `LSystemMorph.leavesFrom/To` and `sampleLeaves`: position, unit direction, size. */
export const LEAF_STRIDE = 7

/** A new leaf stays hidden until its twig is this far along, then scales in. */
const NEW_LEAF_DELAY = 0.5

export interface LSystemMorph {
  /** Generation shown at t = 0. t = 1 shows `iterations + 1`, or the same one when `isStatic`. */
  iterations: number
  /** True at the final iteration: nothing left to grow, `from` and `to` are the same arrays. */
  isStatic: boolean
  segmentCount: number
  /** Start and end (x, y, z, x, y, z) of each segment at t = 0 and t = 1. */
  segmentsFrom: Float32Array
  segmentsTo: Float32Array
  leafCount: number
  /** position (3), unit direction (3), size per leaf at t = 0 and t = 1. */
  leavesFrom: Float32Array
  leavesTo: Float32Array
  /** 1 for leaves with no ancestor in the previous generation (they fade in). */
  leafIsNew: Uint8Array
}

/** Compact, typed-array form of one interpreted generation (the object form is garbage-collected after packing). */
interface Generation {
  str: string
  segPos: Float32Array
  segSrc: Int32Array
  leafData: Float32Array
  leafSrc: Int32Array
  charPos: Float32Array
  /** symbol index → segment index, or -1 */
  segAt: Int32Array
  /** symbol index → leaf index, or -1 */
  leafAt: Int32Array
}

const isDraw = (ch: string) => ch === 'F' || ch === 'G'

function buildGeneration(str: string, def: LSystemDef): Generation {
  const { segments, leaves, charPos } = interpretLSystem(str, def)

  const segPos = new Float32Array(segments.length * 6)
  const segSrc = new Int32Array(segments.length)
  const segAt = new Int32Array(str.length).fill(-1)
  segments.forEach((s, i) => {
    segPos.set(s.start, i * 6)
    segPos.set(s.end, i * 6 + 3)
    segSrc[i] = s.src
    segAt[s.src] = i
  })

  const leafData = new Float32Array(leaves.length * LEAF_STRIDE)
  const leafSrc = new Int32Array(leaves.length)
  const leafAt = new Int32Array(str.length).fill(-1)
  leaves.forEach((l, i) => {
    leafData.set(l.position, i * LEAF_STRIDE)
    leafData.set(l.direction, i * LEAF_STRIDE + 3)
    leafData[i * LEAF_STRIDE + 6] = l.size
    leafSrc[i] = l.src
    if (l.src >= 0) leafAt[l.src] = i
  })

  return { str, segPos, segSrc, leafData, leafSrc, charPos, segAt, leafAt }
}

/**
 * One parallel rewrite step that also records lineage: `parent[j]` is the index
 * in `str` of the symbol that produced symbol `j` of `next`.
 */
export function rewriteWithParents(
  str: string,
  rules: LSystemRule
): { next: string; parent: Int32Array } {
  const parts: string[] = new Array(str.length)
  let total = 0
  for (let i = 0; i < str.length; i++) {
    const r = rules[str[i]] ?? str[i]
    parts[i] = r
    total += r.length
  }
  const parent = new Int32Array(total)
  let j = 0
  for (let i = 0; i < parts.length; i++) {
    for (let k = parts[i].length; k > 0; k--) parent[j++] = i
  }
  return { next: parts.join(''), parent }
}

/**
 * Where each drawing symbol and `]` of a symbol's replacement hangs on the
 * parent. `trunk` counts the depth-0 drawing symbols; each of those is chain
 * link `at` of `trunk`. Anything inside brackets is a side branch attached
 * after `at` trunk links, as is every leaf (`at` = links before its outermost `[`).
 */
interface ReplacementPlan {
  trunk: number
  draws: { onTrunk: boolean; at: number }[]
  leaves: number[]
}

function planReplacement(rep: string): ReplacementPlan {
  const draws: ReplacementPlan['draws'] = []
  const leaves: number[] = []
  let trunk = 0
  let depth = 0
  let attach = 0
  for (const ch of rep) {
    if (ch === '[') {
      if (depth === 0) attach = trunk
      depth++
    } else if (ch === ']') {
      if (depth > 0) depth--
      leaves.push(attach)
    } else if (isDraw(ch)) {
      if (depth === 0) draws.push({ onTrunk: true, at: trunk++ })
      else draws.push({ onTrunk: false, at: attach })
    }
  }
  return { trunk, draws, leaves }
}

/** Morph between two interpreted generations a (n) and b (n + 1 = rewrite(a)). */
function morphBetween(
  iterations: number,
  a: Generation,
  b: Generation,
  parent: Int32Array,
  rules: LSystemRule
): LSystemMorph {
  const plans = new Map<string, ReplacementPlan>()
  const planFor = (ch: string) => {
    let plan = plans.get(ch)
    if (!plan) {
      plan = planReplacement(rules[ch] ?? ch)
      plans.set(ch, plan)
    }
    return plan
  }

  // --- segments -----------------------------------------------------------
  const segCount = b.segSrc.length
  const segFrom = new Float32Array(segCount * 6)
  let lastParent = -1
  let slot = 0
  for (let j = 0; j < segCount; j++) {
    const i = parent[b.segSrc[j]]
    // children of one parent are consecutive, in order: slot = rank among them
    if (i === lastParent) slot++
    else {
      lastParent = i
      slot = 0
    }
    const pj = a.segAt[i]
    const o = j * 6
    if (pj >= 0) {
      const plan = planFor(a.str[i])
      const link = plan.draws[slot]
      const p = pj * 6
      // trunk links tile the parent; side branches collapse onto their attachment point
      const m = Math.max(1, plan.trunk)
      const t0 = link.at / m
      const t1 = link.onTrunk ? (link.at + 1) / m : t0
      for (let c = 0; c < 3; c++) {
        const s = a.segPos[p + c]
        const d = a.segPos[p + 3 + c] - s
        segFrom[o + c] = s + d * t0
        segFrom[o + 3 + c] = s + d * t1
      }
    } else {
      // grown from a bud: collapsed onto the bud's position
      for (let c = 0; c < 3; c++) {
        const v = a.charPos[i * 3 + c]
        segFrom[o + c] = v
        segFrom[o + 3 + c] = v
      }
    }
  }

  // --- leaves -------------------------------------------------------------
  const leafCount = b.leafSrc.length
  const leavesFrom = new Float32Array(leafCount * LEAF_STRIDE)
  const leafIsNew = new Uint8Array(leafCount)
  const aTip = a.leafSrc.length > 0 && a.leafSrc[a.leafSrc.length - 1] === -1 ? a.leafSrc.length - 1 : -1
  lastParent = -1
  let leafSlot = 0
  for (let j = 0; j < leafCount; j++) {
    const src = b.leafSrc[j]
    const i = src >= 0 ? parent[src] : -1
    if (i === lastParent) leafSlot++
    else {
      lastParent = i
      leafSlot = 0
    }
    const pl = src >= 0 ? a.leafAt[i] : aTip
    const o = j * LEAF_STRIDE
    if (pl >= 0) {
      for (let c = 0; c < LEAF_STRIDE; c++) leavesFrom[o + c] = a.leafData[pl * LEAF_STRIDE + c]
    } else {
      // no ancestor: sprout where its twig does (the bud, or the point of the
      // parent segment the bracket opened at), same heading, zero size
      const pj = i >= 0 ? a.segAt[i] : -1
      if (pj >= 0) {
        const plan = planFor(a.str[i])
        const t = (plan.leaves[leafSlot] ?? 0) / Math.max(1, plan.trunk)
        for (let c = 0; c < 3; c++) {
          const s = a.segPos[pj * 6 + c]
          leavesFrom[o + c] = s + (a.segPos[pj * 6 + 3 + c] - s) * t
        }
      } else {
        for (let c = 0; c < 3; c++) leavesFrom[o + c] = i >= 0 ? a.charPos[i * 3 + c] : 0
      }
      for (let c = 3; c < 6; c++) leavesFrom[o + c] = b.leafData[o + c]
      leavesFrom[o + 6] = 0
      leafIsNew[j] = 1
    }
  }

  return {
    iterations,
    isStatic: false,
    segmentCount: segCount,
    segmentsFrom: segFrom,
    segmentsTo: b.segPos,
    leafCount,
    leavesFrom,
    leavesTo: b.leafData,
    leafIsNew,
  }
}

function staticMorph(iterations: number, g: Generation): LSystemMorph {
  return {
    iterations,
    isStatic: true,
    segmentCount: g.segSrc.length,
    segmentsFrom: g.segPos,
    segmentsTo: g.segPos,
    leafCount: g.leafSrc.length,
    leavesFrom: g.leafData,
    leavesTo: g.leafData,
    leafIsNew: new Uint8Array(g.leafSrc.length),
  }
}

export interface MorphBuilder {
  /** The morph from `iterations` to `iterations + 1` (a static pose at MAX_ITERATIONS). */
  morph(iterations: number): LSystemMorph
}

/**
 * Builds morphs for one species. Generations are cached in compact form, so
 * advancing from morph n to n + 1 only has to interpret one new generation.
 */
export function createMorphBuilder(def: LSystemDef): MorphBuilder {
  const gens = new Map<number, Generation>()

  const generation = (n: number, str?: string) => {
    let g = gens.get(n)
    if (!g) {
      g = buildGeneration(str ?? generateLSystem(def.axiom, def.rules, n), def)
      gens.set(n, g)
    }
    return g
  }

  return {
    morph(iterations) {
      const n = Math.max(0, Math.min(MAX_ITERATIONS, Math.floor(iterations)))
      const a = generation(n)
      let result: LSystemMorph
      if (n >= MAX_ITERATIONS) {
        result = staticMorph(n, a)
      } else {
        const { next, parent } = rewriteWithParents(a.str, def.rules)
        result = morphBetween(n, a, generation(n + 1, next), parent, def.rules)
      }
      // the next morph needs n + 1 and (freshly) n + 2; nothing older
      for (const k of [...gens.keys()]) if (k < n || k > n + 1) gens.delete(k)
      return result
    },
  }
}

const smoothstep = (e0: number, e1: number, x: number) => {
  const u = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)))
  return u * u * (3 - 2 * u)
}

/** Write the branch pose at `t` into `out` (same layout as `segmentsTo`). */
export function sampleSegments(m: LSystemMorph, t: number, out: Float32Array): void {
  const a = m.segmentsFrom
  const b = m.segmentsTo
  if (m.isStatic) {
    out.set(b)
    return
  }
  const k = Math.min(1, Math.max(0, t))
  for (let i = 0; i < b.length; i++) out[i] = a[i] + (b[i] - a[i]) * k
}

/**
 * Write the leaf pose at `t` into `out` (`LEAF_STRIDE` floats per leaf).
 * Direction is blended and re-normalised; a leaf with no ancestor scales in
 * over the second half of the morph, once the twig carrying it has grown.
 */
export function sampleLeaves(m: LSystemMorph, t: number, out: Float32Array): void {
  const a = m.leavesFrom
  const b = m.leavesTo
  if (m.isStatic) {
    out.set(b)
    return
  }
  const k = Math.min(1, Math.max(0, t))
  const grow = smoothstep(NEW_LEAF_DELAY, 1, k)
  for (let j = 0; j < m.leafCount; j++) {
    const o = j * LEAF_STRIDE
    out[o] = a[o] + (b[o] - a[o]) * k
    out[o + 1] = a[o + 1] + (b[o + 1] - a[o + 1]) * k
    out[o + 2] = a[o + 2] + (b[o + 2] - a[o + 2]) * k

    let dx = a[o + 3] + (b[o + 3] - a[o + 3]) * k
    let dy = a[o + 4] + (b[o + 4] - a[o + 4]) * k
    let dz = a[o + 5] + (b[o + 5] - a[o + 5]) * k
    // (sqrt of the sum of squares: Math.hypot is several times slower and this runs per leaf per frame)
    const len = Math.sqrt(dx * dx + dy * dy + dz * dz)
    if (len > 1e-6) {
      dx /= len
      dy /= len
      dz /= len
    } else {
      dx = b[o + 3]
      dy = b[o + 4]
      dz = b[o + 5]
    }
    out[o + 3] = dx
    out[o + 4] = dy
    out[o + 5] = dz

    out[o + 6] = m.leafIsNew[j] ? b[o + 6] * grow : a[o + 6] + (b[o + 6] - a[o + 6]) * k
  }
}
