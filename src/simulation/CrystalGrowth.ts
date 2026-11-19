/**
 * Crystal growth simulation — pure state + step function (no Three.js).
 *
 * Model (per time step, all crystals share the growth medium):
 *  1. Phase stability f(T, P) from the preset (0 outside the mineral's field).
 *  2. Interface kinetics: v = r0 · k(T) · f · g(σ), with Arrhenius k(T) and the
 *     BCF-style law g(σ) ∝ σ²/(σc + σ) — quadratic spiral growth at low
 *     supersaturation σ = S − 1, linear rough growth at high σ. σ < 0 dissolves.
 *  3. Habit: each face family advances at v · rate_f (kinetic Wulff). Faces
 *     that grew out of existence are clamped to the crystal's support function,
 *     so they re-appear as soon as conditions favour them (e.g. resorption).
 *  4. Nucleation: classical J ∝ exp(−B / ln²S) spawns new crystals on the
 *     substrate — high S gives crowded druses, low S a few large crystals.
 *  5. History: whenever conditions shift, a growth zone is recorded — these
 *     become phantoms in the crystal view and defect bands in the lattice view.
 *
 * Crystal #0 (the "specimen") carries the full face-distance vector; the other
 * crystals share its normalised habit and only track their own size.
 */

import {
  buildPolyhedron,
  equivalentRadius,
  familyAreas,
  familyPlanes,
  polyhedronExtents,
  polyhedronVolume,
  supportDistance,
  type FacePlane,
  type Polyhedron,
  type Vec3,
} from './CrystalHabit'
import { GEMSTONE_PRESETS, type GemstoneDef, type GemstoneId, type GeologyState, type SubstrateKind } from './GemstonePresets'

export interface Nucleus {
  id: number
  pos: Vec3 // cm, world space (substrate attachment point)
  axis: Vec3 // unit growth axis (crystal c → axis)
  spin: number // rotation about the axis (rad)
  radius: number // mm, equivalent-sphere radius
  vigor: number // local supply factor (0.75–1.15)
  bornAt: number // crystal age (days) at nucleation
}

export interface GrowthZone {
  age: number // days
  h: number[] // specimen face distances at zone start (mm)
  radius: number // specimen radius at zone start (mm)
  layer: number // lattice front at zone start
  temperature: number
  pressure: number
  saturation: number
  impurity: number
}

export type CrystalStatus = 'growing' | 'dissolving' | 'equilibrium' | 'unstable' | 'resorbing' | 'mature'

export interface CrystalState {
  age: number // days since seeding
  h: number[] // specimen central face distances per family (mm)
  nuclei: Nucleus[]
  zones: GrowthZone[]
  rng: number // PRNG state
  nextId: number
  nucleationDebt: number
  velocity: number // mm/day: signed normal velocity of a rate-1 face
  radialRate: number // mm/day: d(radius)/dt of the specimen
  layerFront: number // visual (time-dilated) atomic layer counter
  layersDeposited: number // real atomic layers added to the specimen
  peakTemperature: number // °C — for irreversible heat effects (amethyst)
  status: CrystalStatus
}

/** Lattice view keeps this many complete layers below the growth front. */
export const LATTICE_BASE_LAYERS = 6
/** Visual layer rate: layers per day at unit relative growth speed. */
const LAYER_RATE = 5
const MIN_RADIUS = 0.05 // mm
const SEED_RADIUS = 0.35 // mm
const MAX_ZONES = 24
const R_GAS = 8.314e-3 // kJ/(mol·K)

// ---------------------------------------------------------------------------
// Deterministic PRNG (mulberry32) — state lives in the store, so runs replay.
// ---------------------------------------------------------------------------

export function rand(state: number): [number, number] {
  const s = (state + 0x6d2b79f5) | 0
  let t = s
  t = Math.imul(t ^ (t >>> 15), t | 1)
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
  return [((t ^ (t >>> 14)) >>> 0) / 4294967296, s]
}

// ---------------------------------------------------------------------------
// Cached geometry per preset (planes are immutable)
// ---------------------------------------------------------------------------

