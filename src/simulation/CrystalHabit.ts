/**
 * Crystal habit geometry — pure math, no Three.js objects.
 *
 * A crystal's outer shape is modelled with the kinetic Wulff construction:
 * every face family {hkl} is a set of symmetry-equivalent planes n·x = h, where
 * the central distance h advances at that family's normal growth velocity.
 * The crystal is the intersection of all half-spaces n·x ≤ h. Slow faces end
 * up dominating the habit; fast faces grow themselves out of existence.
 *
 * Coordinates: crystallographic c-axis → +Y (Three.js up), a1 → +X.
 */

export type Vec3 = [number, number, number]

export type CrystalSystem = 'cubic' | 'hexagonal' | 'trigonal' | 'orthorhombic'

/** Point groups needed by the current presets (Hermann–Mauguin symbols). */
export type PointGroup = 'm-3m' | '6/mmm' | '-3m' | '32' | 'mmm'

/** Unit-cell edge lengths in Å (angles are implied by the crystal system). */
export interface CellLengths {
  a: number
  b: number
  c: number
}

export interface FacePlane {
  normal: Vec3 // unit outward normal
  family: number // index into the preset's face-family list
}

export interface PolyFace {
  family: number // -1 = bounding box (only if the planes don't close the shape)
  normal: Vec3
  verts: Vec3[] // convex loop, CCW seen from outside
}

export interface Polyhedron {
  faces: PolyFace[]
}

// ---------------------------------------------------------------------------
// Small vector helpers
// ---------------------------------------------------------------------------

const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
const cross = (a: Vec3, b: Vec3): Vec3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
]
const len = (a: Vec3) => Math.hypot(a[0], a[1], a[2])
const normalize = (a: Vec3): Vec3 => {
  const l = len(a) || 1
  return [a[0] / l, a[1] / l, a[2] / l]
}

type Mat3 = [Vec3, Vec3, Vec3] // rows
const mul = (m: Mat3, v: Vec3): Vec3 => [dot(m[0], v), dot(m[1], v), dot(m[2], v)]

function rotY(deg: number): Mat3 {
  const r = (deg * Math.PI) / 180
  const c = Math.cos(r)
  const s = Math.sin(r)
  return [
    [c, 0, s],
    [0, 1, 0],
    [-s, 0, c],
  ]
}

const C2X: Mat3 = [
  [1, 0, 0],
  [0, -1, 0],
  [0, 0, -1],
]
const INV: Mat3 = [
  [-1, 0, 0],
  [0, -1, 0],
  [0, 0, -1],
]
const MX: Mat3 = [
  [-1, 0, 0],
  [0, 1, 0],
  [0, 0, 1],
]
const MY: Mat3 = [
  [1, 0, 0],
  [0, -1, 0],
  [0, 0, 1],
]
const MZ: Mat3 = [
  [1, 0, 0],
  [0, 1, 0],
  [0, 0, -1],
]
// 3-fold about [111] (cyclic permutation) — generates the cubic groups with C4
const C3_111: Mat3 = [
  [0, 0, 1],
  [1, 0, 0],
  [0, 1, 0],
]

/** Generators for each point group, expressed in Y-up Cartesian coordinates. */
const GENERATORS: Record<PointGroup, Mat3[]> = {
  'm-3m': [C3_111, rotY(90), INV],
  '6/mmm': [rotY(60), C2X, INV],
  '-3m': [rotY(120), C2X, INV],
  '32': [rotY(120), C2X],
  mmm: [MX, MY, MZ],
}

// ---------------------------------------------------------------------------
// Miller indices → face normals
// ---------------------------------------------------------------------------

/**
 * Pole (face normal) of plane (hkl) in Y-up Cartesian coordinates.
 * For hexagonal/trigonal crystals pass the Miller–Bravais (h k i l) as [h, k, l].
 */
export function millerToNormal(
  system: CrystalSystem,
  cell: CellLengths,
  miller: [number, number, number]
): Vec3 {
  const [h, k, l] = miller
  let g: Vec3 // math coords: x ∥ a, z ∥ c
  if (system === 'hexagonal' || system === 'trigonal') {
    // reciprocal basis of a hexagonal lattice with a1 ∥ x
    g = [h / cell.a, (h + 2 * k) / (Math.sqrt(3) * cell.a), l / cell.c]
  } else if (system === 'orthorhombic') {
    g = [h / cell.a, k / cell.b, l / cell.c]
  } else {
    g = [h, k, l]
  }
  // math (x, y, z) → Three (x, z, −y): proper rotation that puts c on +Y
  return normalize([g[0], g[2], -g[1]])
}

/** All symmetry-equivalent normals of a face (orbit under the point group). */
export function symmetryOrbit(n: Vec3, group: PointGroup): Vec3[] {
  const gens = GENERATORS[group]
  const out: Vec3[] = [normalize(n)]
  const seen = (v: Vec3) => out.some((o) => Math.abs(o[0] - v[0]) + Math.abs(o[1] - v[1]) + Math.abs(o[2] - v[2]) < 1e-6)
  for (let i = 0; i < out.length; i++) {
    for (const g of gens) {
      const v = mul(g, out[i])
      if (!seen(v)) out.push(v)
    }
  }
  return out
}

