/**
 * Gem optics — what a growing crystal looks like, from pure state (no Three.js).
 *
 * `gemAppearance()` turns a preset's optical data (`GemstoneDef.look` +
 * `optics`), the crystal's recorded growth history and the *current*
 * conditions into the numbers a material needs. The views push them into
 * either the classic `MeshPhysicalMaterial` or the TSL gem material each frame,
 * so both backends show the same physics; the TSL one adds the inclusion scene.
 *
 * What is driven by what:
 *  - body colour     volume-weighted over the growth zones (dopant, T while it
 *                    grew, peak T since — amethyst → citrine is irreversible)
 *  - pleochroism     the chromophore's dichroic tints; scales with colour depth,
 *                    so an undoped crystal shows none
 *  - absorption      Beer–Lambert path length: more dopant → deeper colour sooner
 *  - thermochromism  reversible, from the current T (hot ruby turns green-grey)
 *  - incandescence   blackbody glow of a crystal sitting in a >600 °C melt / flux
 *  - fluorescence    dopant-driven (Cr³⁺ red in ruby, N3 blue in diamond)
 *  - inclusions      fast growth (high σ, rough / 2D-nucleation regime) traps
 *                    fluid and solid inclusions; recorded per zone, so a clean
 *                    overgrowth dilutes an included core
 *  - frost           etching while the crystal dissolves (relaxed in the view;
 *                    regrowth heals it)
 *
 * Plus the smooth-growth helpers the views use between sim ticks:
 * `easeHabit` (specimen face distances + radius) and `relaxFrost`.
 */

import type { CrystalState } from './CrystalGrowth'
import { zoneColors } from './CrystalGrowth'
import type { GemstoneDef, GeologyState } from './GemstonePresets'
import { clamp01, lerpColor, mixColors, smoothstep } from './color'

export interface GemAppearance {
  /** Volume-weighted body colour (hex). */
  body: string
  /** Colour seen looking down the c-axis / across it (hex); equal to `body` for isotropic gems. */
  alongC: string
  acrossC: string
  /** Beer–Lambert distance (mm) at which transmitted light takes on the body colour. */
  attenuationMm: number
  /** 0–1, and its colour. */
  fluorescence: number
  fluorescenceColor: string
  /** 0–1 glow of the hot crystal, and its blackbody colour at the current T. */
  incandescence: number
  incandescenceColor: string
  /** 0–1 density of the inclusion scene. */
  inclusions: number
  /** 0–1 target etch frost from the current dissolution rate (relax with `relaxFrost`). */
  frostTarget: number
  ior: number
  /** Material dispersion (already scaled by the preset's `fire`). */
  dispersion: number
  roughness: number
  specularIntensity: number
  clearcoat: number
  envMapIntensity: number
}

const LUSTER = {
  vitreous: { specularIntensity: 0.8, clearcoat: 0.45, envMapIntensity: 2.0 },
  subadamantine: { specularIntensity: 1.0, clearcoat: 0.7, envMapIntensity: 2.6 },
  adamantine: { specularIntensity: 1.0, clearcoat: 1.0, envMapIntensity: 3.2 },
} as const

// --- colour helpers (hex in, hex out) -------------------------------------------

function rgb(hex: string): [number, number, number] {
  const h = hex.replace('#', '')
  return [parseInt(h.slice(0, 2), 16) / 255, parseInt(h.slice(2, 4), 16) / 255, parseInt(h.slice(4, 6), 16) / 255]
}

function hex([r, g, b]: [number, number, number]): string {
  return '#' + [r, g, b].map((c) => Math.round(clamp01(c) * 255).toString(16).padStart(2, '0')).join('')
}

/** 0 for a grey / white colour, → 1 for a fully saturated one (HSV saturation). */
export function chroma(color: string): number {
  const c = rgb(color)
  const max = Math.max(...c)
  return max <= 0 ? 0 : (max - Math.min(...c)) / max
}

/**
 * Body colour filtered by a dichroic tint. The tint is normalised to its
 * brightest channel (it shifts hue, it does not darken), and the shift scales
 * with how coloured the body is — no chromophore, no pleochroism.
 */
export function pleochroicTint(body: string, tint: string): string {
  const b = rgb(body)
  const t = rgb(tint)
  const m = Math.max(...t) || 1
  const k = smoothstep(0, 0.55, chroma(body))
  return hex([b[0] * (1 - k + (k * t[0]) / m), b[1] * (1 - k + (k * t[1]) / m), b[2] * (1 - k + (k * t[2]) / m)])
}

/**
 * Approximate sRGB colour of a blackbody at `tC` °C (Tanner Helland's fit to
 * the CIE data, good to a few % from 1000 K to 40 000 K). Below ~800 K a body
 * barely glows; callers fade it by `incandescence`.
 */
export function blackbodyColor(tC: number): string {
  const t = Math.max(1000, tC + 273.15) / 100
  const r = t <= 66 ? 255 : 329.698727446 * Math.pow(t - 60, -0.1332047592)
  const g = t <= 66 ? 99.4708025861 * Math.log(t) - 161.1195681661 : 288.1221695283 * Math.pow(t - 60, -0.0755148492)
  const b = t >= 66 ? 255 : t <= 19 ? 0 : 138.5177312231 * Math.log(t - 10) - 305.0447927307
  return hex([r / 255, g / 255, b / 255])
}

