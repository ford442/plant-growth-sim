import { hash01 } from '../../simulation/LSystem'
import { CELL_W, rootSpread, SOIL_COLS, SOIL_WIDTH, type RootSystemDef, type SoilState } from '../../simulation/SoilField'

/**
 * Drawn root system: a deterministic skeleton of the species' root
 * architecture at full development (taproot + laterals, a fibrous fan, or
 * rhizomes with adventitious roots). The view scales it to the current root
 * front and clips it at hardpans, so it shows the same root zone the soil
 * simulation uses for uptake. Pure — no Three.js.
 *
 * Segments are stored parents-first and each one names the segment it hangs
 * from (`parent`), so a position on any root can be followed back up to the
 * stem base — the path the Roots view's water particles take.
 */
export interface RootSegment {
  x0: number // m, horizontal (the end nearer the stem)
  z0: number // m, depth (positive down)
  x1: number // the end nearer the tip
  z1: number
  order: number // 0 = main axis
  /** Index of the segment this one grows from (always smaller than its own index), or −1 when it starts at the stem base. */
  parent: number
}

const STEP = 0.06 // m per segment
const MAX_SEGMENTS = 2400
const HALF = SOIL_WIDTH / 2 - 0.05

interface Axis {
  x: number
  z: number
  angle: number // 0 = straight down, ±π/2 = horizontal (+ = towards +x)
  length: number
  order: number
  gravitropism: number // 0 (keeps its angle) … 1 (turns down quickly)
  parent: number // segment this axis springs from (−1: the stem base)
}

export function rootSkeleton(def: RootSystemDef, seed = 1): RootSegment[] {
  const out: RootSegment[] = []
  let k = seed * 7919
  const rnd = () => hash01(k++)
  const width = rootSpread(def, def.maxDepth)
  const queue: Axis[] = []

  if (def.kind === 'taproot') {
    queue.push({ x: 0, z: 0, angle: 0, length: def.maxDepth, order: 0, gravitropism: 0.25, parent: -1 })
  } else if (def.kind === 'fibrous') {
    const n = 9
    for (let i = 0; i < n; i++) {
      const a = (i / (n - 1) - 0.5) * 1.9
      queue.push({ x: (rnd() - 0.5) * 0.08, z: 0.02, angle: a, length: def.maxDepth * (0.75 + 0.4 * rnd()), order: 0, gravitropism: 0.08, parent: -1 })
    }
  } else {
    for (const side of [-1, 1]) {
      queue.push({ x: 0, z: 0.06, angle: (side * Math.PI) / 2, length: width, order: 0, gravitropism: 0, parent: -1 })
    }
  }

  while (queue.length > 0 && out.length < MAX_SEGMENTS) {
    const a = queue.shift()!
    let { x, z, angle } = a
    let parent = a.parent
    const steps = Math.max(1, Math.round(a.length / STEP))
    for (let s = 0; s < steps && out.length < MAX_SEGMENTS; s++) {
      angle += (rnd() - 0.5) * (a.order === 0 ? 0.3 : 0.45)
      angle -= angle * a.gravitropism * 0.25 // bend back towards straight down
      // rhizomes run sideways just under the surface
      if (def.kind === 'rhizome' && a.order === 0) angle = Math.sign(a.angle) * (Math.PI / 2 - 0.08) + (rnd() - 0.5) * 0.12
      const x1 = Math.max(-HALF, Math.min(HALF, x + Math.sin(angle) * STEP))
      const z1 = Math.max(0.01, Math.min(def.maxDepth, z + Math.cos(angle) * STEP))
      out.push({ x0: x, z0: z, x1, z1, order: a.order, parent })
      parent = out.length - 1
      x = x1
      z = z1

      // branching
      const along = s / steps
      if (a.order === 0 && def.kind === 'taproot' && s % 2 === 1 && along < 0.85) {
        const side = rnd() < 0.5 ? -1 : 1
        const reach = width * (1 - 0.55 * (z / def.maxDepth)) * (0.55 + 0.45 * rnd())
        queue.push({ x, z, angle: side * (1.05 + 0.4 * rnd()), length: reach, order: 1, gravitropism: 0.06, parent })
      } else if (a.order === 0 && def.kind === 'fibrous' && rnd() < 0.3) {
        const side = rnd() < 0.5 ? -1 : 1
        queue.push({ x, z, angle: angle + side * (0.7 + 0.5 * rnd()), length: 0.2 + 0.25 * rnd(), order: 1, gravitropism: 0.1, parent })
      } else if (a.order === 0 && def.kind === 'rhizome' && s % 3 === 2) {
        queue.push({ x, z, angle: (rnd() - 0.5) * 0.6, length: def.maxDepth * (0.4 + 0.6 * rnd()), order: 1, gravitropism: 0.3, parent })
      } else if (a.order === 1 && s % 3 === 2 && rnd() < 0.55) {
        const side = rnd() < 0.5 ? -1 : 1
        queue.push({ x, z, angle: angle + side * (0.6 + 0.6 * rnd()), length: 0.08 + 0.14 * rnd(), order: 2, gravitropism: 0.05, parent })
      }
    }
  }
  return out
}

