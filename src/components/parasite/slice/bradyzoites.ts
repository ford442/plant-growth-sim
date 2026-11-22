/**
 * Bradyzoites inside a tissue cyst: how many to draw, and where each one sits.
 * Pure and deterministic — a rod's pose is a function of `(cystId, k)` alone.
 *
 * Two design rules keep the cyst from flickering as it grows:
 *
 *  1. **A rod's pose does not depend on the cyst's size.** `rodLocal` returns a
 *     point in the unit ball and an orientation; the view multiplies the point
 *     by a reach that grows with the cyst. So adding bradyzoites never moves the
 *     ones already there, and an expanding cyst carries its contents outwards
 *     instead of re-shuffling them.
 *  2. **A rod never pokes through the wall.** Its length is fixed at the real
 *     7 µm (research §2.2), so only its centre moves with the cyst. The reach is
 *     `FIT × radius − half a rod`, which keeps both ends inside `FIT × radius`
 *     whatever the orientation.
 */

import { hash01 } from '../../../simulation/LSystem'
import { STAGE_DEFS } from '../../../simulation/parasite/stages'

/** Real bradyzoite dimensions, µm (research §2.2, via `STAGE_DEFS`). */
export const BRADYZOITE_LENGTH_UM = STAGE_DEFS.bradyzoite.length
export const BRADYZOITE_WIDTH_UM = STAGE_DEFS.bradyzoite.width
const HALF_LENGTH = BRADYZOITE_LENGTH_UM / 2

/**
 * Crescents are drawn only inside cysts at least this wide. Below it a 7 µm rod
 * has almost nowhere to go (a 5 µm young cyst holds two curled zoites, smaller
 * than one stretched out), and the crescents would be a few pixels of noise.
 */
export const MIN_DRAW_DIAMETER_UM = 12

/** Rod ends stay within this fraction of the cyst radius. */
export const RING_FIT = 0.9

/** How far from the cyst centre a unit-ball point of 1 reaches, µm. Zero for a cyst too small to hold a rod. */
export const rodReach = (radiusUm: number) => Math.max(0, RING_FIT * radiusUm - HALF_LENGTH)

/**
 * Splits a draw budget across cysts in proportion to how many bradyzoites each
 * holds. Under budget everyone gets their true count; over it, everyone is
 * scaled by the same factor, so the biggest cysts stay the busiest and a young
 * cyst is never starved to feed a mature one. `eligible[i]` is the count that
 * may be drawn at all (0 for a cyst that is too small); writes `out[i]` and
 * returns the total drawn.
 */
export function allocateBradyzoites(eligible: ArrayLike<number>, n: number, budget: number, out: Uint32Array): number {
  let total = 0
  for (let i = 0; i < n; i++) total += eligible[i]
  const factor = total > budget ? Math.max(0, budget) / total : 1
  let drawn = 0
  for (let i = 0; i < n; i++) {
    out[i] = factor === 1 ? eligible[i] : Math.floor(eligible[i] * factor)
    drawn += out[i]
  }
  return drawn
}

/** Floats per rod in a local-pose cache: unit-ball point (3) + x / y / z axes (9). */
export const ROD_FLOATS = 12

/**
 * Writes rod `k` of cyst `cystId` into `out[at … at + 11]`:
 * `[ux, uy, uz, xx, xy, xz, yx, yy, yz, zx, zy, zz]` — a point uniform in the
 * unit ball, and a right-handed frame whose z axis is the rod's apex direction
 * (the crescent geometry's +Z), with a random roll so the bows point every way.
 */
export function rodLocal(cystId: number, k: number, out: Float32Array, at: number): void {
  // keys never collide: 16 draws per rod, ids and indices stay far below 2^31/16
  const key = (cystId * 100_003 + k) * 16
  const h = (j: number) => hash01(key + j)

  // apex direction, uniform on the sphere
  const zc = 2 * h(0) - 1
  const za = 2 * Math.PI * h(1)
  const zs = Math.sqrt(Math.max(0, 1 - zc * zc))
  const zx = zs * Math.cos(za)
  const zy = zc
  const zz = zs * Math.sin(za)

  // a frame around it: x = helper × z, y = z × x (so x × y = z — never mirrored)
  const hx = Math.abs(zy) > 0.95 ? 1 : 0
  const hy = hx ? 0 : 1
  let xx = hy * zz // helper × z with helper = (hx, hy, 0)
  let xy = -hx * zz
  let xz = hx * zy - hy * zx
  const xl = Math.hypot(xx, xy, xz) || 1
  xx /= xl
  xy /= xl
  xz /= xl
  const yx = zy * xz - zz * xy
  const yy = zz * xx - zx * xz
  const yz = zx * xy - zy * xx

  // roll about z
  const roll = 2 * Math.PI * h(2)
  const c = Math.cos(roll)
  const s = Math.sin(roll)

  // position, uniform in the unit ball
  const pr = Math.cbrt(h(3))
  const pc = 2 * h(4) - 1
  const pa = 2 * Math.PI * h(5)
  const ps = Math.sqrt(Math.max(0, 1 - pc * pc))

  out[at] = pr * ps * Math.cos(pa)
  out[at + 1] = pr * pc
  out[at + 2] = pr * ps * Math.sin(pa)
  out[at + 3] = xx * c + yx * s
  out[at + 4] = xy * c + yy * s
  out[at + 5] = xz * c + yz * s
  out[at + 6] = -xx * s + yx * c
  out[at + 7] = -xy * s + yy * c
  out[at + 8] = -xz * s + yz * c
  out[at + 9] = zx
  out[at + 10] = zy
  out[at + 11] = zz
}

/**
 * Writes rod `local` into a column-major 4×4 instance matrix at `m[o … o + 15]`
 * with its centre at (`tx`, `ty`, `tz`). The crescent geometry is already in
 * micrometres, so there is no scale.
 */
export function writeRodMatrix(m: Float32Array, o: number, local: Float32Array, li: number, tx: number, ty: number, tz: number): void {
  m[o] = local[li + 3]
  m[o + 1] = local[li + 4]
  m[o + 2] = local[li + 5]
  m[o + 3] = 0
  m[o + 4] = local[li + 6]
  m[o + 5] = local[li + 7]
  m[o + 6] = local[li + 8]
  m[o + 7] = 0
  m[o + 8] = local[li + 9]
  m[o + 9] = local[li + 10]
  m[o + 10] = local[li + 11]
  m[o + 11] = 0
  m[o + 12] = tx
  m[o + 13] = ty
  m[o + 14] = tz
  m[o + 15] = 1
}
