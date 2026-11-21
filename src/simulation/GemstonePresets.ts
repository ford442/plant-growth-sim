/**
 * Gemstone presets — the mineral counterpart of SPECIES_LSYSTEMS.
 *
 * Each preset is data + a few small pure functions:
 *  - face families (Miller indices) under the mineral's point group
 *  - `faceRates`: the distinct growth rule — relative normal growth velocity of
 *    each face family under the current conditions (kinetic Wulff habit)
 *  - `stability`: where in T–P space the mineral can grow at all (simplified)
 *  - growth kinetics, optics and colour-vs-chemistry/temperature
 *
 * Absolute rates are tuned to laboratory synthesis scale (hydrothermal, flux,
 * HPHT: ~0.1–1 mm/day) so growth is watchable; natural rates are far slower.
 * Stability fields are simplified textbook curves, not a thermodynamic model.
 *
 * To add a gemstone: extend `GemstoneId`, add an entry to GEMSTONE_PRESETS and
 * (if needed) a lattice in CrystalLattice.ts. TypeScript enforces completeness.
 */

import type { CellLengths, CrystalSystem, FaceFamilySpec, PointGroup } from './CrystalHabit'
import type { LatticeId } from './CrystalLattice'
import { clamp01, lerpColor, rampColor, smoothstep } from './color'

export type GemstoneId = 'quartz' | 'amethyst' | 'diamond' | 'ruby' | 'emerald' | 'topaz'

export interface GeologyState {
  temperature: number // °C
  pressure: number // kbar (1 kbar = 100 MPa)
  saturation: number // S = C / C_eq of the growth medium (1 = equilibrium)
  impurity: number // 0–1 of the preset's dopant range (Cr, Fe, N, Al…)
}

export interface FaceFamilyDef extends FaceFamilySpec {
  symbol: string // conventional letter, e.g. 'm', 'r'
  form: string // Miller(-Bravais) form symbol for display
  name: string
  /** relative dissolution velocity (edges/corners — virtual faces — dissolve fastest) */
  dissolve: number
  color: string // face-indexing colour
}

export type SubstrateKind = 'plate' | 'geode' | 'kimberlite'

/**
 * Inclusion scene typical of the gem — drawn procedurally by the TSL material.
 *  - veils:    healed-fracture fluid veils (rock crystal)
 *  - zoning:   sector / chevron colour bands (amethyst)
 *  - pinpoint: tiny dark graphite / sulphide crystals (diamond)
 *  - silk:     rutile needles at 60° in the basal plane (ruby; asterism)
 *  - jardin:   mossy fractures and fluid "garden" (emerald)
 *  - cleavage: perfect basal cleavage cracks catching light (topaz)
 */
export type InclusionKind = 'veils' | 'zoning' | 'pinpoint' | 'silk' | 'jardin' | 'cleavage'

export interface GemLook {
  luster: 'vitreous' | 'subadamantine' | 'adamantine'
  /**
   * Dichroism of the chromophore: the tint seen looking along the c-axis (the
   * ordinary ray) and across it. Multiplies the body colour, so a colourless
   * (undoped) crystal shows none. `null` for cubic / isotropic gems.
   */
  pleochroism: { alongC: string; acrossC: string } | null
  /** Dopant-driven photoluminescence under the studio light (Cr³⁺ red, N3 blue). */
  fluorescence: { color: string; strength: number } | null
  /** Reversible colour while hot (not recorded in the zones), e.g. hot ruby goes green-grey. */
  thermochromism: { color: string; from: number; to: number } | null
  inclusions: { kind: InclusionKind; color: string; density: number }
  /** Multiplier on the material dispersion so "fire" reads on screen. */
  fire: number
  /** Path length (mm) over which a fully doped crystal reaches its body colour. */
  absorptionMm: number
}

