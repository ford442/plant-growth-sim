import { describe, expect, it } from 'vitest'
import { createBfdState } from '../../../simulation/parasite/bfdSwitch'
import {
  CYST_MAX_BRADYZOITES,
  CYST_MIN_DIAMETER,
  CYST_MAX_DIAMETER,
  CYST_WALL_MAX,
  cystDiameter,
  cystWallThickness,
} from '../../../simulation/parasite/stages'
import type { Cyst } from '../../../simulation/parasite/world'
import { BRADYZOITE_LENGTH_UM, MIN_DRAW_DIAMETER_UM, RING_FIT } from './bradyzoites'
import { CELL_FILL, CYST_CAPACITY, slotPosition } from './sliceLayout'
import { SLICE_LOD } from './sliceLod'
import { CLAIM_RADIUS, CYST_LIFT, EASE_SECONDS, SliceModel, SPAWN_FRACTION, type SliceUpdateOptions } from './sliceModel'
import { syntheticCysts } from './syntheticCysts'

const FRAME = 1 / 60
const HIGH = SLICE_LOD.high.bradyzoiteBudget

function cyst(id: number, bradyzoites: number, patch: Partial<Cyst> = {}): Cyst {
  return {
    id,
    niche: 'cnsCortex',
    pos: { x: 0, y: 0, z: 0 },
    diameter: cystDiameter(bradyzoites),
    wall: cystWallThickness(bradyzoites),
    bradyzoites,
    ageHours: 10,
    bfd: createBfdState(),
    divisionTimer: 0,
    intact: true,
    ...patch,
  }
}

const opts = (patch: Partial<SliceUpdateOptions> = {}): SliceUpdateOptions => ({
  dt: FRAME,
  budget: HIGH,
  hoverId: null,
  niche: 'cnsCortex',
  ...patch,
})

/** Radius of drawn cyst `j` as the model wrote it (the uniform scale in its instance matrix). */
const radiusOf = (m: SliceModel, j: number) => m.cystMatrix[j * 16]

function deepFreeze<T>(o: T): T {
  if (o && typeof o === 'object' && !Object.isFrozen(o)) {
    Object.freeze(o)
    for (const v of Object.values(o)) deepFreeze(v)
  }
  return o
}

describe('SliceModel — relative scales (research §2.2)', () => {
  it('draws a 5 µm young cyst and a 70 µm mature one at exactly 1 : 14', () => {
    const m = new SliceModel()
    const young = cyst(1, 2)
    const mature = cyst(2, CYST_MAX_BRADYZOITES)
    expect(young.diameter).toBeCloseTo(CYST_MIN_DIAMETER, 9)
    expect(mature.diameter).toBeCloseTo(CYST_MAX_DIAMETER, 9)
    m.update([young, mature], opts())
    expect(radiusOf(m, 0)).toBeCloseTo(2.5, 5) // the instance matrix scales a unit sphere to µm
    expect(radiusOf(m, 1)).toBeCloseTo(35, 4)
    expect(radiusOf(m, 1) / radiusOf(m, 0)).toBeCloseTo(14, 3)
  })

  it('wraps each cyst in a wall shell no more than 0.5 µm proud of its body', () => {
    const m = new SliceModel()
    const cysts = [2, 16, 100, 400, CYST_MAX_BRADYZOITES].map((n, i) => cyst(i + 1, n))
    m.update(cysts, opts())
    cysts.forEach((c, j) => {
      const proud = m.shellMatrix[j * 16] - m.cystMatrix[j * 16]
      expect(proud).toBeCloseTo(c.wall, 5)
      expect(proud).toBeGreaterThan(0)
      expect(proud).toBeLessThanOrEqual(CYST_WALL_MAX + 1e-6)
    })
  })

  it('draws rods at true size: instance frames are unit-length, so 7 µm stays 7 µm', () => {
    const m = new SliceModel()
    const frame = m.update([cyst(1, 400)], opts())
    expect(frame.bradyzoites).toBe(400)
    for (let i = 0; i < frame.bradyzoites; i++) {
      for (const col of [0, 4, 8]) {
        const len = Math.hypot(m.bradyMatrix[i * 16 + col], m.bradyMatrix[i * 16 + col + 1], m.bradyMatrix[i * 16 + col + 2])
        expect(len).toBeCloseTo(1, 4)
      }
    }
    expect(BRADYZOITE_LENGTH_UM).toBe(7)
  })

  it('shows crescents only inside cysts wide enough to hold one', () => {
    const m = new SliceModel()
    const tiny = cyst(1, 8)
    const small = cyst(2, 16)
    expect(tiny.diameter).toBeLessThan(MIN_DRAW_DIAMETER_UM)
    expect(small.diameter).toBeGreaterThanOrEqual(MIN_DRAW_DIAMETER_UM)
    const frame = m.update([tiny, small], opts())
    expect(frame.bradyzoites).toBe(16)
    expect(frame.totalBradyzoites).toBe(24) // the sim's count, including the 8 not drawn
  })
})

