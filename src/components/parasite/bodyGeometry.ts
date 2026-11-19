/**
 * Procedural crescent body for the zoite stages.
 *
 * *T. gondii* zoites are polarised bows: a pointed anterior (the apical
 * complex, where the conoid extrudes) and a blunt posterior (the basal
 * complex). Rigidity comes from 22 subpellicular microtubules running about
 * two-thirds of the body length, which is why the shape never deforms as it
 * glides — so a single rigid geometry per stage is the physically right model,
 * and it instances cheaply.
 *
 * Geometry convention: the apex points along **+Z**, the bow bends in **X**,
 * and the body is centred on the origin. Dimensions are micrometres.
 */

import * as THREE from 'three'

/** Radial profile of the body at `t` (0 = apex, 1 = posterior). */
function bodyRadius(t: number, halfWidth: number): number {
  // pointed apex over the first fifth
  const apex = Math.min(1, (t / 0.22) ** 0.65)
  // rounded posterior cap
  const posterior = t > 0.88 ? Math.sqrt(Math.max(0, 1 - ((t - 0.88) / 0.12) ** 2)) : 1
  // gentle taper down the back half
  const taper = 1 - 0.18 * Math.max(0, (t - 0.5) / 0.5)
  return halfWidth * apex * posterior * taper
}

export interface CrescentOptions {
  /** Long-axis length, µm. */
  length: number
  /** Maximum width, µm. */
  width: number
  /** Lateral bow amplitude as a fraction of length (0 = straight rod). */
  bend?: number
  radialSegments?: number
  lengthSegments?: number
}

/**
 * Builds a tapered tube swept along a bowed centre line. Callers own disposal.
 */
export function crescentGeometry({
  length,
  width,
  bend = 0.12,
  radialSegments = 10,
  lengthSegments = 20,
}: CrescentOptions): THREE.BufferGeometry {
  const halfWidth = width / 2
  const amp = bend * length

  const centre = (t: number) => new THREE.Vector3(amp * Math.sin(Math.PI * t), 0, (0.5 - t) * length)
  const tangent = (t: number) =>
    new THREE.Vector3(amp * Math.PI * Math.cos(Math.PI * t), 0, -length).normalize()

  const positions: number[] = []
  const normals: number[] = []
  const uvs: number[] = []
  const indices: number[] = []

  const up = new THREE.Vector3(0, 1, 0)
  for (let i = 0; i <= lengthSegments; i++) {
    const t = i / lengthSegments
    const c = centre(t)
    const tan = tangent(t)
    const side = new THREE.Vector3().crossVectors(up, tan).normalize()
    const vert = new THREE.Vector3().crossVectors(tan, side).normalize()
    const r = bodyRadius(t, halfWidth)

    for (let j = 0; j <= radialSegments; j++) {
      const a = (j / radialSegments) * Math.PI * 2
      const dir = side.clone().multiplyScalar(Math.cos(a)).addScaledVector(vert, Math.sin(a))
      positions.push(c.x + dir.x * r, c.y + dir.y * r, c.z + dir.z * r)
      normals.push(dir.x, dir.y, dir.z)
      uvs.push(j / radialSegments, t)
    }
  }

  for (let i = 0; i < lengthSegments; i++) {
    for (let j = 0; j < radialSegments; j++) {
      const a = i * (radialSegments + 1) + j
      const b = a + radialSegments + 1
      indices.push(a, b, a + 1, b, b + 1, a + 1)
    }
  }

  const g = new THREE.BufferGeometry()
  g.setIndex(indices)
  g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  g.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3))
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2))
  g.computeVertexNormals()
  g.computeBoundingSphere()
  return g
}

/**
 * Orthonormal instance matrix from a parasite's own frame: `heading` is the
 * apex direction (+Z of the geometry) and `up` carries the body roll.
 */
export function orientInstance(
  target: THREE.Matrix4,
  position: { x: number; y: number; z: number },
  heading: { x: number; y: number; z: number },
  up: { x: number; y: number; z: number },
  scale = 1,
): THREE.Matrix4 {
  const z = new THREE.Vector3(heading.x, heading.y, heading.z).normalize()
  let y = new THREE.Vector3(up.x, up.y, up.z)
  // guard against a degenerate frame after long float accumulation
  if (Math.abs(y.dot(z)) > 0.999 || y.lengthSq() < 1e-8) {
    y = Math.abs(z.x) < 0.9 ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 1, 0)
  }
  const x = new THREE.Vector3().crossVectors(y, z).normalize()
  y = new THREE.Vector3().crossVectors(z, x).normalize()
  target.makeBasis(x, y, z)
  target.scale(new THREE.Vector3(scale, scale, scale))
  target.setPosition(position.x, position.y, position.z)
  return target
}

/** Matrix that hides an instance (zero scale) without reordering the buffer. */
export function hideInstance(target: THREE.Matrix4): THREE.Matrix4 {
  return target.makeScale(0, 0, 0)
}