const planeCache = new Map<GemstoneId, FacePlane[]>()
export function presetPlanes(def: GemstoneDef): FacePlane[] {
  let p = planeCache.get(def.id)
  if (!p) {
    p = familyPlanes(def.faces, def.system, def.pointGroup, def.cell)
    planeCache.set(def.id, p)
  }
  return p
}

export function specimenPolyhedron(def: GemstoneDef, h: number[]): Polyhedron {
  return buildPolyhedron(presetPlanes(def), h)
}

/** Clamp virtual (absent) faces to the support function of the real crystal. */
function clampToSupport(def: GemstoneDef, h: number[]): { h: number[]; poly: Polyhedron } {
  const planes = presetPlanes(def)
  const poly = buildPolyhedron(planes, h)
  const out = h.slice()
  for (let f = 0; f < out.length; f++) {
    const first = planes.find((p) => p.family === f)
    if (first) out[f] = Math.min(out[f], supportDistance(poly, first.normal))
  }
  return { h: out, poly }
}

// ---------------------------------------------------------------------------
// Kinetics
// ---------------------------------------------------------------------------

export function arrhenius(def: GemstoneDef, tC: number): number {
  const k = Math.exp((-def.kinetics.activation / R_GAS) * (1 / (tC + 273.15) - 1 / (def.kinetics.tRef + 273.15)))
  return Math.min(k, 3)
}

/** BCF-like supersaturation law, normalised so g(1) = 1; linear when σ < 0. */
export function growthLaw(sigma: number, sigmaCrit: number): number {
  if (sigma <= 0) return sigma
  return (sigma * sigma * (1 + sigmaCrit)) / (sigmaCrit + sigma)
}

/** Nucleation rate (crystals/day). */
export function nucleationRate(def: GemstoneDef, env: GeologyState, stability: number): number {
  if (env.saturation <= 1.02 || stability <= 0) return 0
  const ln = Math.log(env.saturation)
  const { j0, barrier } = def.kinetics.nucleation
  return j0 * stability * Math.min(arrhenius(def, env.temperature), 2) * Math.exp(-barrier / (ln * ln))
}

export type GrowthMode = 'spiral' | 'birth-spread' | 'rough' | 'etching' | 'none'

/** Surface growth mechanism from supersaturation (BCF / 2D nucleation / roughening). */
export function growthMode(sigma: number, stability = 1): GrowthMode {
  if (sigma < -0.01) return 'etching'
  if (sigma < 0.01 || stability < 0.05) return 'none'
  if (sigma < 0.35) return 'spiral'
  if (sigma < 1.0) return 'birth-spread'
  return 'rough'
}

export const GROWTH_MODE_LABEL: Record<GrowthMode, string> = {
  spiral: 'Spiral step-flow (BCF, screw dislocation)',
  'birth-spread': '2D nucleation — birth & spread islands',
  rough: 'Kinetic roughening — continuous growth',
  etching: 'Etching — layers dissolve',
  none: 'No growth',
}

// ---------------------------------------------------------------------------
// Substrate nucleation sites
// ---------------------------------------------------------------------------

export const GEODE_RADIUS = 2.4 // cm
export const KIMBERLITE_CENTER: Vec3 = [0, 0.2, 0]
export const KIMBERLITE_RADIUS = 1.7 // cm
export const PLATE_RADIUS = 2.6 // cm

function normalize(v: Vec3): Vec3 {
  const l = Math.hypot(v[0], v[1], v[2]) || 1
  return [v[0] / l, v[1] / l, v[2] / l]
}

/** Tilt `axis` towards `toward` by `amount` radians (approx, small angles fine). */
function tilt(axis: Vec3, toward: Vec3, amount: number): Vec3 {
  const t = Math.tan(amount)
  return normalize([axis[0] + toward[0] * t, axis[1] + toward[1] * t, axis[2] + toward[2] * t])
}

function heroSite(kind: SubstrateKind): Pick<Nucleus, 'pos' | 'axis'> {
  switch (kind) {
    case 'geode':
      return { pos: [0, -GEODE_RADIUS, 0], axis: [0, 1, 0] }
    case 'kimberlite':
      return {
        pos: [KIMBERLITE_CENTER[0], KIMBERLITE_CENTER[1] + KIMBERLITE_RADIUS, KIMBERLITE_CENTER[2]],
        axis: normalize([0.25, 1, 0.35]),
      }
    default:
      return { pos: [0, 0, 0], axis: [0, 1, 0] }
  }
}