export interface GemstoneDef {
  id: GemstoneId
  name: string
  mineral: string
  formula: string
  system: CrystalSystem
  pointGroup: PointGroup
  spaceGroup: string
  cell: CellLengths // Å, structural cell (used for face poles too)
  faces: FaceFamilyDef[]
  /** Relative normal growth velocity per face family (slowest ≈ 1). */
  faceRates: (env: GeologyState) => number[]
  /** 0–1: can the phase grow here? */
  stability: (env: GeologyState) => number
  /** Human-readable note about the current phase field, if noteworthy. */
  phaseNote: (env: GeologyState, peakTemperature: number) => string | null
  kinetics: {
    r0: number // mm/day base normal velocity of a rate-1 face at tRef, σ = 1
    activation: number // kJ/mol (Arrhenius)
    tRef: number // °C
    sigmaCrit: number // BCF crossover: quadratic (spiral) → linear (rough) growth
    dissolution: number // mm/day per unit undersaturation
    maxRadius: number // mm equivalent-sphere radius (cavity / supply limit)
    nucleation: { j0: number; barrier: number; max: number } // J = j0·exp(−B / ln²S)
    /** Shrinkage outside the stability field (e.g. diamond graphitisation), mm/day. */
    metastableDecay?: (env: GeologyState) => number
  }
  substrate: SubstrateKind
  substrateColor: string
  optics: {
    ior: number
    dispersion: number // B–G interval (0.044 for diamond)
    birefringence: number
    density: number // g/cm³
    hardness: number // Mohs
    roughness: number
  }
  /** What makes this gem look like itself beyond IOR and colour (GemOptics.ts). */
  look: GemLook
  /** Body colour of a growth zone: dopant level, T while it grew, peak T since. */
  bodyColor: (impurity: number, growthT: number, peakT: number) => string
  dopant: { element: string; replaces: string; label: string; maxLabel: string; effect: string }
  lattice: LatticeId
  /** Atomic layer spacing along the growth axis (Å), for the layer counter. */
  layerSpacing: number
  habitNote: string
  swatch: string
  defaults: GeologyState
}

// ---------------------------------------------------------------------------
// Shared phase-boundary helpers (simplified)
// ---------------------------------------------------------------------------

/** α–β quartz inversion: 573 °C at 1 bar, rising ≈ 26 °C/kbar. */
export const alphaBetaQuartzT = (pKbar: number) => 573 + 26 * pKbar
/** Quartz → tridymite (low P) boundary. */
const tridymiteT = (pKbar: number) => 870 + 60 * pKbar
/** Quartz → coesite (UHP) boundary, kbar. */
const coesiteP = (tC: number) => 20 + 0.01 * tC
/** Graphite–diamond equilibrium (Kennedy & Kennedy 1976): P = 19.4 + 0.025·T kbar. */
export const graphiteDiamondP = (tC: number) => 19.4 + 0.025 * tC

const sigmaPos = (env: GeologyState) => Math.max(0, env.saturation - 1)

function quartzStability(env: GeologyState): number {
  return (
    (1 - smoothstep(tridymiteT(env.pressure) - 25, tridymiteT(env.pressure) + 25, env.temperature)) *
    (1 - smoothstep(coesiteP(env.temperature) - 1.5, coesiteP(env.temperature) + 1.5, env.pressure)) *
    smoothstep(20, 60, env.temperature)
  )
}

function quartzPhaseNote(env: GeologyState): string | null {
  if (env.pressure > coesiteP(env.temperature)) return 'Coesite field (UHP) — quartz not stable'
  if (env.temperature > tridymiteT(env.pressure)) return 'Tridymite field — quartz not stable'
  if (env.temperature > alphaBetaQuartzT(env.pressure))
    return 'β-quartz field — hexagonal bipyramids, no prism'
  return null
}

/** 0 in the α field, 1 in the β field (±15 °C blend). */
const betaFraction = (env: GeologyState) => {
  const t = alphaBetaQuartzT(env.pressure)
  return smoothstep(t - 15, t + 15, env.temperature)
}

const QUARTZ_CELL: CellLengths = { a: 4.913, b: 4.913, c: 5.405 }

const QUARTZ_FACES: FaceFamilyDef[] = [
  { symbol: 'm', form: '{10-10}', name: 'prism', miller: [1, 0, 0], dissolve: 0.5, color: '#60a5fa' },
  { symbol: 'r', form: '{10-11}', name: 'positive rhombohedron', miller: [1, 0, 1], dissolve: 0.7, color: '#f472b6' },
  { symbol: 'z', form: '{01-11}', name: 'negative rhombohedron', miller: [0, 1, 1], dissolve: 0.8, color: '#fbbf24' },
  { symbol: 'c', form: '{0001}', name: 'basal pinacoid', miller: [0, 0, 1], dissolve: 2.0, color: '#a3e635' },
]

