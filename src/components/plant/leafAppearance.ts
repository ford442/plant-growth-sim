/**
 * Weather / plant-status → leaf appearance. Pure (no three.js, no store), so it
 * is unit-tested and shared by whichever leaf material is active: today the TSL
 * node material (`tsl/leafNodeMaterial.ts`) reads it, and the classic path could
 * too without changing it.
 *
 * The four numbers are the only thing the material knows about the simulation —
 * they are pushed into shader uniforms each frame, never into the graph, so a
 * change in weather never recompiles a pipeline.
 */

export interface LeafConditions {
  /** 0–1, wilting → turgid (`simStore.waterStatus`). */
  waterStatus: number
  /** 0–1, calcium nutrition from the root zone (`simStore.nutrientStatus`). */
  nutrientStatus: number
  /** PAR relative 0–1. */
  light: number
  /** Relative humidity 0–1. */
  humidity: number
  /** mm/h. */
  precipitation: number
  /** m/s. */
  wind: number
}

export interface LeafAppearance {
  /** 0 = senescent / chlorotic, 1 = fully pigmented. */
  chlorophyll: number
  /** 0 = dry, 1 = continuous water film. A *target*: see {@link relaxWetness}. */
  wetness: number
  /** Gain on transmitted (back-lit) light, 0–1. */
  translucency: number
  /** Wind flutter amplitude, 0–1. */
  flutter: number
}

const clamp01 = (x: number) => (x < 0 ? 0 : x > 1 ? 1 : x)

function smoothstep(a: number, b: number, x: number): number {
  const t = clamp01((x - a) / (b - a))
  return t * t * (3 - 2 * t)
}

/** Rain rate at which the leaf surface is fully wet, mm/h (a steady moderate rain). */
export const RAIN_FOR_FULL_WETNESS = 4
/** Wind at which flutter saturates, m/s — matches the cap on the whole-plant sway. */
export const WIND_FOR_FULL_FLUTTER = 8

export function leafAppearance(c: LeafConditions): LeafAppearance {
  // Pigment: lost as the plant wilts and as nutrition drops. Continuous version
  // of the old hard switch to a dry-leaf colour at waterStatus < 0.35 — at that
  // threshold the leaf is now about two-fifths of the way back to green.
  const chlorophyll = clamp01(smoothstep(0.2, 0.55, c.waterStatus) * (0.6 + 0.4 * clamp01(c.nutrientStatus)))

  // Surface water: rain wets it fully; near-saturated air leaves a little dew.
  const wetness = Math.max(clamp01(c.precipitation / RAIN_FOR_FULL_WETNESS), 0.35 * smoothstep(0.85, 1, c.humidity))

  // Turgid leaves are fuller of water and pass more light than limp ones.
  const translucency = 0.35 + 0.65 * clamp01(c.waterStatus)

  return {
    chlorophyll,
    wetness,
    translucency,
    flutter: clamp01(c.wind / WIND_FOR_FULL_FLUTTER),
  }
}

/** Time constants, seconds of real time: a film forms quickly and takes a while to dry. */
export const WET_TAU = 1.5
export const DRY_TAU = 20

/**
 * Move the displayed wetness towards its target. View-layer smoothing only —
 * it runs on frame time so rain visibly arrives and drains, and it is not
 * simulation state.
 */
export function relaxWetness(current: number, target: number, dt: number): number {
  const tau = target > current ? WET_TAU : DRY_TAU
  return current + (target - current) * (1 - Math.exp(-Math.max(0, dt) / tau))
}
