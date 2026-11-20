import { describe, expect, it } from 'vitest'
import * as THREE from 'three'
import { SPECIES_LSYSTEMS } from '../../simulation/LSystem'
import { createMorphBuilder, sampleSegments, sampleThickness } from '../../simulation/LSystemMorph'
import {
  JOINT_OVERLAP,
  RADIUS_PER_THICKNESS,
  branchDetail,
  writeBranchMatrices,
  writeBranchMatrix,
} from './branchMatrix'

const matrix = (s: number[], e: number[], r: number) => {
  const out = new Float32Array(16)
  writeBranchMatrix(out, 0, s[0], s[1], s[2], e[0], e[1], e[2], r)
  return new THREE.Matrix4().fromArray(out)
}

/** A point on the shared unit cylinder (radius 1, base at y = 0, top at y = 1), as the vertex shader sees it. */
const cyl = (angle: number, y: number) => new THREE.Vector3(Math.cos(angle), y, Math.sin(angle))

describe('writeBranchMatrix', () => {
  let seed = 7
  const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296) * 2 - 1

  it('puts the cylinder axis on the segment, overhanging each end by JOINT_OVERLAP radii', () => {
    for (let i = 0; i < 300; i++) {
      const s = [rnd() * 5, rnd() * 5, rnd() * 5]
      const e = [rnd() * 5, rnd() * 5, rnd() * 5]
      const r = 0.01 + Math.abs(rnd()) * 0.1
      const m = matrix(s, e, r)
      const dir = new THREE.Vector3(e[0] - s[0], e[1] - s[1], e[2] - s[2])
      const len = dir.length()
      dir.normalize()

      const base = new THREE.Vector3(0, 0, 0).applyMatrix4(m)
      const top = new THREE.Vector3(0, 1, 0).applyMatrix4(m)
      const wantBase = new THREE.Vector3(...s).addScaledVector(dir, -r * JOINT_OVERLAP)
      const wantTop = new THREE.Vector3(...e).addScaledVector(dir, r * JOINT_OVERLAP)
      expect(base.distanceTo(wantBase)).toBeLessThan(1e-4)
      expect(top.distanceTo(wantTop)).toBeLessThan(1e-4)
      expect(base.distanceTo(top)).toBeCloseTo(len + 2 * r * JOINT_OVERLAP, 4)
    }
  })

  it('keeps the surface at the requested radius from the axis, all the way round', () => {
    const s = [1, 2, 3]
    const e = [2, 4, 1]
    const r = 0.07
    const m = matrix(s, e, r)
    const a = new THREE.Vector3(...s)
    const axis = new THREE.Vector3(...e).sub(a).normalize()
    for (let k = 0; k < 12; k++) {
      for (const y of [0, 0.3, 1]) {
        const p = cyl((k / 12) * Math.PI * 2, y).applyMatrix4(m)
        const off = p.clone().sub(a)
        off.addScaledVector(axis, -off.dot(axis)) // component ⟂ axis
        expect(off.length()).toBeCloseTo(r, 5)
      }
    }
  })

  it('is a proper rotation × positive scale, so winding and normals face outward', () => {
    const dirs = [[0, 1, 0], [0, -1, 0], [1, 0, 0], [0, 0, -1], [0.3, 0.8, -0.5], [-1, -0.2, 0.4]]
    for (const d of dirs) {
      const m = matrix([0, 0, 0], d, 0.05)
      expect(m.determinant()).toBeGreaterThan(0)
      // the outward normal of the +X side of the cylinder still points away from the axis
      const n = new THREE.Vector3(1, 0, 0).transformDirection(m)
      const axis = new THREE.Vector3(...d).normalize()
      expect(Math.abs(n.dot(axis))).toBeLessThan(1e-5)
    }
  })

  it('collapses to a finite point for a zero-size twig (the start of a morph), never NaN', () => {
    const out = new Float32Array(16)
    writeBranchMatrix(out, 0, 1, 2, 3, 1, 2, 3, 0)
    expect(Array.from(out).every(Number.isFinite)).toBe(true)
    const p = new THREE.Vector3(0.7, 0.5, -0.7).applyMatrix4(new THREE.Matrix4().fromArray(out))
    expect(p.toArray()).toEqual([1, 2, 3])
  })

  it('writes at the given offset and touches nothing else', () => {
    const out = new Float32Array(48).fill(-9)
    writeBranchMatrix(out, 16, 0, 0, 0, 0, 1, 0, 0.1)
    expect(out.slice(0, 16).every((v) => v === -9)).toBe(true)
    expect(out.slice(32).every((v) => v === -9)).toBe(true)
    expect(out[31]).toBe(1)
  })
})

describe('writeBranchMatrices over a real morph', () => {
  it('draws every segment of every species finite, and thicker where the interpreter says thicker', () => {
    for (const [id, def] of Object.entries(SPECIES_LSYSTEMS)) {
      const m = createMorphBuilder(def).morph(4)
      const pos = new Float32Array(m.segmentsTo.length)
      const thick = new Float32Array(m.segmentCount)
      const out = new Float32Array(m.segmentCount * 16)
      for (const t of [0, 0.5, 1]) {
        sampleSegments(m, t, pos)
        sampleThickness(m, t, thick)
        writeBranchMatrices(pos, thick, m.segmentCount, out)
        expect(out.every(Number.isFinite), `${id} t=${t}`).toBe(true)
      }
      // at t = 1 the radius is the species' own thickness × RADIUS_PER_THICKNESS
      const x0 = Math.hypot(out[0], out[1], out[2])
      expect(x0).toBeCloseTo(m.thicknessTo[0] * RADIUS_PER_THICKNESS, 5)
    }
  })

  it('leaves the stem a joint-overlap wide at a bend: the next segment starts inside this one', () => {
    // two segments meeting at 40°: the second one's cylinder reaches back into the first
    const r = 0.05
    const a = matrix([0, 0, 0], [0, 1, 0], r)
    const b = matrix([0, 1, 0], [Math.sin(0.7), 1 + Math.cos(0.7), 0], r)
    const back = new THREE.Vector3(0, 0, 0).applyMatrix4(b) // start of b's cylinder
    const topA = new THREE.Vector3(0, 1, 0).applyMatrix4(a)
    expect(back.y).toBeLessThan(1)
    expect(topA.y).toBeGreaterThan(1)
  })
})

describe('branchDetail (segment budget)', () => {
  const tris = (n: number) => {
    const d = branchDetail(n)
    return n * (d.radialSegments * 2 + (d.capped ? d.radialSegments * 2 : 0))
  }

  it('gets coarser as the plant gets denser, and never below a square cross-section', () => {
    let last = Infinity
    for (const n of [38, 500, 3000, 3001, 15000, 15001, 30000, 30001, 78125]) {
      const d = branchDetail(n)
      expect(d.radialSegments).toBeGreaterThanOrEqual(4)
      expect(d.radialSegments).toBeLessThanOrEqual(last)
      last = d.radialSegments
    }
  })

  it('keeps every species at every iteration under 0.65 M triangles', () => {
    for (const def of Object.values(SPECIES_LSYSTEMS)) {
      const b = createMorphBuilder(def)
      for (let n = 0; n <= 7; n++) expect(tris(b.morph(n).segmentCount)).toBeLessThan(650_000)
    }
  })
})