describe('SliceModel — the 200 cyst / ~20 k bradyzoite case', () => {
  const cysts = syntheticCysts(200, 7)

  it('fits 200 cysts in one buffer per type, with the bradyzoites held to the tier budget', () => {
    const m = new SliceModel()
    const frame = m.update(cysts, opts())
    expect(frame.cysts).toBe(200)
    expect(frame.cysts).toBeLessThanOrEqual(CYST_CAPACITY)
    // the garden really holds more than a tier will draw — otherwise this would test nothing
    expect(frame.totalBradyzoites).toBeGreaterThan(HIGH)
    expect(frame.bradyzoites).toBeLessThanOrEqual(HIGH)
    expect(frame.bradyzoites).toBeGreaterThan(HIGH - 200)
    // and the buffers the four meshes bind are sized for it, without per-frame growth
    expect(m.cystMatrix.length).toBeGreaterThanOrEqual(200 * 16)
    expect(m.shellMatrix.length).toBeGreaterThanOrEqual(200 * 16)
    expect(m.bradyMatrix.length).toBeGreaterThanOrEqual(HIGH * 16)
    expect(frame.cells).toBeGreaterThan(0)
  })

  it('draws every bradyzoite it can when the budget is generous, and fewer on lower tiers', () => {
    const counts = (['low', 'medium', 'high', 'ultra'] as const).map((tier) =>
      new SliceModel().update(cysts, opts({ budget: SLICE_LOD[tier].bradyzoiteBudget })).bradyzoites,
    )
    expect(counts[0]).toBeLessThan(counts[1])
    expect(counts[1]).toBeLessThan(counts[2])
    expect(counts[2]).toBeLessThan(counts[3])
    counts.forEach((c, i) => expect(c).toBeLessThanOrEqual(SLICE_LOD[(['low', 'medium', 'high', 'ultra'] as const)[i]].bradyzoiteBudget))
  })

  it('keeps every drawn rod inside its cyst — at full size and mid-swell', () => {
    const m = new SliceModel()
    m.update(cysts, opts())
    assertRodsInside(m, 200)
  })

  it('maps instances back to cysts, one id each', () => {
    const m = new SliceModel()
    m.update(cysts, opts())
    const ids = Array.from(m.ids.subarray(0, 200))
    expect(new Set(ids).size).toBe(200)
    expect(ids).toEqual(cysts.map((c) => c.id))
  })

  it('stays cheap: a full rebuild, then quiet frames, at the acceptance load', () => {
    const m = new SliceModel()
    const t0 = performance.now()
    m.update(cysts, opts())
    const rebuild = performance.now() - t0
    const t1 = performance.now()
    const quiet = 200
    for (let i = 0; i < quiet; i++) m.update(cysts, opts())
    const perFrame = (performance.now() - t1) / quiet
    // generous ceilings (typical: ~10 ms and ~0.05 ms) — they catch an accidental O(n²), not noise
    expect(rebuild).toBeLessThan(500)
    expect(perFrame).toBeLessThan(5)
  })
})

