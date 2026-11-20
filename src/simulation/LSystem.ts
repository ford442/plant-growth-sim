/**
 * Simple L-system for plant architecture.
 * Supports turtle graphics interpretation in 3D.
 */

export interface LSystemRule {
  [symbol: string]: string
}

export interface LSystemDef {
  axiom: string
  rules: LSystemRule
  angle: number // degrees
  length: number
  lengthDecay: number
  thickness: number
  thicknessDecay: number
  color: string // hex for stem
  leafColor?: string
}

export const SPECIES_LSYSTEMS: Record<string, LSystemDef> = {
  sunflower: {
    axiom: 'X',
    rules: {
      X: 'F[+X]F[-X]+X',
      F: 'FF',
    },
    angle: 25,
    length: 0.35,
    lengthDecay: 0.85,
    thickness: 0.08,
    thicknessDecay: 0.7,
    color: '#5a3a1a',
    leafColor: '#3d8b3d',
  },
  oak: {
    axiom: 'A',
    rules: {
      A: 'F[+A][-A]FA',
      F: 'FF',
    },
    angle: 28,
    length: 0.45,
    lengthDecay: 0.78,
    thickness: 0.12,
    thicknessDecay: 0.65,
    color: '#4a3020',
    leafColor: '#2e6b2e',
  },
  rose: {
    axiom: 'X',
    rules: {
      X: 'F-[[X]+X]+F[+FX]-X',
      F: 'FF',
    },
    angle: 22.5,
    length: 0.28,
    lengthDecay: 0.82,
    thickness: 0.05,
    thicknessDecay: 0.75,
    color: '#5c3d2e',
    leafColor: '#3a7a3a',
  },
  fern: {
    axiom: 'X',
    rules: {
      X: 'F+[[X]-X]-F[-FX]+X',
      F: 'FF',
    },
    angle: 22.5,
    length: 0.3,
    lengthDecay: 0.8,
    thickness: 0.04,
    thicknessDecay: 0.7,
    color: '#3a5a2a',
    leafColor: '#4a9a4a',
  },
  bamboo: {
    axiom: 'F',
    rules: {
      F: 'F[+F]F[-F]F',
    },
    angle: 18,
    length: 0.5,
    lengthDecay: 0.9,
    thickness: 0.06,
    thicknessDecay: 0.85,
    color: '#5a6a3a',
    leafColor: '#5a9a4a',
  },
  ivy: {
    axiom: 'X',
    rules: {
      X: 'F[+X]F[-X]FX',
      F: 'F',
    },
    angle: 32,
    length: 0.25,
    lengthDecay: 0.88,
    thickness: 0.03,
    thicknessDecay: 0.8,
    color: '#4a3a2a',
    leafColor: '#3a8a3a',
  },
}

export function generateLSystem(axiom: string, rules: LSystemRule, iterations: number): string {
  let current = axiom
  for (let i = 0; i < iterations; i++) {
    let next = ''
    for (const ch of current) {
      next += rules[ch] ?? ch
    }
    current = next
  }
  return current
}

export interface TurtleState {
  x: number
  y: number
  z: number
  heading: number // yaw (radians)
  pitch: number
  roll: number
  length: number
  thickness: number
}

export interface Segment {
  start: [number, number, number]
  end: [number, number, number]
  thickness: number
  generation: number
  /** Index of the drawing symbol (`F`/`G`) in the interpreted string that produced this segment. */
  src: number
}

export interface Leaf {
  position: [number, number, number]
  direction: [number, number, number]
  size: number
  /** Index of the `]` that placed this leaf, or -1 for the final leaf at the plant tip. */
  src: number
}

export interface Interpretation {
  segments: Segment[]
  leaves: Leaf[]
  /**
   * Turtle position (x, y, z) just before each symbol of the string executes,
   * 3 floats per symbol. For a non-drawing symbol such as `X` this is where the
   * bud sits, which is what `LSystemMorph` grows new branches out of.
   */
  charPos: Float32Array
}

/**
 * Deterministic stand-in for Math.random(): the same leaf ordinal always gets
 * the same size, so a generation interprets identically every time and two
 * generations can be morphed into each other.
 */
export function hash01(n: number): number {
  let h = Math.imul(n ^ 0x9e3779b9, 0x85ebca6b)
  h ^= h >>> 13
  h = Math.imul(h, 0xc2b2ae35)
  h ^= h >>> 16
  return (h >>> 0) / 4294967296
}

export function interpretLSystem(str: string, def: LSystemDef): Interpretation {
  const segments: Segment[] = []
  const leaves: Leaf[] = []
  const stack: TurtleState[] = []
  const charPos = new Float32Array(str.length * 3)

  let state: TurtleState = {
    x: 0,
    y: 0,
    z: 0,
    heading: 0,
    pitch: Math.PI / 2, // up
    roll: 0,
    length: def.length,
    thickness: def.thickness,
  }

  const angleRad = (def.angle * Math.PI) / 180
  let generation = 0

  for (let i = 0; i < str.length; i++) {
    const ch = str[i]
    charPos[i * 3] = state.x
    charPos[i * 3 + 1] = state.y
    charPos[i * 3 + 2] = state.z
    switch (ch) {
      case 'F':
      case 'G': {
        // move forward and draw
        const dx = Math.cos(state.heading) * Math.cos(state.pitch) * state.length
        const dy = Math.sin(state.pitch) * state.length
        const dz = Math.sin(state.heading) * Math.cos(state.pitch) * state.length

        const end: [number, number, number] = [
          state.x + dx,
          state.y + dy,
          state.z + dz,
        ]

        segments.push({
          start: [state.x, state.y, state.z],
          end,
          thickness: state.thickness,
          generation,
          src: i,
        })

        state.x = end[0]
        state.y = end[1]
        state.z = end[2]
        break
      }
      case '+':
        state.heading += angleRad
        break
      case '-':
        state.heading -= angleRad
        break
      case '&':
        state.pitch += angleRad
        break
      case '^':
        state.pitch -= angleRad
        break
      case '\\':
        state.roll += angleRad
        break
      case '/':
        state.roll -= angleRad
        break
      case '[':
        stack.push({ ...state })
        state.length *= def.lengthDecay
        state.thickness *= def.thicknessDecay
        generation++
        break
      case ']':
        if (stack.length) {
          // place a leaf at tip before popping
          leaves.push({
            position: [state.x, state.y, state.z],
            direction: [
              Math.cos(state.heading) * Math.cos(state.pitch),
              Math.sin(state.pitch),
              Math.sin(state.heading) * Math.cos(state.pitch),
            ],
            size: 0.12 + hash01(leaves.length) * 0.08,
            src: i,
          })
          state = stack.pop()!
          generation = Math.max(0, generation - 1)
        }
        break
      case 'X':
      case 'A':
        // non-drawing
        break
      default:
        break
    }
  }

  // final leaf at tip if any
  if (segments.length) {
    const last = segments[segments.length - 1]
    leaves.push({
      position: last.end,
      direction: [0, 1, 0],
      size: 0.15,
      src: -1,
    })
  }

  return { segments, leaves, charPos }
}
