import { LEAF_STRIDE } from '../../simulation/LSystemMorph'

/**
 * Direction the sun shines *from* in the plant scene (unit length): the position of
 * the key `directionalLight` in `App.tsx`, (8, 12, 5), normalised. Leaves turn their
 * upper face towards it.
 */
export const SUN_DIRECTION: readonly [number, number, number] = (() => {
  const l = Math.hypot(8, 12, 5)
  return [8 / l, 12 / l, 5 / l] as const
})()

/**
 * Write one leaf's instance matrix (column-major, 16 floats at `o`).
 *
 * The blade mesh stands on the origin along +Y with its upper face towards +Z
 * (`leafGeometry.ts`), so the matrix puts local +Y along the leaf's heading `d` and
 * local +Z along the part of the light direction `(lx, ly, lz)` that is square to
 * `d`: the leaf may point wherever its twig sends it, but it rolls about that axis
 * until its upper face looks as far towards the light as it can (simple
 * phototropism). Scaled uniformly by `size`.
 *
 * Basis: x = −normalize(light × d), y = d, z = d × (light × d) / |…| — right-handed
 * (x × y = z), so the mesh is never mirrored. This runs for every leaf on every
 * frame of a morph (tens of thousands on the larger species), which is why it is
 * hand-expanded rather than composed through an Object3D; `leafMatrix.test.ts` pins
 * it against three.js and against the maths above.
 */
export function writeLeafMatrix(
  out: Float32Array,
  o: number,
  px: number,
  py: number,
  pz: number,
  dx: number,
  dy: number,
  dz: number,
  size: number,
  lx: number = SUN_DIRECTION[0],
  ly: number = SUN_DIRECTION[1],
  lz: number = SUN_DIRECTION[2]
): void {
  let len = Math.sqrt(dx * dx + dy * dy + dz * dz)
  if (len === 0) {
    dy = 1
    len = 1
  }
  dx /= len
  dy /= len
  dz /= len

  // w = light × d; it vanishes when the leaf points straight at (or away from) the light
  let wx = ly * dz - lz * dy
  let wy = lz * dx - lx * dz
  let wz = lx * dy - ly * dx
  let wl = Math.sqrt(wx * wx + wy * wy + wz * wz)
  if (wl < 1e-6) {
    // any axis square to d will do: take d × the least-aligned world axis
    const ax = Math.abs(dx)
    const ay = Math.abs(dy)
    const az = Math.abs(dz)
    if (ax <= ay && ax <= az) {
      wx = 0
      wy = dz
      wz = -dy
    } else if (ay <= az) {
      wx = -dz
      wy = 0
      wz = dx
    } else {
      wx = dy
      wy = -dx
      wz = 0
    }
    wl = Math.sqrt(wx * wx + wy * wy + wz * wz)
  }
  wx /= wl
  wy /= wl
  wz /= wl

  // normal = d × w
  const nx = dy * wz - dz * wy
  const ny = dz * wx - dx * wz
  const nz = dx * wy - dy * wx

  // columns: x = −w, y = d, z = normal, translation
  out[o] = -wx * size
  out[o + 1] = -wy * size
  out[o + 2] = -wz * size
  out[o + 3] = 0
  out[o + 4] = dx * size
  out[o + 5] = dy * size
  out[o + 6] = dz * size
  out[o + 7] = 0
  out[o + 8] = nx * size
  out[o + 9] = ny * size
  out[o + 10] = nz * size
  out[o + 11] = 0
  out[o + 12] = px
  out[o + 13] = py
  out[o + 14] = pz
  out[o + 15] = 1
}

/** Turn a `sampleLeaves` pose (LEAF_STRIDE floats per leaf) into instance matrices. */
export function writeLeafMatrices(
  pose: Float32Array,
  count: number,
  out: Float32Array,
  light: readonly [number, number, number] = SUN_DIRECTION
): void {
  const [lx, ly, lz] = light
  for (let j = 0; j < count; j++) {
    const s = j * LEAF_STRIDE
    writeLeafMatrix(out, j * 16, pose[s], pose[s + 1], pose[s + 2], pose[s + 3], pose[s + 4], pose[s + 5], pose[s + 6], lx, ly, lz)
  }
}