// ---------------------------------------------------------------------------
// Presets
// ---------------------------------------------------------------------------

export const GEMSTONE_PRESETS: Record<GemstoneId, GemstoneDef> = {
  quartz: {
    id: 'quartz',
    name: 'Rock crystal',
    mineral: 'Quartz',
    formula: 'SiO₂',
    system: 'trigonal',
    pointGroup: '32',
    spaceGroup: 'P3₂21',
    cell: QUARTZ_CELL,
    faces: QUARTZ_FACES,
    faceRates: (env) => {
      const s = Math.min(sigmaPos(env), 1.5)
      const b = betaFraction(env)
      // α: long prisms terminated by r > z rhombohedra; higher σ → more elongated.
      // β (above the inversion): prism vanishes, r ≈ z → hexagonal bipyramid.
      const r = (2.2 + 1.6 * s) * (1 - b) + 1.0 * b
      const z = r * (1.07 * (1 - b) + 1.0 * b)
      const m = 1 + 5 * b
      return [m, r, z, 6]
    },
    stability: quartzStability,
    phaseNote: (env) => quartzPhaseNote(env),
    kinetics: {
      r0: 0.45,
      activation: 80, // hydrothermal quartz ≈ 80–90 kJ/mol
      tRef: 350,
      sigmaCrit: 0.3,
      dissolution: 0.6,
      maxRadius: 9,
      nucleation: { j0: 0.9, barrier: 0.1, max: 34 },
    },
    substrate: 'plate',
    substrateColor: '#5b5348',
    optics: { ior: 1.544, dispersion: 0.013, birefringence: 0.009, density: 2.65, hardness: 7, roughness: 0.03 },
    look: {
      luster: 'vitreous',
      pleochroism: { alongC: '#f2f0ec', acrossC: '#d8cdbf' }, // smoky quartz: weak brown dichroism
      fluorescence: null,
      thermochromism: null,
      inclusions: { kind: 'veils', color: '#ffffff', density: 0.35 },
      fire: 10,
      absorptionMm: 14,
    },
    bodyColor: (imp) => lerpColor('#f6f8fb', '#5a4535', Math.pow(clamp01(imp), 0.8)),
    dopant: { element: 'Al', replaces: 'Si', label: 'Al³⁺ (smoky centres)', maxLabel: '≈ 200 ppm', effect: 'Al³⁺ + irradiation → smoky' },
    lattice: 'alpha-quartz',
    layerSpacing: QUARTZ_CELL.c / 3,
    habitNote: 'Six-sided prisms capped by two rhombohedra (large r, small z). Above the α–β inversion it grows as β-quartz bipyramids.',
    swatch: '#e8eef5',
    defaults: { temperature: 380, pressure: 1.5, saturation: 1.35, impurity: 0.05 },
  },

  amethyst: {
    id: 'amethyst',
    name: 'Amethyst',
    mineral: 'Quartz (var. amethyst)',
    formula: 'SiO₂ : Fe³⁺',
    system: 'trigonal',
    pointGroup: '32',
    spaceGroup: 'P3₂21',
    cell: QUARTZ_CELL,
    faces: QUARTZ_FACES,
    faceRates: (env) => {
      const s = Math.min(sigmaPos(env), 1.5)
      const b = betaFraction(env)
      // Stubby geode points: rhombohedra barely faster than the prism; iron
      // poisons the prism faces, so high Fe → almost pure terminations.
      const r = (1.1 + 0.4 * s) * (1 - b) + 1.0 * b
      const z = r * (1.35 * (1 - b) + 1.0 * b)
      const m = (1 + 0.7 * clamp01(env.impurity)) * (1 - b) + 6 * b
      return [m, r, z, 6]
    },
    stability: quartzStability,
    phaseNote: (env, peakT) => {
      const q = quartzPhaseNote(env)
      if (q) return q
      if (peakT > 330) return 'Heat-treated: Fe colour centres destroyed → citrine / colourless'
      if (env.temperature > 250) return 'Too hot for colour centres — new growth is pale'
      return null
    },
    kinetics: {
      r0: 0.75,
      activation: 55,
      tRef: 180,
      sigmaCrit: 0.25,
      dissolution: 0.5,
      maxRadius: 6.5,
      nucleation: { j0: 1.6, barrier: 0.08, max: 46 },
    },
    substrate: 'geode',
    substrateColor: '#6b5d52',
    optics: { ior: 1.544, dispersion: 0.013, birefringence: 0.009, density: 2.65, hardness: 7, roughness: 0.03 },
    look: {
      luster: 'vitreous',
      pleochroism: { alongC: '#c9a3ff', acrossC: '#ff9fd0' }, // weak: bluish-violet / reddish-purple
      fluorescence: null,
      thermochromism: null,
      inclusions: { kind: 'zoning', color: '#6a2fb8', density: 0.8 },
      fire: 10,
      absorptionMm: 10,
    },
    bodyColor: (imp, growthT, peakT) => {
      // Fe³⁺ only forms colour centres when it grows cool; heating bleaches irreversibly
      const fe = Math.pow(clamp01(imp), 0.8) * (1 - smoothstep(230, 380, growthT))
      const purple = lerpColor('#f1ecf6', '#7a2fc0', fe)
      const citrine = lerpColor('#f4eee2', '#e29a2e', fe)
      const bleached = lerpColor(purple, citrine, smoothstep(330, 470, peakT))
      return lerpColor(bleached, '#efebe3', smoothstep(520, 640, peakT))
    },
    dopant: { element: 'Fe', replaces: 'Si', label: 'Fe³⁺', maxLabel: '≈ 400 ppm', effect: 'Fe³⁺ colour centres → violet; heat → citrine' },
    lattice: 'alpha-quartz',
    layerSpacing: QUARTZ_CELL.c / 3,
    habitNote: 'Short rhombohedral points lining a volcanic geode. Colour needs iron, low growth temperature and natural irradiation.',
    swatch: '#9b5de5',
    defaults: { temperature: 170, pressure: 0.3, saturation: 1.4, impurity: 0.6 },
  },

  diamond: {
    id: 'diamond',
    name: 'Diamond',
    mineral: 'Diamond',
    formula: 'C',
    system: 'cubic',
    pointGroup: 'm-3m',
    spaceGroup: 'Fd-3m',
    cell: { a: 3.567, b: 3.567, c: 3.567 },
    faces: [
      { symbol: 'o', form: '{111}', name: 'octahedron', miller: [1, 1, 1], dissolve: 0.35, color: '#60a5fa' },
      { symbol: 'a', form: '{100}', name: 'cube', miller: [1, 0, 0], dissolve: 0.55, color: '#f472b6' },
      { symbol: 'd', form: '{110}', name: 'dodecahedron', miller: [1, 1, 0], dissolve: 1.1, color: '#fbbf24' },
    ],
    faceRates: (env) => {
      // HPHT habit rule: cubes when cool, octahedra when hot.
      // α = √3·v100/v111: ≤1 cube, 1–3 cubo-octahedron, ≥3 octahedron.
      const alpha = 1 + 2 * smoothstep(1150, 1450, env.temperature)
      return [1, alpha / Math.sqrt(3), 1.6]
    },
    stability: (env) => {
      const peq = graphiteDiamondP(env.temperature)
      return smoothstep(peq - 0.5, peq + 2, env.pressure) * smoothstep(850, 950, env.temperature)
    },
    phaseNote: (env) => {
      const peq = graphiteDiamondP(env.temperature)
      if (env.pressure < peq) {
        return env.temperature > 1000
          ? 'Graphite field, hot — diamond resorbs / graphitises'
          : 'Graphite field — diamond is metastable (no growth)'
      }
      if (env.temperature < 900) return 'Too cold for carbon transport — growth stalls'
      return null
    },
    kinetics: {
      r0: 1.0,
      activation: 180,
      tRef: 1350,
      sigmaCrit: 0.4,
      dissolution: 0.35,
      maxRadius: 4,
      nucleation: { j0: 0.25, barrier: 0.25, max: 7 },
      metastableDecay: (env) => {
        const below = graphiteDiamondP(env.temperature) - env.pressure
        if (below <= 0) return 0
        return 0.12 * smoothstep(1000, 1400, env.temperature) * clamp01(below / 10)
      },
    },
    substrate: 'kimberlite',
    substrateColor: '#2f3a34',
    optics: { ior: 2.417, dispersion: 0.044, birefringence: 0, density: 3.52, hardness: 10, roughness: 0.01 },
    look: {
      luster: 'adamantine',
      pleochroism: null, // cubic: optically isotropic
      fluorescence: { color: '#4f7dff', strength: 0.35 }, // N3 centre blue (weak here: type Ib is mostly inert)
      thermochromism: null,
      inclusions: { kind: 'pinpoint', color: '#1a1a1f', density: 0.25 },
      fire: 22,
      absorptionMm: 8,
    },
    bodyColor: (imp) => lerpColor('#fbfdff', '#f0cf3a', Math.pow(clamp01(imp), 1.1) * 0.9),
    dopant: { element: 'N', replaces: 'C', label: 'N (type Ib)', maxLabel: '≈ 300 ppm', effect: 'isolated N → yellow' },
    lattice: 'diamond',
    layerSpacing: 3.567 / 4,
    habitNote: 'Cubic. Cool HPHT growth gives cubes, hot growth octahedra; resorption rounds edges into dodecahedroids.',
    swatch: '#e6f4ff',
    defaults: { temperature: 1350, pressure: 55, saturation: 1.3, impurity: 0.1 },
  },

  ruby: {
    id: 'ruby',
    name: 'Ruby',
    mineral: 'Corundum (var. ruby)',
    formula: 'Al₂O₃ : Cr³⁺',
    system: 'trigonal',
    pointGroup: '-3m',
    spaceGroup: 'R-3c',
    cell: { a: 4.759, b: 4.759, c: 12.99 },
    // structural-cell indices; morphological forms (c halved) shown in `form`
    faces: [
      { symbol: 'a', form: '{11-20}', name: 'hexagonal prism', miller: [1, 1, 0], dissolve: 0.6, color: '#60a5fa' },
      { symbol: 'c', form: '{0001}', name: 'basal pinacoid', miller: [0, 0, 1], dissolve: 0.4, color: '#f472b6' },
      { symbol: 'n', form: '{22-43}', name: 'hexagonal bipyramid', miller: [1, 1, 3], dissolve: 0.7, color: '#fbbf24' },
      { symbol: 'r', form: '{10-11}', name: 'rhombohedron', miller: [1, 0, 2], dissolve: 0.8, color: '#a3e635' },
    ],
    faceRates: (env) => {
      // Rule: hot (flux/magmatic) growth → flat tabular plates (slow basal face);
      // cooler metamorphic growth → barrel-shaped bipyramids.
      const tab = smoothstep(700, 1250, env.temperature)
      const c = 2.0 * (1 - tab) + 0.45 * tab
      const n = 1.12 + 0.15 * Math.min(sigmaPos(env), 1.5)
      return [1, c, n, 1.5]
    },
    stability: (env) => smoothstep(400, 480, env.temperature) * (1 - smoothstep(35, 45, env.pressure)),
    phaseNote: (env) => (env.temperature < 450 ? 'Diaspore / boehmite field — hydrous Al-oxides grow instead' : null),
    kinetics: {
      r0: 1.3,
      activation: 110,
      tRef: 700,
      sigmaCrit: 0.35,
      dissolution: 0.3,
      maxRadius: 6,
      nucleation: { j0: 1.0, barrier: 0.16, max: 16 },
    },
    substrate: 'plate',
    substrateColor: '#d9d6cf',
    optics: { ior: 1.766, dispersion: 0.018, birefringence: 0.008, density: 4.0, hardness: 9, roughness: 0.03 },
    look: {
      luster: 'subadamantine',
      pleochroism: { alongC: '#d0306a', acrossC: '#ff6a3a' }, // strong: purplish-red (ω) / orange-red (ε)
      fluorescence: { color: '#ff1a2a', strength: 1 }, // Cr³⁺ R-lines at 694 nm — rubies glow under light
      thermochromism: { color: '#6f8a5a', from: 300, to: 900 }, // hot ruby turns green-grey, red again on cooling
      inclusions: { kind: 'silk', color: '#fff3e8', density: 0.6 },
      fire: 11,
      absorptionMm: 3,
    },
    bodyColor: (imp) =>
      rampColor(
        [
          [0, '#f4f4f7'],
          [0.25, '#f08db2'],
          [1, '#c40f2e'],
        ],
        imp
      ),
    dopant: { element: 'Cr', replaces: 'Al', label: 'Cr³⁺', maxLabel: '≈ 2 wt% Cr₂O₃', effect: 'Cr³⁺ → pink sapphire → ruby' },
    lattice: 'corundum',
    layerSpacing: 12.99 / 6,
    habitNote: 'Trigonal. Marble-hosted rubies grow as barrel bipyramids; hot flux growth gives flat hexagonal tablets.',
    swatch: '#d3143a',
    defaults: { temperature: 650, pressure: 3, saturation: 1.3, impurity: 0.6 },
  },

  emerald: {
    id: 'emerald',
    name: 'Emerald',
    mineral: 'Beryl (var. emerald)',
    formula: 'Be₃Al₂Si₆O₁₈ : Cr³⁺',
    system: 'hexagonal',
    pointGroup: '6/mmm',
    spaceGroup: 'P6/mcc',
    cell: { a: 9.21, b: 9.21, c: 9.19 },
    faces: [
      { symbol: 'm', form: '{10-10}', name: 'hexagonal prism', miller: [1, 0, 0], dissolve: 0.5, color: '#60a5fa' },
      { symbol: 'c', form: '{0001}', name: 'basal pinacoid', miller: [0, 0, 1], dissolve: 0.6, color: '#f472b6' },
      { symbol: 'p', form: '{10-11}', name: 'hexagonal bipyramid', miller: [1, 0, 1], dissolve: 0.9, color: '#fbbf24' },
    ],
    faceRates: (env) => {
      // Flat-topped hexagonal prisms; supersaturation drives c-axis elongation
      // and the bipyramid only bevels the rim (rate just under its cut-off).
      const c = 1.9 + 2.2 * Math.min(sigmaPos(env), 1.5)
      return [1, c, 0.72 + 0.62 * c]
    },
    stability: (env) =>
      smoothstep(230, 280, env.temperature) *
      (1 - smoothstep(780, 860, env.temperature)) *
      smoothstep(0.15, 0.35, env.pressure) *
      (1 - smoothstep(11, 13, env.pressure)),
    phaseNote: (env) => {
      if (env.temperature > 800) return 'Beryl breaks down → chrysoberyl + phenakite + quartz'
      if (env.temperature < 250) return 'Too cool — Be-bearing brine stays in solution'
      if (env.pressure < 0.3) return 'Too shallow — fluids boil off'
      return null
    },
    kinetics: {
      r0: 1.1,
      activation: 90,
      tRef: 400,
      sigmaCrit: 0.3,
      dissolution: 0.35,
      maxRadius: 7,
      nucleation: { j0: 1.1, barrier: 0.14, max: 18 },
    },
    substrate: 'plate',
    substrateColor: '#24262a',
    optics: { ior: 1.577, dispersion: 0.014, birefringence: 0.006, density: 2.76, hardness: 7.75, roughness: 0.04 },
    look: {
      luster: 'vitreous',
      pleochroism: { alongC: '#9edc4a', acrossC: '#22c3a8' }, // yellowish-green (ω) / bluish-green (ε)
      fluorescence: { color: '#ff3a3a', strength: 0.18 }, // weak Cr³⁺ red, quenched by iron in most stones
      thermochromism: null,
      inclusions: { kind: 'jardin', color: '#3c5a3a', density: 0.75 },
      fire: 10,
      absorptionMm: 4,
    },
    bodyColor: (imp) => lerpColor('#e8f3ec', '#0e9a50', Math.pow(clamp01(imp), 0.85)),
    dopant: { element: 'Cr', replaces: 'Al', label: 'Cr³⁺ / V³⁺', maxLabel: '≈ 1 wt% Cr₂O₃', effect: 'Cr³⁺/V³⁺ → emerald green' },
    lattice: 'beryl',
    layerSpacing: 9.19 / 4,
    habitNote: 'Hexagonal prisms with flat basal terminations, grown from Be-rich brines in black-shale veins.',
    swatch: '#12a454',
    defaults: { temperature: 360, pressure: 1.5, saturation: 1.4, impurity: 0.7 },
  },

  topaz: {
    id: 'topaz',
    name: 'Topaz',
    mineral: 'Topaz',
    formula: 'Al₂SiO₄(F,OH)₂',
    system: 'orthorhombic',
    pointGroup: 'mmm',
    spaceGroup: 'Pbnm',
    cell: { a: 4.65, b: 8.8, c: 8.39 },
    faces: [
      { symbol: 'm', form: '{110}', name: 'rhombic prism', miller: [1, 1, 0], dissolve: 0.5, color: '#60a5fa' },
      { symbol: 'l', form: '{120}', name: 'rhombic prism', miller: [1, 2, 0], dissolve: 0.55, color: '#38bdf8' },
      { symbol: 'f', form: '{021}', name: 'brachydome', miller: [0, 2, 1], dissolve: 0.8, color: '#f472b6' },
      { symbol: 'o', form: '{111}', name: 'dipyramid', miller: [1, 1, 1], dissolve: 0.8, color: '#fbbf24' },
      { symbol: 'c', form: '{001}', name: 'basal pinacoid', miller: [0, 0, 1], dissolve: 0.5, color: '#a3e635' },
    ],
    faceRates: (env) => {
      // Rule: prisms along c; supersaturation sharpens the dome/dipyramid wedge,
      // while slow, cool growth lets the basal cleavage face survive.
      const s = Math.min(sigmaPos(env), 1.5)
      const cool = 1 - smoothstep(450, 650, env.temperature)
      return [1, 1.06, 1.75 + 0.5 * s, 1.85 + 0.45 * s, 2.7 + 1.4 * s - 0.6 * cool]
    },
    stability: (env) =>
      smoothstep(330, 380, env.temperature) *
      (1 - smoothstep(920, 980, env.temperature)) *
      smoothstep(0.3, 0.6, env.pressure) *
      (1 - smoothstep(28, 34, env.pressure)),
    phaseNote: (env) => {
      if (env.temperature > 950) return 'Topaz breaks down → mullite + SiF₄'
      if (env.temperature < 350) return 'Too cool — fluorine stays in the fluid'
      return null
    },
    kinetics: {
      r0: 1.0,
      activation: 100,
      tRef: 550,
      sigmaCrit: 0.3,
      dissolution: 0.35,
      maxRadius: 9,
      nucleation: { j0: 0.9, barrier: 0.15, max: 14 },
    },
    substrate: 'plate',
    substrateColor: '#cdb8a2',
    optics: { ior: 1.619, dispersion: 0.014, birefringence: 0.009, density: 3.55, hardness: 8, roughness: 0.03 },
    look: {
      luster: 'vitreous',
      pleochroism: { alongC: '#ffd27a', acrossC: '#ff8fa6' }, // imperial: golden / pink (biaxial, two shown)
      fluorescence: { color: '#ff9a4a', strength: 0.12 },
      thermochromism: null,
      inclusions: { kind: 'cleavage', color: '#ffffff', density: 0.5 },
      fire: 10,
      absorptionMm: 9,
    },
    bodyColor: (imp) => lerpColor('#f3f6fa', '#e4893a', Math.pow(clamp01(imp), 0.9)),
    dopant: { element: 'Cr', replaces: 'Al', label: 'Cr³⁺ (imperial)', maxLabel: '≈ 0.1 wt% Cr₂O₃', effect: 'Cr³⁺ → imperial orange-pink' },
    lattice: 'topaz',
    layerSpacing: 8.39 / 4,
    habitNote: 'Orthorhombic. Rhombic prisms striated along c, wedge-terminated by domes and a dipyramid; grows in pegmatite pockets.',
    swatch: '#e9a15a',
    defaults: { temperature: 520, pressure: 2.5, saturation: 1.35, impurity: 0.4 },
  },
}

export const GEMSTONE_IDS = Object.keys(GEMSTONE_PRESETS) as GemstoneId[]

/** Slider ranges for the geology panel. */
export const GEOLOGY_RANGES = {
  temperature: { min: 25, max: 1600 },
  pressure: { min: 0.01, max: 80 }, // log slider
  saturation: { min: 0.5, max: 2.5 },
  impurity: { min: 0, max: 1 },
} as const
