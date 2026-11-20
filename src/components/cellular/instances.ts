import * as THREE from 'three'

/**
 * Fills an InstancedMesh straight from typed arrays. The lens rewrites about a
 * thousand instances every frame, so this skips Object3D/Matrix4 churn: every
 * instance is an axis-aligned scaled quad, so the matrix is just scale + translate.
 */
export class InstanceLayer {
  n = 0
  private readonly matrices: Float32Array
  private readonly colors: Float32Array

  constructor(
    private readonly mesh: THREE.InstancedMesh,
    readonly capacity: number,
  ) {
    this.matrices = mesh.instanceMatrix.array as Float32Array
    // setColorAt allocates instanceColor; the values are overwritten every frame.
    mesh.setColorAt(0, new THREE.Color(1, 1, 1))
    this.colors = mesh.instanceColor!.array as Float32Array
    mesh.frustumCulled = false
  }

  reset() {
    this.n = 0
  }

  add(x: number, y: number, z: number, sx: number, sy: number, color: THREE.Color) {
    if (this.n >= this.capacity) return
    const o = this.n * 16
    const m = this.matrices
    m[o] = sx
    m[o + 1] = 0
    m[o + 2] = 0
    m[o + 3] = 0
    m[o + 4] = 0
    m[o + 5] = sy
    m[o + 6] = 0
    m[o + 7] = 0
    m[o + 8] = 0
    m[o + 9] = 0
    m[o + 10] = 1
    m[o + 11] = 0
    m[o + 12] = x
    m[o + 13] = y
    m[o + 14] = z
    m[o + 15] = 1
    const c = this.n * 3
    this.colors[c] = color.r
    this.colors[c + 1] = color.g
    this.colors[c + 2] = color.b
    this.n++
  }

  flush() {
    this.mesh.count = this.n
    this.mesh.instanceMatrix.needsUpdate = true
    this.mesh.instanceColor!.needsUpdate = true
  }
}
