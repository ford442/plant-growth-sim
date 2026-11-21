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
  /**
   * Roll (degrees) the turtle takes about its heading each time a branch opens
   * (`[`). With only `+`/`-` in the rules every branch would stay in one plane;
   * a roll between levels turns the planes against each other so the crown fills
   * out in 3D. Default {@link DEFAULT_BRANCH_ROLL} (the golden angle, as in
   * spiral phyllotaxis); 0 keeps the plant planar.
   */
  branchRoll?: number
  /** Leaf form for this species; see {@link LeafSpec}. Missing fields fall back to {@link DEFAULT_LEAF}. */
  leaf?: Partial<LeafSpec>
}

export type LeafShape = 'ovate' | 'heart' | 'lanceolate' | 'lobed' | 'pinnate'

/**
 * The leaf of a species: how big, what outline, and how it sits on its twig.
 * Shape fields (`shape`, `aspect`, `fold`, `curl`) build the shared blade mesh
 * (`components/plant/leafGeometry.ts`); `size` and `spread` are applied by the
 * turtle, so they live in the simulation output rather than in the view.
 */
export interface LeafSpec {
  shape: LeafShape
  /** Blade length ÷ width. */
  aspect: number
  /** Multiplier on the leaf's base scale (1 ≈ a 0.17–0.28 long blade). */
  size: number
  /** Degrees the blade opens away from its twig's heading (0 = along the twig, 90 = square to it). */
  spread: number
  /** How far the edges fold down from the midrib, as a fraction of the half-width. */
  fold: number
  /** How far the tip droops, as a fraction of the blade length. */
  curl: number
}

export const DEFAULT_BRANCH_ROLL = 137.5
export const DEFAULT_LEAF: LeafSpec = {
  shape: 'ovate',
  aspect: 1.4,
  size: 1,
  spread: 40,
  fold: 0.12,
  curl: 0.1,
}

/** A species' leaf with every field filled in. */
export function leafSpec(def: LSystemDef): LeafSpec {
  return { ...DEFAULT_LEAF, ...def.leaf }
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
    leaf: { shape: 'heart', aspect: 1.15, size: 1.7, spread: 62, fold: 0.1, curl: 0.16 },
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
    leaf: { shape: 'lobed', aspect: 1.7, size: 2, spread: 38, fold: 0.14, curl: 0.08 },
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
    leaf: { shape: 'ovate', aspect: 1.5, size: 1.4, spread: 42, fold: 0.2, curl: 0.12 },
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
    leaf: { shape: 'pinnate', aspect: 4.2, size: 1.7, spread: 22, fold: 0.04, curl: 0.3 },
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
    leaf: { shape: 'lanceolate', aspect: 5.5, size: 1.5, spread: 30, fold: 0.18, curl: 0.14 },
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
    leaf: { shape: 'heart', aspect: 1.05, size: 1.3, spread: 56, fold: 0.06, curl: 0.05 },
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

/**
 * The turtle is a right-handed frame, not yaw/pitch angles: `h` is where it is
 * heading, `l` its left and `u` its up (initially +Y, −X and +Z). Angles about a
 * fixed pitch break at the pole — started pointing straight up, yaw `+`/`-` had no
 * sideways effect and every plant grew as one line — while turning the frame about
 * its own axes has no preferred direction.
 */
export interface TurtleState {
  x: number
  y: number
  z: number
  h: [number, number, number]
  l: [number, number, number]
  u: [number, number, number]
  length: number
  thickness: number
}

/** Rotate frame vectors `a` and `b` by `angle` in their shared plane: a' = a·cos + b·sin, b' = b·cos − a·sin. */
function turn(a: [number, number, number], b: [number, number, number], angle: number): void {
  const c = Math.cos(angle)
  const s = Math.sin(angle)
  for (let k = 0; k < 3; k++) {
    const ak = a[k]
    a[k] = ak * c + b[k] * s
    b[k] = b[k] * c - ak * s
  }
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
    h: [0, 1, 0], // up
    l: [-1, 0, 0],
    u: [0, 0, 1],
    length: def.length,
    thickness: def.thickness,
  }

  const angleRad = (def.angle * Math.PI) / 180
  const rollRad = ((def.branchRoll ?? DEFAULT_BRANCH_ROLL) * Math.PI) / 180
  const leaf = leafSpec(def)
  const spreadRad = (leaf.spread * Math.PI) / 180
  const spreadCos = Math.cos(spreadRad)
  const spreadSin = Math.sin(spreadRad)
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
        const end: [number, number, number] = [
          state.x + state.h[0] * state.length,
          state.y + state.h[1] * state.length,
          state.z + state.h[2] * state.length,
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
        turn(state.h, state.l, angleRad) // yaw: about the turtle's up
        break
      case '-':
        turn(state.h, state.l, -angleRad)
        break
      case '&':
        turn(state.h, state.u, angleRad) // pitch: about its left
        break
      case '^':
        turn(state.h, state.u, -angleRad)
        break
      case '\\':
        turn(state.l, state.u, angleRad) // roll: about its heading
        break
      case '/':
        turn(state.l, state.u, -angleRad)
        break
      case '[':
        // each push copies the frame: the branch rolls and shortens without touching its parent
        stack.push({ ...state, h: [...state.h], l: [...state.l], u: [...state.u] })
        turn(state.l, state.u, rollRad)
        state.length *= def.lengthDecay
        state.thickness *= def.thicknessDecay
        generation++
        break
      case ']':
        if (stack.length) {
          // a shoot ends: its leaf sits on the tip, opened away from the twig towards the
          // turtle's up (which the branch roll has turned a different way at every level)
          const h = state.h
          const u = state.u
          const dx = h[0] * spreadCos + u[0] * spreadSin
          const dy = h[1] * spreadCos + u[1] * spreadSin
          const dz = h[2] * spreadCos + u[2] * spreadSin
          leaves.push({
            position: [state.x, state.y, state.z],
            direction: [dx, dy, dz],
            size: (0.12 + hash01(leaves.length) * 0.08) * leaf.size,
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
      size: 0.15 * leaf.size,
      src: -1,
    })
  }

  return { segments, leaves, charPos }
}
