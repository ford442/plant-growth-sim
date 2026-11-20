import { hash01 } from '../../simulation/LSystem'
import { rootSpread, SOIL_WIDTH, type RootSystemDef } from '../../simulation/SoilField'

/**
 * Drawn root system: a deterministic skeleton of the species' root
 * architecture at full development (taproot + laterals, a fibrous fan, or
 * rhizomes with adventitious roots). The view scales it to the current root
 * front and clips it at hardpans, so it shows the same root zone the soil
 * simulation uses for uptake. Pure — no Three.js.
 */
export interface RootSegment {
  x0: number // m, horizontal
  z0: number // m, depth (positive down)
  x1: number
  z1: number
  order: number // 0 = main axis
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
}

export function rootSkeleton(def: RootSystemDef, seed = 1): RootSegment[] {
  const out: RootSegment[] = []
  let k = seed * 7919
  const rnd = () => hash01(k++)
  const width = rootSpread(def, def.maxDepth)
  const queue: Axis[] = []

  if (def.kind === 'taproot') {
    queue.push({ x: 0, z: 0, angle: 0, length: def.maxDepth, order: 0, gravitropism: 0.25 })
  } else if (def.kind === 'fibrous') {
    const n = 9
    for (let i = 0; i < n; i++) {
      const a = (i / (n - 1) - 0.5) * 1.9
      queue.push({ x: (rnd() - 0.5) * 0.08, z: 0.02, angle: a, length: def.maxDepth * (0.75 + 0.4 * rnd()), order: 0, gravitropism: 0.08 })
    }
  } else {
    for (const side of [-1, 1]) {
      queue.push({ x: 0, z: 0.06, angle: (side * Math.PI) / 2, length: width, order: 0, gravitropism: 0 })
    }
  }

  while (queue.length > 0 && out.length < MAX_SEGMENTS) {
    const a = queue.shift()!
    let { x, z, angle } = a
    const steps = Math.max(1, Math.round(a.length / STEP))
    for (let s = 0; s < steps && out.length < MAX_SEGMENTS; s++) {
      angle += (rnd() - 0.5) * (a.order === 0 ? 0.3 : 0.45)
      angle -= angle * a.gravitropism * 0.25 // bend back towards straight down
      // rhizomes run sideways just under the surface
      if (def.kind === 'rhizome' && a.order === 0) angle = Math.sign(a.angle) * (Math.PI / 2 - 0.08) + (rnd() - 0.5) * 0.12
      const x1 = Math.max(-HALF, Math.min(HALF, x + Math.sin(angle) * STEP))
      const z1 = Math.max(0.01, Math.min(def.maxDepth, z + Math.cos(angle) * STEP))
      out.push({ x0: x, z0: z, x1, z1, order: a.order })
      x = x1
      z = z1

      // branching
      const along = s / steps
      if (a.order === 0 && def.kind === 'taproot' && s % 2 === 1 && along < 0.85) {
        const side = rnd() < 0.5 ? -1 : 1
        const reach = width * (1 - 0.55 * (z / def.maxDepth)) * (0.55 + 0.45 * rnd())
        queue.push({ x, z, angle: side * (1.05 + 0.4 * rnd()), length: reach, order: 1, gravitropism: 0.06 })
      } else if (a.order === 0 && def.kind === 'fibrous' && rnd() < 0.3) {
        const side = rnd() < 0.5 ? -1 : 1
        queue.push({ x, z, angle: angle + side * (0.7 + 0.5 * rnd()), length: 0.2 + 0.25 * rnd(), order: 1, gravitropism: 0.1 })
      } else if (a.order === 0 && def.kind === 'rhizome' && s % 3 === 2) {
        queue.push({ x, z, angle: (rnd() - 0.5) * 0.6, length: def.maxDepth * (0.4 + 0.6 * rnd()), order: 1, gravitropism: 0.3 })
      } else if (a.order === 1 && s % 3 === 2 && rnd() < 0.55) {
        const side = rnd() < 0.5 ? -1 : 1
        queue.push({ x, z, angle: angle + side * (0.6 + 0.6 * rnd()), length: 0.08 + 0.14 * rnd(), order: 2, gravitropism: 0.05 })
      }
    }
  }
  return out
}

