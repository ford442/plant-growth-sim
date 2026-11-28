import { describe, expect, it } from 'vitest'
import * as THREE from 'three'
import { SUN_DIRECTION, writeLeafMatrices, writeLeafMatrix } from './leafMatrix'
import { LEAF_LENGTH } from './leafGeometry'
import { LEAF_STRIDE } from '../../simulation/LSystemMorph'

const unit = (v: number[]) => {
  const l = Math.hypot(...v)
  return v.map((c) => c / l)
}

function rig(seed = 12345) {
  let s = seed
  const rnd = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296) * 2 - 1
  return { rnd, dir: () => unit([rnd(), rnd(), rnd()]) }
}

function build(p: number[], d: number[], size: number, light?: number[]) {
  const out = new Float32Array(16)
  if (light) writeLeafMatrix(out, 0, p[0], p[1], p[2], d[0], d[1], d[2], size, light[0], light[1], light[2])
  else writeLeafMatrix(out, 0, p[0], p[1], p[2], d[0], d[1], d[2], size)
  return new THREE.Matrix4().fromArray(out)
}

/** Basis vectors (still scaled by `size`) and translation of an instance matrix. */
function columns(m: THREE.Matrix4) {
  const x = new THREE.Vector3()
  const y = new THREE.Vector3()
  const z = new THREE.Vector3()
  const t = new THREE.Vector3()
  m.extractBasis(x, y, z)
  t.setFromMatrixPosition(m)
  return { x, y, z, t }
}

describe('writeLeafMatrix', () => {
  it('lays the blade along its heading, with an orthogonal, right-handed, uniformly scaled basis', () => {
    const { rnd, dir } = rig()
    for (let i = 0; i < 300; i++) {
      const size = 0.1 + Math.abs(rnd()) * 0.2
      const d = dir()
      const { x, y, z } = columns(build([rnd(), rnd(), rnd()], d, size))
      expect(x.length()).toBeCloseTo(size, 5)
      expect(y.length()).toBeCloseTo(size, 5)
      expect(z.length()).toBeCloseTo(size, 5)
      expect(x.dot(y)).toBeCloseTo(0, 6)
      expect(y.dot(z)).toBeCloseTo(0, 6)
      expect(x.dot(z)).toBeCloseTo(0, 6)
      // y is the long axis, along the heading
      expect(y.clone().divideScalar(size).toArray()).toEqual(d.map((c) => expect.closeTo(c, 5)))
      // x × y = z: a mirrored (negative-determinant) matrix would flip the blade's faces
      expect(x.clone().cross(y).dot(z)).toBeGreaterThan(0)
    }
  })

  it('turns the upper face towards the light: the normal is the light direction with the heading taken out', () => {
    const { rnd, dir } = rig(99)
    for (let i = 0; i < 300; i++) {
      const d = dir()
      const light = dir()
      const dl = d[0] * light[0] + d[1] * light[1] + d[2] * light[2]
      if (Math.abs(dl) > 0.999) continue // degenerate: covered below
      const expected = unit([light[0] - d[0] * dl, light[1] - d[1] * dl, light[2] - d[2] * dl])
      const { z } = columns(build([rnd(), rnd(), rnd()], d, 1, light))
      expect(z.toArray()).toEqual(expected.map((c) => expect.closeTo(c, 5)))
      expect(z.dot(new THREE.Vector3(...light))).toBeGreaterThan(0) // never faces away from the sun
    }
  })

  it('uses the sun of the plant scene by default', () => {
    expect(Math.hypot(...SUN_DIRECTION)).toBeCloseTo(1, 10)
    const d = [0, 0, 1]
    const a = columns(build([0, 0, 0], d, 1)).z
    const b = columns(build([0, 0, 0], d, 1, [...SUN_DIRECTION])).z
    expect(a.distanceTo(b)).toBeLessThan(1e-6)
    expect(a.y).toBeGreaterThan(0) // faces the sky
  })

  it('stays well-formed when the heading is parallel or anti-parallel to the light, and for a zero heading', () => {
    const light = [...SUN_DIRECTION]
    const cases = [light, light.map((c) => -c), [0, 1, 0], [0, -1, 0], [1, 0, 0], [0, 0, 1], [0, 0, 0]]
    for (const d of cases) {
      const m = build([1, 2, 3], d, 0.2)
      expect(m.elements.every(Number.isFinite)).toBe(true)
      const { x, y, z } = columns(m)
      expect(x.length()).toBeCloseTo(0.2, 5)
      expect(y.length()).toBeCloseTo(0.2, 5)
      expect(x.dot(y)).toBeCloseTo(0, 6)
      expect(x.dot(z)).toBeCloseTo(0, 6)
      expect(y.dot(z)).toBeCloseTo(0, 6)
    }
  })

  it('stands the blade on its position: base at the leaf point, tip one blade length along the heading', () => {
    const size = 0.2
    const m = build([1, 2, 3], [0, 0, 1], size)
    expect(new THREE.Vector3(0, 0, 0).applyMatrix4(m).toArray()).toEqual([1, 2, 3])
    const tip = new THREE.Vector3(0, LEAF_LENGTH, 0).applyMatrix4(m)
    expect(tip.x).toBeCloseTo(1, 5)
    expect(tip.y).toBeCloseTo(2, 5)
    expect(tip.z).toBeCloseTo(3 + LEAF_LENGTH * size, 5)
    // a zero-size leaf collapses onto its position
    const z = new THREE.Vector3(0.5, LEAF_LENGTH, 0.1).applyMatrix4(build([1, 2, 3], [0, 1, 0], 0))
    expect(z.toArray()).toEqual([1, 2, 3])
  })

  it('writeLeafMatrices expands a sampled pose, honouring a custom light', () => {
    const pose = new Float32Array(2 * LEAF_STRIDE)
    pose.set([1, 2, 3, 0, 0, 1, 0.2], 0)
    pose.set([4, 5, 6, 1, 0, 0, 0.3], LEAF_STRIDE)
    const out = new Float32Array(32)
    writeLeafMatrices(pose, 2, out, [1, 0, 0])
    const second = new THREE.Matrix4().fromArray(out, 16)
    expect(columns(second).t.toArray()).toEqual([4, 5, 6])
    const first = columns(new THREE.Matrix4().fromArray(out, 0))
    expect(first.z.x).toBeGreaterThan(0.19) // light along +X, heading +Z: the normal is +X (× size)
  })
})
