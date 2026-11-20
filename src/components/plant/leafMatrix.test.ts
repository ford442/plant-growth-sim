import { describe, expect, it } from 'vitest'
import * as THREE from 'three'
import { writeLeafMatrix } from './leafMatrix'

/** What PlantViewer used to do per leaf, through an Object3D. */
function reference(p: number[], d: number[], size: number) {
  const dummy = new THREE.Object3D()
  dummy.position.set(p[0], p[1], p[2])
  dummy.lookAt(p[0] + d[0], p[1] + d[1], p[2] + d[2])
  dummy.rotateX(Math.PI / 2)
  dummy.scale.setScalar(size)
  dummy.updateMatrix()
  return dummy.matrix.elements
}

function mine(p: number[], d: number[], size: number) {
  const out = new Float32Array(16)
  writeLeafMatrix(out, 0, p[0], p[1], p[2], d[0], d[1], d[2], size)
  return Array.from(out)
}

describe('writeLeafMatrix', () => {
  const unit = (v: number[]) => {
    const l = Math.hypot(...v)
    return v.map((c) => c / l)
  }

  it('matches Object3D.lookAt + rotateX(π/2) for arbitrary headings', () => {
    let seed = 12345
    const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296) * 2 - 1
    for (let i = 0; i < 500; i++) {
      const p = [rnd() * 5, rnd() * 5, rnd() * 5]
      const d = unit([rnd(), rnd(), rnd()])
      const size = 0.1 + Math.abs(rnd()) * 0.1
      const a = mine(p, d, size)
      const b = reference(p, d, size)
      for (let k = 0; k < 16; k++) expect(a[k]).toBeCloseTo(b[k], 4)
    }
  })

  it('matches for the degenerate headings (straight up/down, along the axes)', () => {
    for (const d of [[0, 1, 0], [0, -1, 0], [1, 0, 0], [-1, 0, 0], [0, 0, 1], [0, 0, -1]]) {
      const a = mine([1, 2, 3], d, 0.15)
      const b = reference([1, 2, 3], d, 0.15)
      for (let k = 0; k < 16; k++) expect(a[k]).toBeCloseTo(b[k], 4)
    }
  })

  it('puts the leaf along its heading, centred on its position', () => {
    const m = new THREE.Matrix4().fromArray(mine([1, 2, 3], [0, 0, 1], 0.2))
    const tip = new THREE.Vector3(0, 0.7, 0).applyMatrix4(m) // top of the 1 × 1.4 plane
    expect(tip.x).toBeCloseTo(1, 5)
    expect(tip.y).toBeCloseTo(2, 5)
    expect(tip.z).toBeCloseTo(3 + 0.7 * 0.2, 5)
    // a zero-size leaf collapses to its position
    const z = new THREE.Matrix4().fromArray(mine([1, 2, 3], [0, 1, 0], 0))
    const v = new THREE.Vector3(0.5, 0.7, 0).applyMatrix4(z)
    expect(v.toArray()).toEqual([1, 2, 3])
  })
})
