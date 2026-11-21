import { describe, expect, it } from 'vitest'
import { FIXED_STEP_CLOCKS } from '../fixedStep'
import { PEAK_SPEED } from '../glideosome'
import { MJ_PHASES, type MjPhase } from '../invasion'
import { distV, vec3 } from '../math'
import { budProgress, pvRadius, rosettePose, rosetteSlot } from './rosette'
import {
  createLytic,
  DEFAULT_LYTIC_FLAGS,
  LYTIC_ORDER,
  lyticProgress,
  lyticSettled,
  SANDBOX_CAPACITY,
  SANDBOX_ROUNDS,
  STALL_SECONDS,
  stepLytic,
  type LyticFlags,
  type LyticState,
} from './sandbox'
import { BODY_LENGTH, BODY_WIDTH, createSubstrateZoite, HALF_LENGTH, REST_HEIGHT, stepSubstrateGlide } from './substrateGlide'
import { createRng } from '../math'

const MAX_STEPS = 20_000

/** Run to the settled end; record every state the test wants to inspect. */
function play(seed: number, flags: Partial<LyticFlags> = {}, onStep?: (s: LyticState) => void): { end: LyticState; steps: number } {
  let s = createLytic(seed, { ...DEFAULT_LYTIC_FLAGS, ...flags })
  let steps = 0
  while (!lyticSettled(s) && steps < MAX_STEPS) {
    s = stepLytic(s, FIXED_STEP_CLOCKS)
    steps++
    onStep?.(s)
  }
  return { end: s, steps }
}

function deepFreeze<T>(o: T): T {
  if (o !== null && typeof o === 'object' && !Object.isFrozen(o)) {
    Object.freeze(o)
    for (const v of Object.values(o)) deepFreeze(v)
  }
  return o
}

describe('lytic sandbox: one full loop', () => {
  it('runs from glide to lysis with no input, in the documented phase order', () => {
    for (const seed of [1, 7, 42, 20260812]) {
      const { end, steps } = play(seed)
      expect(steps).toBeLessThan(MAX_STEPS)
      expect(end.phase).toBe('lysed')
      expect(end.history).toEqual(LYTIC_ORDER)
      expect(lyticProgress(end)).toBe(1)
    }
  })

  it('walks the moving junction through every MJ phase in order', () => {
    const seen: MjPhase[] = []
    play(42, {}, (s) => {
      if (s.mj && seen[seen.length - 1] !== s.mj.phase) seen.push(s.mj.phase)
    })
    expect(seen).toEqual(MJ_PHASES)
  })

  it('doubles by endodyogeny each round until the crowded PV egresses', () => {
    const counts: number[] = []
    const { end } = play(42, {}, (s) => {
      if (s.pv && counts[counts.length - 1] !== s.pv.parasites) counts.push(s.pv.parasites)
    })
    expect(counts).toEqual([1, 2, 4, 8, 16, 32])
    expect(end.pv?.round).toBe(SANDBOX_ROUNDS)
    expect(end.released).toHaveLength(SANDBOX_CAPACITY)
  })

  it('replicates only on the lesion gear, ~7 h a round', () => {
    let start = -1
    let stop = -1
    play(42, {}, (s) => {
      if (s.phase === 'replicate' && start < 0) start = s.lesionHours
      if (s.phase === 'egress' && stop < 0) stop = s.lesionHours
    })
    const perRound = (stop - start) / SANDBOX_ROUNDS
    expect(perRound).toBeGreaterThan(7 * 0.92)
    expect(perRound).toBeLessThan(7 * 1.08)
  })

  it('runs the egress cascade in order: acidify → Ca²⁺ → pores → rupture', () => {
    const seen: string[] = []
    let minPh = 99
    play(42, {}, (s) => {
      const e = s.pv?.egress
      if (!e || s.phase !== 'egress') return
      if (seen[seen.length - 1] !== e.phase) seen.push(e.phase)
      minPh = Math.min(minPh, e.ph)
    })
    expect(seen).toEqual(['quiescent', 'acidifying', 'calciumSpike', 'perforating'])
    expect(minPh).toBeLessThan(6)
  })

  it('is deterministic for a seed, and different seeds differ', () => {
    const a = play(1234).end
    const b = play(1234).end
    expect(b).toEqual(a)
    const c = play(4321).end
    expect(c.entry).not.toEqual(a.entry)
  })

  it('never mutates its input', () => {
    let s = createLytic(42)
    for (let i = 0; i < 3200; i++) {
      // a sample of every phase, including the rosette and the egress cascade
      if (i % 97 === 0) {
        const before = structuredClone(s)
        expect(() => stepLytic(deepFreeze(s), FIXED_STEP_CLOCKS)).not.toThrow()
        expect(s).toEqual(before)
        s = structuredClone(s)
      }
      s = stepLytic(s, FIXED_STEP_CLOCKS)
    }
  })
})