export interface FaceFamilySpec {
  miller: [number, number, number]
}

/** Expand face families into the full set of oriented planes. */
export function familyPlanes(
  families: FaceFamilySpec[],
  system: CrystalSystem,
  group: PointGroup,
  cell: CellLengths
): FacePlane[] {
  const planes: FacePlane[] = []
  families.forEach((f, family) => {
    for (const normal of symmetryOrbit(millerToNormal(system, cell, f.miller), group)) {
      planes.push({ normal, family })
    }
  })
  return planes
}

/** Angle (degrees) between a face pole and the c-axis — handy for docs/labels. */
export function poleAngleToC(n: Vec3): number {
  return (Math.acos(Math.min(1, Math.abs(n[1]))) * 180) / Math.PI
}

// ---------------------------------------------------------------------------
// Half-space intersection by successive plane clipping
// ---------------------------------------------------------------------------

function boundingCube(B: number): PolyFace[] {
  const p = (x: number, y: number, z: number): Vec3 => [x * B, y * B, z * B]
  // each loop is CCW seen from outside
  return [
    { family: -1, normal: [1, 0, 0], verts: [p(1, -1, -1), p(1, 1, -1), p(1, 1, 1), p(1, -1, 1)] },
    { family: -1, normal: [-1, 0, 0], verts: [p(-1, -1, -1), p(-1, -1, 1), p(-1, 1, 1), p(-1, 1, -1)] },
    { family: -1, normal: [0, 1, 0], verts: [p(-1, 1, -1), p(-1, 1, 1), p(1, 1, 1), p(1, 1, -1)] },
    { family: -1, normal: [0, -1, 0], verts: [p(-1, -1, -1), p(1, -1, -1), p(1, -1, 1), p(-1, -1, 1)] },
    { family: -1, normal: [0, 0, 1], verts: [p(-1, -1, 1), p(1, -1, 1), p(1, 1, 1), p(-1, 1, 1)] },
    { family: -1, normal: [0, 0, -1], verts: [p(-1, -1, -1), p(-1, 1, -1), p(1, 1, -1), p(1, -1, -1)] },
  ]
}