function sampleSite(kind: SubstrateKind, rng: number): { site: Pick<Nucleus, 'pos' | 'axis' | 'spin'>; rng: number } {
  let r1: number, r2: number, r3: number, r4: number
  ;[r1, rng] = rand(rng)
  ;[r2, rng] = rand(rng)
  ;[r3, rng] = rand(rng)
  ;[r4, rng] = rand(rng)
  const theta = r1 * Math.PI * 2
  const spin = r4 * Math.PI * 2
  if (kind === 'geode') {
    // lower hemisphere, polar angle from the bottom up to ~70°
    const polar = Math.acos(1 - r2 * (1 - Math.cos((70 * Math.PI) / 180)))
    const dir: Vec3 = [Math.sin(polar) * Math.cos(theta), -Math.cos(polar), Math.sin(polar) * Math.sin(theta)]
    const pos: Vec3 = [dir[0] * GEODE_RADIUS, dir[1] * GEODE_RADIUS, dir[2] * GEODE_RADIUS]
    const inward: Vec3 = [-dir[0], -dir[1], -dir[2]]
    const jitter: Vec3 = normalize([r3 - 0.5, r4 - 0.5, r2 - 0.5])
    return { site: { pos, axis: tilt(inward, jitter, 0.2), spin }, rng }
  }
  if (kind === 'kimberlite') {
    const polar = Math.acos(1 - r2 * 1.2) // upper ~60% of the blob
    const dir: Vec3 = [Math.sin(polar) * Math.cos(theta), Math.cos(polar), Math.sin(polar) * Math.sin(theta)]
    const pos: Vec3 = [
      KIMBERLITE_CENTER[0] + dir[0] * KIMBERLITE_RADIUS,
      KIMBERLITE_CENTER[1] + dir[1] * KIMBERLITE_RADIUS,
      KIMBERLITE_CENTER[2] + dir[2] * KIMBERLITE_RADIUS,
    ]
    // cubic crystals: orientation is random
    const axis = normalize([r3 * 2 - 1, r4 * 2 - 1, r1 * 2 - 1])
    return { site: { pos, axis, spin }, rng }
  }
  // plate: druse splaying outward from the centre
  const r = PLATE_RADIUS * Math.sqrt(r2)
  const pos: Vec3 = [r * Math.cos(theta), 0, r * Math.sin(theta)]
  const outward: Vec3 = [Math.cos(theta), 0, Math.sin(theta)]
  const tiltAmt = 0.15 + 0.55 * (r / PLATE_RADIUS) + (r3 - 0.5) * 0.35
  return { site: { pos, axis: tilt([0, 1, 0], outward, tiltAmt), spin }, rng }
}

// ---------------------------------------------------------------------------
// State construction
// ---------------------------------------------------------------------------

function initialH(def: GemstoneDef, env: GeologyState): number[] {
  const rates = def.faceRates(env)
  const raw = rates.map((r) => r * SEED_RADIUS)
  const { h, poly } = clampToSupport(def, raw)
  const scale = SEED_RADIUS / Math.max(1e-6, equivalentRadius(polyhedronVolume(poly)))
  return h.map((x) => x * scale)
}

export function createCrystalState(gemstone: GemstoneId, env: GeologyState, seed = 1337): CrystalState {
  const def = GEMSTONE_PRESETS[gemstone]
  const h = initialH(def, env)
  const hero = heroSite(def.substrate)
  return {
    age: 0,
    h,
    nuclei: [{ id: 0, ...hero, spin: 0.3, radius: SEED_RADIUS, vigor: 1, bornAt: 0 }],
    zones: [makeZone(0, h, SEED_RADIUS, LATTICE_BASE_LAYERS, env)],
    rng: seed >>> 0,
    nextId: 1,
    nucleationDebt: 0,
    velocity: 0,
    radialRate: 0,
    layerFront: LATTICE_BASE_LAYERS,
    layersDeposited: 0,
    peakTemperature: env.temperature,
    status: 'equilibrium',
  }
}