// --- appearance -----------------------------------------------------------------

/** Below the Draper point (~525 °C) nothing glows; a 1500 °C melt is bright orange-white. */
export const incandescenceOf = (tC: number) => 0.15 * smoothstep(650, 1600, tC)

/** Fraction of a zone's volume that grew fast enough to trap inclusions. */
const trapping = (saturation: number) => smoothstep(1.15, 2.0, saturation)

export function gemAppearance(def: GemstoneDef, crystal: CrystalState, env: GeologyState): GemAppearance {
  const { look, optics } = def

  // history: body colour and inclusion load, both volume-weighted over the zones
  const zones = zoneColors(def, crystal)
  let body = mixColors(zones)
  let w = 0
  let trapped = 0
  for (let i = 0; i < crystal.zones.length; i++) {
    trapped += zones[i].weight * trapping(crystal.zones[i].saturation)
    w += zones[i].weight
  }
  const inclusions = clamp01(look.inclusions.density * (0.35 + 0.65 * (w > 0 ? trapped / w : 0)))

  // current conditions: reversible colour while hot
  if (look.thermochromism) {
    const { color, from, to } = look.thermochromism
    body = lerpColor(body, color, 0.45 * smoothstep(from, to, env.temperature))
  }

  const alongC = look.pleochroism ? pleochroicTint(body, look.pleochroism.alongC) : body
  const acrossC = look.pleochroism ? pleochroicTint(body, look.pleochroism.acrossC) : body

  // dopant that is in the crystal now, weighted the same way as the colour
  let dopant = 0
  for (let i = 0; i < crystal.zones.length; i++) dopant += zones[i].weight * crystal.zones[i].impurity
  dopant = w > 0 ? dopant / w : env.impurity

  const fluorescence = look.fluorescence ? clamp01(look.fluorescence.strength * smoothstep(0.02, 0.8, dopant)) : 0

  const dissolving = crystal.velocity < 0 ? -crystal.velocity / Math.max(1e-6, def.kinetics.dissolution) : 0
  const resorbing = crystal.status === 'resorbing' ? 1 : 0
  const frostTarget = clamp01(Math.max(smoothstep(0, 0.25, dissolving), resorbing))

  return {
    body,
    alongC,
    acrossC,
    attenuationMm: look.absorptionMm / (0.25 + 1.5 * dopant),
    fluorescence,
    fluorescenceColor: look.fluorescence?.color ?? '#000000',
    incandescence: incandescenceOf(env.temperature),
    incandescenceColor: blackbodyColor(env.temperature),
    inclusions,
    frostTarget,
    ior: optics.ior,
    dispersion: optics.dispersion * look.fire,
    roughness: optics.roughness,
    ...LUSTER[look.luster],
  }
}

// --- smooth growth between sim ticks ---------------------------------------------

export interface HabitPose {
  /** Specimen face distances (mm). */
  h: number[]
  /** Specimen equivalent-sphere radius (mm). */
  radius: number
  /** Crystal age (days) the pose is heading for — a younger target means a reseed. */
  age: number
}

/** Time constant (s) of the display easing: short enough to feel live, long enough to hide a fast-forward step. */
export const HABIT_TAU = 0.15

/**
 * Ease the displayed specimen towards the simulation's, frame-rate
 * independently. Face distances are blended linearly: a convex combination of
 * two valid Wulff distance vectors is itself a valid habit, so the morph
 * between two "generations" of the crystal (e.g. α-quartz prisms → β-quartz
 * bipyramids, or growth → etching) is always a real polyhedron.
 *
 * Snaps on a reseed (target younger than the pose), a gemstone change (family
 * count differs) or the very first frame. Allocation-free when `out` is given.
 */
export function easeHabit(pose: HabitPose | null, target: HabitPose, dt: number, tau = HABIT_TAU, out?: HabitPose): HabitPose {
  const o = out ?? { h: new Array(target.h.length).fill(0), radius: 0, age: 0 }
  if (o.h.length !== target.h.length) o.h = new Array(target.h.length).fill(0)
  const snap = !pose || pose.h.length !== target.h.length || target.age < pose.age - 1e-9 || tau <= 0
  const k = snap ? 1 : 1 - Math.exp(-Math.max(0, dt) / tau)
  for (let i = 0; i < target.h.length; i++) {
    const from = snap ? target.h[i] : pose!.h[i]
    o.h[i] = from + (target.h[i] - from) * k
  }
  o.radius = snap ? target.radius : pose!.radius + (target.radius - pose!.radius) * k
  o.age = target.age
  return o
}

/** Etch frost comes on in ~1 s of dissolution and heals over ~4 s of regrowth; `dt = 0` (paused) holds it. */
export function relaxFrost(frost: number, target: number, dt: number): number {
  if (dt <= 0) return frost
  const tau = target > frost ? 1 : 4
  return frost + (target - frost) * (1 - Math.exp(-dt / tau))
}