/**
 * The skeleton as it stands now: scaled to the current root front and clipped
 * at hardpans, exactly what the Roots view draws. Typed arrays so the view can
 * refresh it a few times a second without allocating. Indexed like the skeleton.
 */
export interface PosedRoots {
  count: number
  x0: Float32Array
  z0: Float32Array
  x1: Float32Array
  z1: Float32Array
  /** 1 when the segment is drawn (its start is above the front of its column). */
  visible: Uint8Array
  /**
   * 1 when the segment is drawn *and* every segment between it and the stem is
   * drawn in full: a continuous path water can follow back to the stem base.
   */
  connected: Uint8Array
}

export function createPosedRoots(count: number): PosedRoots {
  return {
    count,
    x0: new Float32Array(count),
    z0: new Float32Array(count),
    x1: new Float32Array(count),
    z1: new Float32Array(count),
    visible: new Uint8Array(count),
    connected: new Uint8Array(count),
  }
}

/** Soil column under a horizontal position (m). */
const columnAt = (x: number) => Math.max(0, Math.min(SOIL_COLS - 1, Math.floor((x + SOIL_WIDTH / 2) / CELL_W)))

export function poseRoots(
  skeleton: readonly RootSegment[],
  def: RootSystemDef,
  soil: Pick<SoilState, 'rootDepth' | 'rootFront'>,
  out: PosedRoots = createPosedRoots(skeleton.length),
): PosedRoots {
  const sz = Math.min(1, soil.rootDepth / def.maxDepth)
  const sx = rootSpread(def, soil.rootDepth) / rootSpread(def, def.maxDepth)
  // a segment ended where it was clipped: its children (which start at its full end) hang in the air
  const whole = new Uint8Array(skeleton.length)
  for (let i = 0; i < skeleton.length; i++) {
    const seg = skeleton[i]
    const x0 = seg.x0 * sx
    const z0 = seg.z0 * sz
    const f = soil.rootFront[columnAt(x0)]
    out.visible[i] = 0
    out.connected[i] = 0
    if (z0 > f) continue
    let xe = seg.x1 * sx
    let ze = seg.z1 * sz
    let full = 1
    if (ze > f) {
      // the root stops at the front / hardpan of its column: draw the part above it
      const t = (f - z0) / Math.max(1e-6, ze - z0)
      xe = x0 + (xe - x0) * t
      ze = f
      full = 0
    }
    out.x0[i] = x0
    out.z0[i] = z0
    out.x1[i] = xe
    out.z1[i] = ze
    out.visible[i] = 1
    whole[i] = full
    const p = seg.parent
    out.connected[i] = p < 0 || (out.connected[p] && whole[p]) ? 1 : 0
  }
  out.count = skeleton.length
  return out
}

/**
 * One skeleton plus its current pose, shared by everything that draws or
 * animates the roots (the root lines, the water flow) so they cannot disagree.
 * `update` re-poses only when the front moved; `version` counts re-poses, so
 * each consumer can tell whether it has seen the current pose.
 */
export class RootPose {
  readonly posed: PosedRoots
  version = 0
  private key = ''

  constructor(
    readonly skeleton: readonly RootSegment[],
    readonly def: RootSystemDef,
  ) {
    this.posed = createPosedRoots(skeleton.length)
  }

  update(soil: Pick<SoilState, 'rootDepth' | 'rootFront'>): PosedRoots {
    const key = `${soil.rootDepth.toFixed(3)}|${soil.rootFront.map((f) => f.toFixed(2)).join(',')}`
    if (key !== this.key) {
      this.key = key
      poseRoots(this.skeleton, this.def, soil, this.posed)
      this.version++
    }
    return this.posed
  }
}