describe('lytic sandbox: challenge flags', () => {
  it('ΔPLP1: acidification and Ca²⁺ still fire, but no pores and no lysis', () => {
    let maxPores = 0
    let maxCa = 0
    const { end } = play(42, { deltaPlp1: true }, (s) => {
      maxPores = Math.max(maxPores, s.pv?.egress.pores ?? 0)
      maxCa = Math.max(maxCa, s.pv?.egress.calcium ?? 0)
    })
    expect(end.phase).toBe('trapped')
    expect(end.history).toEqual([...LYTIC_ORDER.slice(0, -1), 'trapped'])
    expect(end.history).not.toContain('lysed')
    expect(maxPores).toBe(0)
    expect(maxCa).toBeGreaterThan(0.8)
    expect(end.released).toHaveLength(0)
    expect(end.lysis).toBe(0)
  })

  it('RNG2 loss: lands on the dish, never moves, never attaches', () => {
    const start = createLytic(42, { ...DEFAULT_LYTIC_FLAGS, rng2Loss: true })
    const { end } = play(42, { rng2Loss: true })
    expect(end.phase).toBe('stalled')
    expect(end.history).toEqual(['glide', 'stalled'])
    expect(end.mj).toBeNull()
    expect(end.zoite.contact).toBe(true)
    expect(end.zoite.distance).toBe(0)
    expect(end.zoite.conoid).toBe(false)
    expect(end.zoite.pos.x).toBeCloseTo(start.zoite.pos.x, 9)
    expect(end.zoite.pos.z).toBeCloseTo(start.zoite.pos.z, 9)
    expect(end.actionSeconds).toBeGreaterThan(STALL_SECONDS)
  })

  it('wild type does reach the host from the same start', () => {
    const { end } = play(42)
    expect(end.zoite.distance).toBeGreaterThan(5)
    expect(end.zoite.conoid).toBe(true)
  })
})

describe('substrate glide kinematics (research §5)', () => {
  const run = (motile: boolean, gap: number, seconds: number) => {
    let z = createSubstrateZoite(vec3(30, 0, 0), Math.PI, gap, createRng(3), motile)
    let peak = 0
    const steps = Math.round(seconds / FIXED_STEP_CLOCKS.action)
    for (let i = 0; i < steps; i++) {
      z = stepSubstrateGlide(z, { dt: FIXED_STEP_CLOCKS.action, target: vec3(), motile })
      if (z.contact) peak = Math.max(peak, z.speed)
    }
    return { z, peak }
  }

  it('never exceeds ~3 µm/s and is stop-start, not constant', () => {
    let z = createSubstrateZoite(vec3(30, 0, 0), Math.PI, 0, createRng(3))
    const speeds: number[] = []
    for (let i = 0; i < 300; i++) {
      z = stepSubstrateGlide(z, { dt: FIXED_STEP_CLOCKS.action, target: vec3(), motile: true })
      speeds.push(z.speed)
    }
    expect(Math.max(...speeds)).toBeLessThanOrEqual(PEAK_SPEED)
    expect(Math.max(...speeds)).toBeGreaterThan(PEAK_SPEED * 0.8)
    expect(speeds.slice(60).some((v) => v === 0)).toBe(true)
  })

  it('does not move while out of contact (no free flight)', () => {
    let z = createSubstrateZoite(vec3(30, 0, 0), Math.PI, 2, createRng(3))
    const x0 = z.pos.x
    while (!z.contact) {
      z = stepSubstrateGlide(z, { dt: FIXED_STEP_CLOCKS.action, target: vec3(), motile: true })
      if (!z.contact) {
        expect(z.pos.x).toBe(x0)
        expect(z.speed).toBe(0)
      }
    }
    expect(z.pos.y).toBeCloseTo(REST_HEIGHT, 9)
  })

  it('traces a sinuous helical trail toward the target, not a straight line', () => {
    const { z } = run(true, 0, 20)
    expect(z.distance).toBeGreaterThan(10)
    // net displacement shorter than path length: the trail winds
    const net = distV(vec3(30, REST_HEIGHT, 0), z.pos)
    expect(net).toBeLessThan(z.distance * 0.99)
    expect(z.pos.x).toBeLessThan(30)
  })

  it('body is the 6 × 2 µm tachyzoite crescent', () => {
    expect(BODY_LENGTH).toBe(6)
    expect(BODY_WIDTH).toBe(2)
  })
})

describe('rosette layout', () => {
  it('puts posterior ends at the residual body and apices outward', () => {
    for (const n of [2, 4, 8, 16, 32]) {
      for (let i = 0; i < n; i++) {
        const p = rosetteSlot(n, i, 0.3)
        const posterior = { x: p.offset.x - p.heading.x * HALF_LENGTH, y: p.offset.y - p.heading.y * HALF_LENGTH, z: p.offset.z - p.heading.z * HALF_LENGTH }
        const apex = { x: p.offset.x + p.heading.x * HALF_LENGTH, y: p.offset.y + p.heading.y * HALF_LENGTH, z: p.offset.z + p.heading.z * HALF_LENGTH }
        expect(distV(posterior, vec3())).toBeLessThan(1)
        expect(distV(apex, vec3())).toBeLessThan(pvRadius(n))
      }
    }
  })

  it('daughters start where their mother was and ease into their own slots', () => {
    const mother = rosetteSlot(4, 1, 0)
    expect(rosettePose(8, 2, 0, 0)).toEqual(mother)
    expect(rosettePose(8, 3, 0, 0)).toEqual(mother)
    expect(rosettePose(8, 3, 1, 0)).toEqual(rosetteSlot(8, 3, 0))
  })

  it('vacuole grows monotonically and buds only in the second half of a round', () => {
    let prev = 0
    for (let x = 0.5; x <= 32; x += 0.25) {
      const r = pvRadius(x)
      expect(r).toBeGreaterThanOrEqual(prev)
      prev = r
    }
    expect(budProgress(0.3)).toBe(0)
    expect(budProgress(1)).toBe(1)
  })
})
