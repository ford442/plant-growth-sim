import { LEAF_STRIDE } from '../../simulation/LSystemMorph'

/**
 * Write one leaf's instance matrix (column-major, 16 floats at `o`).
 *
 * This is `Object3D.lookAt(position + direction)` followed by `rotateX(π/2)` and
 * a uniform scale — what the leaf mesh did through an Object3D — expanded by
 * hand, because the morph re-poses every leaf every frame (tens of thousands on
 * the larger species) and composing an Object3D per leaf is far too slow.
 * `leafMatrix.test.ts` pins it against three.js itself.
 *
 * Basis: x = normalize(up × d), y = d × x (up = +Y). After the rotateX the
 * leaf's long axis (local Y) lies along `d` and its normal along -y.
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
  size: number
): void {
  let len = Math.sqrt(dx * dx + dy * dy + dz * dz)
  if (len === 0) {
    dz = 1
    len = 1
  }
  let zx = dx / len
  let zy = dy / len
  let zz = dz / len

  // up × z with up = (0, 1, 0)
  let xx = zz
  let xz = -zx
  if (xx === 0 && xz === 0) {
    // heading straight up/down: nudge it exactly as Matrix4.lookAt does
    zz += 0.0001
    const n = Math.sqrt(zx * zx + zy * zy + zz * zz)
    zx /= n
    zy /= n
    zz /= n
    xx = zz
    xz = -zx
  }
  const xl = Math.sqrt(xx * xx + xz * xz)
  xx /= xl
  xz /= xl

  // y = z × x (x has no Y component)
  const yx = zy * xz
  const yy = zz * xx - zx * xz
  const yz = -zy * xx

  // columns: x, z (the long axis), -y, translation
  out[o] = xx * size
  out[o + 1] = 0
  out[o + 2] = xz * size
  out[o + 3] = 0
  out[o + 4] = zx * size
  out[o + 5] = zy * size
  out[o + 6] = zz * size
  out[o + 7] = 0
  out[o + 8] = -yx * size
  out[o + 9] = -yy * size
  out[o + 10] = -yz * size
  out[o + 11] = 0
  out[o + 12] = px
  out[o + 13] = py
  out[o + 14] = pz
  out[o + 15] = 1
}

/** Turn a `sampleLeaves` pose (LEAF_STRIDE floats per leaf) into instance matrices. */
export function writeLeafMatrices(pose: Float32Array, count: number, out: Float32Array): void {
  for (let j = 0; j < count; j++) {
    const s = j * LEAF_STRIDE
    writeLeafMatrix(out, j * 16, pose[s], pose[s + 1], pose[s + 2], pose[s + 3], pose[s + 4], pose[s + 5], pose[s + 6])
  }
}
