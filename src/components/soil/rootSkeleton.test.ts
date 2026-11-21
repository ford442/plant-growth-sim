import { describe, expect, it } from 'vitest'
import {
  CELL_W,
  rootSystem,
  SOIL_COLS,
  SOIL_WIDTH,
  SPECIES_ROOTS,
  type SoilState,
} from '../../simulation/SoilField'
import type { SpeciesId } from '../../stores/simStore'
import { poseRoots, rootSkeleton } from './rootSkeleton'

const SPECIES = Object.keys(SPECIES_ROOTS) as SpeciesId[]
const frontEverywhere = (d: number) => new Array<number>(SOIL_COLS).fill(d)
const column = (x: number) => Math.floor((x + SOIL_WIDTH / 2) / CELL_W)

describe('root skeleton', () => {
  for (const id of SPECIES) {
    describe(id, () => {
      const def = rootSystem(id)
      const sk = rootSkeleton(def, id.length)

      it('is a tree: parents come first and every path ends at the stem base', () => {
        expect(sk.length).toBeGreaterThan(20)
        for (let i = 0; i < sk.length; i++) {
          expect(sk[i].parent).toBeLessThan(i)
          expect(sk[i].parent).toBeGreaterThanOrEqual(-1)
          let hops = 0
          for (let j = i; j >= 0; j = sk[j].parent) expect(++hops).toBeLessThanOrEqual(sk.length)
        }
        expect(sk.some((s) => s.parent < 0)).toBe(true)
      })

      it('is continuous: a segment starts where its parent ends', () => {
        for (const s of sk) {
          if (s.parent < 0) continue
          expect(s.x0).toBeCloseTo(sk[s.parent].x1, 9)
          expect(s.z0).toBeCloseTo(sk[s.parent].z1, 9)
        }
      })

      it('starts at the stem base', () => {
        for (const s of sk) if (s.parent < 0) expect(Math.hypot(s.x0, s.z0)).toBeLessThan(0.1)
      })
    })
  }

  it('is deterministic', () => {
    const def = rootSystem('oak')
    expect(rootSkeleton(def, 3)).toEqual(rootSkeleton(def, 3))
  })
})

describe('poseRoots', () => {
  const def = rootSystem('sunflower')
  const sk = rootSkeleton(def, 'sunflower'.length)
  const at = (depth: number, fronts = frontEverywhere(depth)): Pick<SoilState, 'rootDepth' | 'rootFront'> => ({
    rootDepth: depth,
    rootFront: fronts,
  })

  it('draws the whole system once the roots are at full depth', () => {
    const p = poseRoots(sk, def, at(def.maxDepth))
    expect(p.visible.every((v) => v === 1)).toBe(true)
    expect(p.connected.every((v) => v === 1)).toBe(true)
    for (let i = 0; i < sk.length; i++) {
      expect(p.x1[i]).toBeCloseTo(sk[i].x1, 5)
      expect(p.z1[i]).toBeCloseTo(sk[i].z1, 5)
    }
  })

  it('scales to the root front: a seedling has a small, connected root system', () => {
    const p = poseRoots(sk, def, at(0.3))
    const drawn = p.visible.reduce((n, v) => n + v, 0)
    expect(drawn).toBeGreaterThan(0)
    expect(drawn).toBeLessThanOrEqual(sk.length)
    let deepest = 0
    for (let i = 0; i < sk.length; i++) if (p.visible[i]) deepest = Math.max(deepest, p.z1[i])
    expect(deepest).toBeLessThanOrEqual(0.3 + 1e-6)
  })

  it('clips roots at the front of their column (a hardpan) and drops what hangs below it', () => {
    const fronts = frontEverywhere(def.maxDepth)
    const stemCols = [SOIL_COLS / 2 - 1, SOIL_COLS / 2]
    for (const c of stemCols) fronts[c] = 0.6 // hardpan under the stem
    const p = poseRoots(sk, def, at(def.maxDepth, fronts))
    for (let i = 0; i < sk.length; i++) {
      if (!p.visible[i]) continue
      expect(p.z1[i]).toBeLessThanOrEqual(fronts[column(p.x0[i])] + 1e-6)
    }
    // the main root stops at the pan, so nothing connected hangs below it in the stem columns
    let clipped = 0
    for (let i = 0; i < sk.length; i++) {
      if (p.visible[i] && !p.connected[i]) clipped++
      // a connected segment's parent is always connected and drawn in full
      if (p.connected[i] && sk[i].parent >= 0) {
        const par = sk[i].parent
        expect(p.connected[par]).toBe(1)
        expect(p.x1[par]).toBeCloseTo(p.x0[i], 5)
        expect(p.z1[par]).toBeCloseTo(p.z0[i], 5)
      }
    }
    expect(clipped).toBeGreaterThan(0) // laterals that branched off below the pan are cut off from the stem
    expect(p.connected.reduce((n, v) => n + v, 0)).toBeLessThan(sk.length)
  })

  it('reuses the buffers it is given', () => {
    const a = poseRoots(sk, def, at(0.5))
    const b = poseRoots(sk, def, at(1.2), a)
    expect(b).toBe(a)
  })
})