/** Both ends of every drawn rod lie inside the wall of the cyst they belong to. */
function assertRodsInside(m: SliceModel, nCysts: number) {
  // find each cyst's rods by walking the draw order: the pick sphere gives its centre and current radius
  const first = new Map<number, number>()
  let at = 0
  for (let j = 0; j < nCysts; j++) {
    first.set(j, at)
    at += m['alloc'][j] as number
  }
  for (let j = 0; j < nCysts; j++) {
    const d = m['alloc'][j] as number
    const cx = m.pick[j * 4]
    const cy = m.pick[j * 4 + 1]
    const cz = m.pick[j * 4 + 2]
    const R = m.pick[j * 4 + 3]
    for (let r = 0; r < d; r++) {
      const o = (first.get(j)! + r) * 16
      for (const end of [-BRADYZOITE_LENGTH_UM / 2, BRADYZOITE_LENGTH_UM / 2]) {
        const ex = m.bradyMatrix[o + 12] + end * m.bradyMatrix[o + 8] - cx
        const ey = m.bradyMatrix[o + 13] + end * m.bradyMatrix[o + 9] - cy
        const ez = m.bradyMatrix[o + 14] + end * m.bradyMatrix[o + 10] - cz
        expect(Math.hypot(ex, ey, ez)).toBeLessThanOrEqual(RING_FIT * R + 1e-3)
      }
    }
  }
}

describe('SliceModel — quiet frames do no work', () => {
  it('reports nothing dirty when neither the sim nor the camera-side inputs changed', () => {
    const m = new SliceModel()
    const cysts = [cyst(1, 300), cyst(2, 40)]
    m.update(cysts, opts())
    const frame = m.update(cysts, opts())
    expect(frame.matricesDirty).toBe(false)
    expect(frame.colorsDirty).toBe(false)
    expect(frame.bradyDirty).toBe(false)
    expect(frame.cellsDirty).toBe(false)
    expect(frame.cellColorsDirty).toBe(false)
    expect(frame.easing).toBe(false)
  })

  it('does not rewrite the buffers on a quiet frame', () => {
    const m = new SliceModel()
    const cysts = [cyst(1, 300)]
    m.update(cysts, opts())
    const snapshot = m.bradyMatrix.slice(0, 300 * 16)
    // poison the buffer: a quiet frame must not touch it, so the poison survives
    m.bradyMatrix.fill(-7, 0, 300 * 16)
    m.update(cysts, opts())
    expect(m.bradyMatrix[0]).toBe(-7)
    expect(snapshot[0]).not.toBe(-7)
  })
})