function makeZone(age: number, h: number[], radius: number, layer: number, env: GeologyState): GrowthZone {
  return {
    age,
    h: h.slice(),
    radius,
    layer,
    temperature: env.temperature,
    pressure: env.pressure,
    saturation: env.saturation,
    impurity: env.impurity,
  }
}

function conditionsShifted(z: GrowthZone, env: GeologyState): boolean {
  return (
    Math.abs(z.temperature - env.temperature) > 30 ||
    Math.abs(z.saturation - env.saturation) > 0.12 ||
    Math.abs(z.impurity - env.impurity) > 0.12 ||
    Math.abs(Math.log((z.pressure + 0.01) / (env.pressure + 0.01))) > 0.3 ||
    Math.sign(z.saturation - 1) !== Math.sign(env.saturation - 1)
  )
}

/** Shape factor: d(radius)/dt per unit face velocity, from exposed face areas. */
function shapeFactor(poly: Polyhedron, rates: number[], radius: number): number {
  const areas = familyAreas(poly, rates.length)
  let flux = 0
  for (let f = 0; f < rates.length; f++) flux += areas[f] * rates[f]
  return flux / (4 * Math.PI * radius * radius)
}

// ---------------------------------------------------------------------------
// Step
// ---------------------------------------------------------------------------

export function stepCrystal(state: CrystalState, gemstone: GemstoneId, env: GeologyState, days: number): CrystalState {
  if (days <= 0) return state
  const def = GEMSTONE_PRESETS[gemstone]
  const k = def.kinetics
  const stability = def.stability(env)
  const sigma = env.saturation - 1
  const kT = arrhenius(def, env.temperature)
  const g = growthLaw(sigma, k.sigmaCrit)

  // signed normal velocity of a rate-1 face (mm/day)
  let v = sigma >= 0 ? k.r0 * kT * stability * g : k.dissolution * Math.min(kT, 1.5) * g
  const decay = k.metastableDecay?.(env) ?? 0
  if (decay > 0) v = Math.min(v, 0) - decay

  const hero = state.nuclei[0]
  const growing = v > 0
  const rates = growing ? def.faceRates(env) : def.faces.map((f) => f.dissolve)
  // supply / cavity limit slows growth as the specimen approaches its max size
  const cap = growing ? Math.max(0, 1 - Math.pow(hero.radius / k.maxRadius, 3)) : 1

  // --- specimen habit (kinetic Wulff) ---
  const advanced = state.h.map((h, f) => Math.max(MIN_RADIUS * 0.5, h + v * rates[f] * cap * days))
  const { h, poly } = clampToSupport(def, advanced)
  const radius = Math.max(MIN_RADIUS, equivalentRadius(polyhedronVolume(poly)))
  const dRadius = radius - hero.radius
  const kShape = shapeFactor(poly, rates, radius)

  // --- other crystals: same face velocities, their own size cap & vigor ---
  let rng = state.rng
  const nuclei: Nucleus[] = [{ ...hero, radius }]
  for (let i = 1; i < state.nuclei.length; i++) {
    const n = state.nuclei[i]
    const c = growing ? Math.max(0, 1 - Math.pow(n.radius / (k.maxRadius * 0.8), 3)) : 1
    const r = n.radius + v * kShape * c * (growing ? n.vigor : 1) * days
    if (r > MIN_RADIUS * 0.5) nuclei.push({ ...n, radius: r })
  }

  // --- nucleation of new crystals ---
  let debt = state.nucleationDebt + nucleationRate(def, env, stability) * days
  let nextId = state.nextId
  while (debt >= 1 && nuclei.length < k.nucleation.max) {
    debt -= 1
    // rejection-sample a site that isn't on top of an existing crystal
    let best: Pick<Nucleus, 'pos' | 'axis' | 'spin'> | null = null
    for (let attempt = 0; attempt < 8 && !best; attempt++) {
      const s = sampleSite(def.substrate, rng)
      rng = s.rng
      const clear = nuclei.every((o) => {
        const d = Math.hypot(o.pos[0] - s.site.pos[0], o.pos[1] - s.site.pos[1], o.pos[2] - s.site.pos[2])
        return d > 0.12 + (o.radius / 10) * 1.2
      })
      if (clear) best = s.site
    }
    if (!best) continue
    let vig: number
    ;[vig, rng] = rand(rng)
    nuclei.push({ id: nextId++, ...best, radius: 0.08, vigor: 0.75 + 0.4 * vig, bornAt: state.age + days })
  }
  if (nuclei.length >= k.nucleation.max) debt = Math.min(debt, 1)

  // --- lattice front & layer counters ---
  // The lattice view shows interface kinetics at the current conditions, so it
  // ignores the macroscopic cavity/supply cap (a mature specimen's faces would
  // still grow at this rate if fed).
  const relSpeed = (v * kShape) / k.r0
  const layerFront = Math.max(LATTICE_BASE_LAYERS, state.layerFront + relSpeed * LAYER_RATE * days)
  const layersDeposited = Math.max(0, state.layersDeposited + (dRadius * 1e7) / def.layerSpacing)

  // --- history zones ---
  let zones = state.zones
  const last = zones[zones.length - 1]
  if (conditionsShifted(last, env)) {
    if (Math.abs(radius - last.radius) > 0.02 * Math.max(radius, 0.5)) {
      const z = makeZone(state.age + days, h, radius, layerFront, env)
      zones = zones.length >= MAX_ZONES ? [zones[0], ...zones.slice(zones.length - MAX_ZONES + 2), z] : [...zones, z]
    } else {
      // the last zone is still too thin to matter (e.g. slider being dragged):
      // retag it with the new conditions instead of stacking empty zones
      const { age, h: zh, radius: zr, layer } = last
      zones = [...zones.slice(0, -1), { ...makeZone(age, zh, zr, layer, env) }]
    }
  }

  let status: CrystalStatus
  if (decay > 0) status = 'resorbing'
  else if (v < -1e-6) status = 'dissolving'
  else if (stability < 0.05 && sigma > 0) status = 'unstable'
  else if (v > 1e-6 && cap < 0.03) status = 'mature'
  else if (v > 1e-6) status = 'growing'
  else status = 'equilibrium'

  return {
    age: state.age + days,
    h,
    nuclei,
    zones,
    rng,
    nextId,
    nucleationDebt: debt,
    velocity: v,
    radialRate: dRadius / days,
    layerFront,
    layersDeposited,
    peakTemperature: Math.max(state.peakTemperature, env.temperature),
    status,
  }
}

