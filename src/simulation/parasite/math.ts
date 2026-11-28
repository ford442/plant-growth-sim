/**
 * Small pure helpers shared by the parasite simulation modules: clamping, a
 * deterministic RNG (so tests and replays are reproducible) and plain-object
 * 3-vectors. No Three.js here — views convert these to Vector3 themselves.
 */

export const clamp01 = (x: number) => (x < 0 ? 0 : x > 1 ? 1 : x)
export const clamp = (x: number, lo: number, hi: number) => (x < lo ? lo : x > hi ? hi : x)
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t
export const TAU = Math.PI * 2

export interface Vec3 {
  x: number
  y: number
  z: number
}

export const vec3 = (x = 0, y = 0, z = 0): Vec3 => ({ x, y, z })
export const addV = (a: Vec3, b: Vec3): Vec3 => ({ x: a.x + b.x, y: a.y + b.y, z: a.z + b.z })
export const subV = (a: Vec3, b: Vec3): Vec3 => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z })
export const scaleV = (a: Vec3, s: number): Vec3 => ({ x: a.x * s, y: a.y * s, z: a.z * s })
export const dotV = (a: Vec3, b: Vec3) => a.x * b.x + a.y * b.y + a.z * b.z
export const lengthV = (a: Vec3) => Math.sqrt(dotV(a, a))
export const distV = (a: Vec3, b: Vec3) => lengthV(subV(a, b))

export function normalizeV(a: Vec3): Vec3 {
  const l = lengthV(a)
  return l > 1e-9 ? scaleV(a, 1 / l) : vec3(0, 0, 1)
}

export function crossV(a: Vec3, b: Vec3): Vec3 {
  return {
    x: a.y * b.z - a.z * b.y,
    y: a.z * b.x - a.x * b.z,
    z: a.x * b.y - a.y * b.x,
  }
}

/** Rodrigues rotation of `v` about unit axis `axis` by `angle` radians. */
export function rotateAround(v: Vec3, axis: Vec3, angle: number): Vec3 {
  const c = Math.cos(angle)
  const s = Math.sin(angle)
  const k = normalizeV(axis)
  const kv = crossV(k, v)
  const kkv = dotV(k, v) * (1 - c)
  return {
    x: v.x * c + kv.x * s + k.x * kkv,
    y: v.y * c + kv.y * s + k.y * kkv,
    z: v.z * c + kv.z * s + k.z * kkv,
  }
}

/** Any unit vector perpendicular to `n` — used to build the helical frame. */
export function perpendicularTo(n: Vec3): Vec3 {
  const axis = Math.abs(n.x) < 0.9 ? vec3(1, 0, 0) : vec3(0, 1, 0)
  return normalizeV(crossV(n, axis))
}

/**
 * Deterministic 32-bit RNG (mulberry32). The sim carries its seed in state so a
 * run replays identically — required for the parasite unit tests.
 */
export interface Rng {
  seed: number
}

export const createRng = (seed = 1): Rng => ({ seed: seed >>> 0 || 1 })

/** Advances `rng` in place and returns a float in [0, 1). */
export function nextFloat(rng: Rng): number {
  rng.seed = (rng.seed + 0x6d2b79f5) >>> 0
  let t = rng.seed
  t = Math.imul(t ^ (t >>> 15), t | 1)
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296
}

export const nextRange = (rng: Rng, lo: number, hi: number) => lo + (hi - lo) * nextFloat(rng)

/** Unit vector with uniform direction on the sphere. */
export function nextDirection(rng: Rng): Vec3 {
  const z = nextRange(rng, -1, 1)
  const a = nextRange(rng, 0, TAU)
  const r = Math.sqrt(Math.max(0, 1 - z * z))
  return { x: Math.cos(a) * r, y: Math.sin(a) * r, z }
}

/**
 * Probability that an event with rate `perHour` fires over `dtHours`, as an
 * exponential-waiting-time draw. Stable for large dt, unlike `rate * dt`.
 */
export function fires(rng: Rng, perHour: number, dtHours: number): boolean {
  if (perHour <= 0 || dtHours <= 0) return false
  return nextFloat(rng) < 1 - Math.exp(-perHour * dtHours)
}