describe('SliceModel — growth', () => {
  it('eases a growing cyst to its new size instead of popping, then goes quiet', () => {
    const m = new SliceModel()
    m.update([cyst(1, 100)], opts())
    const from = radiusOf(m, 0)
    const bigger = cyst(1, 160)
    const to = bigger.diameter / 2
    expect(to).toBeGreaterThan(from)

    let last = from
    let frames = 0
    let settled = false
    for (; frames < 600 && !settled; frames++) {
      const f = m.update([bigger], opts())
      const r = radiusOf(m, 0)
      expect(r).toBeGreaterThanOrEqual(last) // monotone swell
      expect(r).toBeLessThanOrEqual(to + 1e-5)
      expect(f.matricesDirty).toBe(true) // every frame of the swell is written, including the last
      last = r
      settled = !f.easing
    }
    expect(radiusOf(m, 0)).toBeCloseTo(to, 5)
    // an exponential ease with τ = 0.25 s is within ~1 % of done after 5τ
    expect(frames).toBeLessThan((6 * EASE_SECONDS) / FRAME)
    expect(frames).toBeGreaterThan(5) // it genuinely took a few frames
    expect(m.update([bigger], opts()).matricesDirty).toBe(false)
  })

  it('moves a swelling cyst’s rods outwards with it, and never through its wall', () => {
    const m = new SliceModel()
    const small = cyst(1, 100)
    m.update([small], opts())
    const bigger = cyst(1, 400)
    for (let i = 0; i < 12; i++) {
      m.update([bigger], opts())
      assertRodsInside(m, 1) // checked mid-swell, against the radius being shown that frame
    }
  })

  it('swells a cyst that appears while you watch from a fraction of its size', () => {
    const m = new SliceModel()
    m.update([cyst(1, 100)], opts())
    const born = cyst(2, 60)
    m.update([cyst(1, 100), born], opts())
    expect(radiusOf(m, 1)).toBeCloseTo(born.diameter / 2 * SPAWN_FRACTION, 1)
    for (let i = 0; i < 300; i++) m.update([cyst(1, 100), born], opts())
    expect(radiusOf(m, 1)).toBeCloseTo(born.diameter / 2, 4)
  })

  it('shows cysts already present on the first frame at full size (no swell on a tab switch)', () => {
    const m = new SliceModel()
    const c = cyst(1, 500)
    const f = m.update([c], opts())
    expect(radiusOf(m, 0)).toBeCloseTo(c.diameter / 2, 5)
    expect(f.easing).toBe(false)
  })

  it('finishes a swell even if the tab was hidden and one huge frame arrived', () => {
    const m = new SliceModel()
    m.update([cyst(1, 100)], opts())
    const bigger = cyst(1, 300)
    m.update([bigger], opts({ dt: 30 }))
    expect(radiusOf(m, 0)).toBeCloseTo(bigger.diameter / 2, 5)
  })
})

describe('SliceModel — slots', () => {
  it('leaves a ruptured cyst’s plot empty and never shuffles the others into it', () => {
    const m = new SliceModel()
    const a = cyst(1, 100)
    const b = cyst(2, 100)
    const c = cyst(3, 100)
    m.update([a, b, c], opts())
    const cPos = [m.pick[8], m.pick[10]]
    m.update([a, { ...b, intact: false }, c], opts())
    expect(m.update([a, { ...b, intact: false }, c], opts()).cysts).toBe(2)
    expect([m.pick[4], m.pick[6]]).toEqual(cPos) // c is now the 2nd drawn cyst, still on slot 2
    expect(cPos[0]).toBeCloseTo(slotPosition(2).x, 3) // (the buffer is Float32)
    expect(cPos[1]).toBeCloseTo(slotPosition(2).z, 3)
  })

  it('never moves a cyst when the garden grows', () => {
    const m = new SliceModel()
    const first = cyst(1, 300)
    m.update([first], opts())
    const at = [m.pick[0], m.pick[2]]
    const more = Array.from({ length: 30 }, (_, i) => cyst(i + 2, 20 + i))
    m.update([first, ...more], opts())
    expect([m.pick[0], m.pick[2]]).toEqual(at)
    expect(at).toEqual([0, 0])
  })

  it('sits each cyst half-buried: centre at CYST_LIFT × radius above the tissue', () => {
    const m = new SliceModel()
    m.update([cyst(1, 500)], opts())
    expect(m.pick[1]).toBeCloseTo(CYST_LIFT * m.pick[3], 5)
  })

  it('forgets cysts that have gone (a new host), and draws an empty garden cleanly', () => {
    const m = new SliceModel()
    m.update([cyst(1, 300), cyst(2, 300)], opts())
    const f = m.update([], opts())
    expect(f.cysts).toBe(0)
    expect(f.bradyzoites).toBe(0)
    expect(f.cells).toBeGreaterThan(0) // the tissue is still there
  })
})