// ---------------------------------------------------------------------------
// Derived measurements for UI (pure)
// ---------------------------------------------------------------------------

export interface SpecimenMetrics {
  length: number // mm along c
  width: number // mm
  radius: number // mm equivalent sphere
  volume: number // mm³
  carats: number
  faceShare: number[] // fraction of surface area per family
}

export function specimenMetrics(def: GemstoneDef, h: number[]): SpecimenMetrics {
  const poly = specimenPolyhedron(def, h)
  const volume = polyhedronVolume(poly)
  const { length, width } = polyhedronExtents(poly)
  const areas = familyAreas(poly, def.faces.length)
  const total = areas.reduce((a, b) => a + b, 0) || 1
  return {
    length,
    width,
    radius: equivalentRadius(volume),
    volume,
    carats: (volume / 1000) * def.optics.density * 5, // mm³→cm³ × g/cm³ × 5 ct/g
    faceShare: areas.map((a) => a / total),
  }
}

/** Volume-weighted body colour over the recorded growth zones. */
export function zoneColors(def: GemstoneDef, state: CrystalState): { color: string; weight: number }[] {
  const out: { color: string; weight: number }[] = []
  const zs = state.zones
  for (let i = 0; i < zs.length; i++) {
    const r0 = zs[i].radius
    const r1 = i + 1 < zs.length ? zs[i + 1].radius : state.nuclei[0].radius
    out.push({
      color: def.bodyColor(zs[i].impurity, zs[i].temperature, state.peakTemperature),
      weight: Math.max(0, r1 ** 3 - r0 ** 3) + 1e-6,
    })
  }
  return out
}
