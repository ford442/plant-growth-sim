/**
 * Which cyst is under the pointer. A ray against a few hundred spheres is far
 * cheaper (and more predictable) than raycasting 200 sphere meshes triangle by
 * triangle, so the view picks with this rather than R3F's mesh raycaster.
 */

/**
 * `spheres` holds `x, y, z, radius` for each of the first `n` cysts, in scene
 * (µm) space; the ray is in the same space. Returns the index of the nearest
 * sphere the ray enters in front of its origin, or −1. `minRadius` widens tiny
 * cysts so a 5 µm one is still something you can point at.
 */
export function pickSphere(
  ox: number,
  oy: number,
  oz: number,
  dx: number,
  dy: number,
  dz: number,
  spheres: Float32Array,
  n: number,
  minRadius = 0,
): number {
  const dl = Math.hypot(dx, dy, dz) || 1
  dx /= dl
  dy /= dl
  dz /= dl
  let best = -1
  let bestT = Infinity
  for (let i = 0; i < n; i++) {
    const o = i * 4
    const r = Math.max(spheres[o + 3], minRadius)
    const mx = spheres[o] - ox
    const my = spheres[o + 1] - oy
    const mz = spheres[o + 2] - oz
    const along = mx * dx + my * dy + mz * dz // distance to the closest approach
    const off2 = mx * mx + my * my + mz * mz - along * along
    if (off2 > r * r) continue
    const half = Math.sqrt(r * r - off2)
    const t = along - half > 0 ? along - half : along + half // entering, or already inside
    if (t > 0 && t < bestT) {
      bestT = t
      best = i
    }
  }
  return best
}