describe('SliceModel — host cells', () => {
  it('hides the cells a cyst sits on and leaves the rest of the tissue', () => {
    const m = new SliceModel()
    m.update([cyst(1, CYST_MAX_BRADYZOITES)], opts())
    const lattice = m.lattice!
    const r = m.pick[3]
    let hidden = 0
    for (let k = 0; k < lattice.count; k++) {
      const d = Math.hypot(lattice.x[k], lattice.z[k])
      const scale = m.cellMatrix[k * 16]
      if (d <= CLAIM_RADIUS * r) {
        expect(scale).toBe(0)
        hidden++
      } else {
        expect(scale).toBeCloseTo(CELL_FILL, 5)
      }
    }
    expect(hidden).toBeGreaterThan(10)
  })

  it('brings the cells back when the cyst goes', () => {
    const m = new SliceModel()
    const c = cyst(1, CYST_MAX_BRADYZOITES)
    m.update([c], opts())
    m.update([{ ...c, intact: false }], opts())
    for (let k = 0; k < m.lattice!.count; k++) expect(m.cellMatrix[k * 16]).toBeCloseTo(CELL_FILL, 5)
  })

  it('extends the mosaic as the garden grows past a ring, and recolours it for a new tissue', () => {
    const m = new SliceModel()
    // the patch never shows fewer than two slot rings (19 slots), so 20 is the first count that widens it
    const few = m.update(Array.from({ length: 19 }, (_, i) => cyst(i + 1, 50)), opts())
    const many = m.update(Array.from({ length: 20 }, (_, i) => cyst(i + 1, 50)), opts())
    expect(many.cells).toBeGreaterThan(few.cells)
    expect(many.cellsDirty).toBe(true)

    const cortex = m.cellColor.slice(0, 3)
    const f = m.update(Array.from({ length: 20 }, (_, i) => cyst(i + 1, 50)), opts({ niche: 'retina' }))
    expect(f.cellColorsDirty).toBe(true)
    expect(Array.from(m.cellColor.slice(0, 3))).not.toEqual(Array.from(cortex))
  })
})

describe('SliceModel — hover', () => {
  it('brightens only the hovered cyst’s rim, and only when hover changes', () => {
    const m = new SliceModel()
    const cysts = [cyst(1, 100), cyst(2, 100)]
    m.update(cysts, opts())
    const rest = m.shellColor[0]
    const hovered = m.update(cysts, opts({ hoverId: 2 }))
    expect(hovered.colorsDirty).toBe(true)
    expect(m.shellColor[3]).toBeGreaterThan(rest * 2)
    expect(m.shellColor[0]).toBeCloseTo(rest, 6)
    expect(m.update(cysts, opts({ hoverId: 2 })).colorsDirty).toBe(false)
    m.update(cysts, opts({ hoverId: null }))
    expect(m.shellColor[3]).toBeCloseTo(rest, 6)
  })
})

describe('SliceModel — view-layer rules', () => {
  it('never writes to what it reads (deep-frozen input)', () => {
    const m = new SliceModel()
    const cysts = deepFreeze(syntheticCysts(40, 3))
    expect(() => {
      m.update(cysts, opts())
      m.update(cysts, opts({ hoverId: cysts[0].id }))
      m.update(cysts.map((c) => ({ ...c, bradyzoites: c.bradyzoites + 50 })), opts())
    }).not.toThrow()
  })

  it('is deterministic: the same inputs give the same buffers', () => {
    const run = () => {
      const m = new SliceModel()
      const cysts = syntheticCysts(60, 11)
      m.update(cysts, opts())
      for (let i = 0; i < 30; i++) m.update(cysts.map((c, j) => (j % 3 === 0 ? { ...c, diameter: c.diameter * 1.1 } : c)), opts())
      return m
    }
    const a = run()
    const b = run()
    expect(Array.from(a.bradyMatrix.subarray(0, 4096))).toEqual(Array.from(b.bradyMatrix.subarray(0, 4096)))
    expect(Array.from(a.cystMatrix.subarray(0, 60 * 16))).toEqual(Array.from(b.cystMatrix.subarray(0, 60 * 16)))
  })

  it('draws at most CYST_CAPACITY cysts however many it is handed', () => {
    const m = new SliceModel()
    const f = m.update(syntheticCysts(CYST_CAPACITY + 40, 2), opts())
    expect(f.cysts).toBe(CYST_CAPACITY)
  })
})