function orderLoop(points: Vec3[], n: Vec3): Vec3[] {
  const c: Vec3 = [0, 0, 0]
  for (const p of points) {
    c[0] += p[0] / points.length
    c[1] += p[1] / points.length
    c[2] += p[2] / points.length
  }
  const ref: Vec3 = Math.abs(n[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0]
  const u = normalize(cross(ref, n))
  const v = cross(n, u)
  return points
    .map((p) => {
      const d = sub(p, c)
      return { p, a: Math.atan2(dot(d, v), dot(d, u)) }
    })
    .sort((x, y) => x.a - y.a)
    .map((x) => x.p)
}

function dedupe(points: Vec3[], tol: number): Vec3[] {
  const out: Vec3[] = []
  for (const p of points) {
    if (!out.some((o) => Math.abs(o[0] - p[0]) + Math.abs(o[1] - p[1]) + Math.abs(o[2] - p[2]) < tol)) out.push(p)
  }
  return out
}

/**
 * Convex polyhedron bounded by planes n·x ≤ h[family].
 * `h` holds one central distance per face family (all > 0).
 */
export function buildPolyhedron(planes: FacePlane[], h: number[]): Polyhedron {
  const scale = Math.max(1e-9, ...h)
  const eps = scale * 1e-9
  const tol = scale * 1e-7
  let faces = boundingCube(scale * 8)

  for (const plane of planes) {
    const n = plane.normal
    const d = h[plane.family]
    let clipped = false
    const cap: Vec3[] = []
    const next: PolyFace[] = []

    for (const face of faces) {
      const out: Vec3[] = []
      const vs = face.verts
      for (let i = 0; i < vs.length; i++) {
        const cur = vs[i]
        const prev = vs[(i + vs.length - 1) % vs.length]
        const dc = dot(n, cur) - d
        const dp = dot(n, prev) - d
        if (dc > eps) clipped = true
        if (dc <= eps) {
          if (dp > eps) {
            const t = dp / (dp - dc)
            const x: Vec3 = [prev[0] + t * (cur[0] - prev[0]), prev[1] + t * (cur[1] - prev[1]), prev[2] + t * (cur[2] - prev[2])]
            out.push(x)
            cap.push(x)
          }
          out.push(cur)
          if (Math.abs(dc) <= eps) cap.push(cur)
        } else if (dp <= eps) {
          const t = dp / (dp - dc)
          const x: Vec3 = [prev[0] + t * (cur[0] - prev[0]), prev[1] + t * (cur[1] - prev[1]), prev[2] + t * (cur[2] - prev[2])]
          out.push(x)
          cap.push(x)
        }
      }
      const loop = dedupe(out, tol)
      if (loop.length >= 3) next.push({ ...face, verts: loop })
    }

    if (!clipped) continue
    const capLoop = dedupe(cap, tol)
    if (capLoop.length >= 3) {
      next.push({ family: plane.family, normal: n, verts: orderLoop(capLoop, n) })
    }
    faces = next
  }

  return { faces }
}

// ---------------------------------------------------------------------------
// Measurements
// ---------------------------------------------------------------------------

function faceArea(f: PolyFace): number {
  let a: Vec3 = [0, 0, 0]
  const v0 = f.verts[0]
  for (let i = 1; i < f.verts.length - 1; i++) {
    const c = cross(sub(f.verts[i], v0), sub(f.verts[i + 1], v0))
    a = [a[0] + c[0], a[1] + c[1], a[2] + c[2]]
  }
  return len(a) / 2
}

export function polyhedronVolume(p: Polyhedron): number {
  let v = 0
  for (const f of p.faces) {
    const v0 = f.verts[0]
    for (let i = 1; i < f.verts.length - 1; i++) {
      v += dot(v0, cross(f.verts[i], f.verts[i + 1])) / 6
    }
  }
  return Math.abs(v)
}

/** Radius of the sphere with the same volume — a shape-independent size. */
export function equivalentRadius(volume: number): number {
  return Math.cbrt((3 * volume) / (4 * Math.PI))
}

/** Support function: how far the crystal extends along unit direction n. */
export function supportDistance(p: Polyhedron, n: Vec3): number {
  let m = -Infinity
  for (const f of p.faces) for (const v of f.verts) m = Math.max(m, dot(n, v))
  return m
}

/** Total exposed area per face family (index = family). */
export function familyAreas(p: Polyhedron, familyCount: number): number[] {
  const out = new Array(familyCount).fill(0)
  for (const f of p.faces) if (f.family >= 0) out[f.family] += faceArea(f)
  return out
}

/** Length along c (Y) and maximum width perpendicular to it. */
export function polyhedronExtents(p: Polyhedron): { length: number; width: number } {
  let minY = Infinity
  let maxY = -Infinity
  let maxR = 0
  for (const f of p.faces) {
    for (const v of f.verts) {
      minY = Math.min(minY, v[1])
      maxY = Math.max(maxY, v[1])
      maxR = Math.max(maxR, Math.hypot(v[0], v[2]))
    }
  }
  return { length: maxY - minY, width: 2 * maxR }
}

// ---------------------------------------------------------------------------
// Mesh export (plain typed arrays — the view wraps them in BufferGeometry)
// ---------------------------------------------------------------------------

export interface HabitMesh {
  positions: Float32Array
  normals: Float32Array
  /** face family per vertex (−1 for bounding faces) */
  families: Int8Array
}

/** Flat-shaded triangle soup (fan triangulation of each convex face). */
export function polyhedronToMesh(p: Polyhedron, scale = 1): HabitMesh {
  let tris = 0
  for (const f of p.faces) tris += f.verts.length - 2
  const positions = new Float32Array(tris * 9)
  const normals = new Float32Array(tris * 9)
  const families = new Int8Array(tris * 3)
  let o = 0
  let fo = 0
  for (const f of p.faces) {
    const v0 = f.verts[0]
    for (let i = 1; i < f.verts.length - 1; i++) {
      for (const v of [v0, f.verts[i], f.verts[i + 1]]) {
        positions[o] = v[0] * scale
        positions[o + 1] = v[1] * scale
        positions[o + 2] = v[2] * scale
        normals[o] = f.normal[0]
        normals[o + 1] = f.normal[1]
        normals[o + 2] = f.normal[2]
        families[fo++] = f.family
        o += 3
      }
    }
  }
  return { positions, normals, families }
}

/** Edge list as line-segment pairs (for phantoms / wireframe overlays). */
export function polyhedronEdges(p: Polyhedron, scale = 1): Float32Array {
  let n = 0
  for (const f of p.faces) n += f.verts.length
  const out = new Float32Array(n * 6)
  let o = 0
  for (const f of p.faces) {
    for (let i = 0; i < f.verts.length; i++) {
      const a = f.verts[i]
      const b = f.verts[(i + 1) % f.verts.length]
      out.set([a[0] * scale, a[1] * scale, a[2] * scale, b[0] * scale, b[1] * scale, b[2] * scale], o)
      o += 6
    }
  }
  return out
}

/** Area-weighted centroid of each family's largest face (for labels). */
export function familyLabelAnchors(p: Polyhedron): Map<number, { pos: Vec3; normal: Vec3; area: number }> {
  const out = new Map<number, { pos: Vec3; normal: Vec3; area: number }>()
  for (const f of p.faces) {
    if (f.family < 0) continue
    const area = faceArea(f)
    const prev = out.get(f.family)
    // prefer faces that look towards the default camera (+Z, slightly up)
    const score = area * (1.2 + f.normal[2] + 0.3 * f.normal[1])
    if (prev && prev.area >= score) continue
    const c: Vec3 = [0, 0, 0]
    for (const v of f.verts) {
      c[0] += v[0] / f.verts.length
      c[1] += v[1] / f.verts.length
      c[2] += v[2] / f.verts.length
    }
    out.set(f.family, { pos: c, normal: f.normal, area: score })
  }
  return out
}
