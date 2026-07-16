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
}

export interface Leaf {
  position: [number, number, number]
  direction: [number, number, number]
  size: number
}

export function interpretLSystem(
  str: string,
  def: LSystemDef,
  maxIterations: number
): { segments: Segment[]; leaves: Leaf[] } {
  const segments: Segment[] = []
  const leaves: Leaf[] = []
  const stack: TurtleState[] = []

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

  for (const ch of str) {
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
            size: 0.12 + Math.random() * 0.08,
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
    })
  }

  return { segments, leaves }
}
