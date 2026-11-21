/**
 * TSL gem material — optical look per gemstone (gem epic #1, issue #15).
 *
 * LOAD ONLY VIA DYNAMIC `import()` (see `useGemMaterial.ts`): this module
 * statically imports `three/webgpu` and `three/tsl`, and node materials only
 * compile on `WebGPURenderer` (callers check `describeRenderer()` first).
 *
 * A `MeshPhysicalNodeMaterial` (transmission, IOR, dispersion, Beer–Lambert
 * attenuation — all read from the plain material properties, which the view
 * updates each frame without recompiling) plus what the classic material
 * cannot do:
 *
 *  - pleochroism    colour depends on how the face you look through sits to the
 *                   c-axis (`pleo` vertex attribute = |n·c|: a basal face shows
 *                   the ordinary-ray colour, a prism face the extraordinary)
 *  - inclusions     one procedural scene per gem, in habit-local coordinates
 *                   (`positionGeometry`: unit equivalent radius, c = +Y), so
 *                   they stay put inside each instance as it grows:
 *                   veils · colour zoning · pinpoints · rutile silk · jardin · cleavage
 *  - fluorescence   dopant glow, strongest where light enters (facing the key light)
 *  - incandescence  blackbody glow from the inside of a hot crystal (less at grazing angles)
 *  - frost          etch-pit roughness while dissolving
 *
 * All inputs are uniforms (`update()`); only the inclusion kind is fixed at
 * creation — the material is rebuilt with the gemstone, as the views are.
 */
import { Color, FrontSide } from 'three'
import { MeshPhysicalNodeMaterial, type Node } from 'three/webgpu'
import {
  Fn,
  abs,
  attribute,
  clamp,
  dot,
  float,
  floor,
  fract,
  hash,
  length,
  max,
  mix,
  mx_fractal_noise_float,
  mx_noise_float,
  normalView,
  normalize,
  positionGeometry,
  positionViewDirection,
  smoothstep,
  uniform,
  vec2,
  vec3,
} from 'three/tsl'
import type { GemAppearance } from '../../../simulation/GemOptics'
import type { InclusionKind } from '../../../simulation/GemstonePresets'

export interface GemNodeMaterial {
  readonly material: MeshPhysicalNodeMaterial
  update(a: GemAppearance, frost: number): void
  dispose(): void
}

type N = Node<'float'>

/** Inclusion field for one gem: `mask` (0–1 where there is something), plus how it shades. */
interface InclusionNodes {
  /** multiplies the base colour (dark solids, colour bands) */
  shade: N
  /** subtracted from transmission (milky veils, mossy jardin) */
  cloud: N
  /** added light (needles and cracks catching the key light) */
  glint: N
  /** thin-film interference strength (cleavage cracks) */
  film: N
}

function inclusionNodes(kind: InclusionKind, density: N): InclusionNodes {
  const p = positionGeometry
  const zero = float(0)
  const one = float(1)
  switch (kind) {
    case 'veils': {
      // healed fractures: a few wavy sheets of fluid inclusions
      const warp = mx_noise_float(p.mul(2.2)).mul(0.6)
      const sheet = abs(fract(dot(p, vec3(0.55, 0.35, 0.76)).mul(2.5).add(warp)).sub(0.5))
      const veil = smoothstep(0.06, 0.0, sheet).mul(mx_noise_float(p.mul(9.0)).mul(0.5).add(0.5)).mul(density)
      return { shade: one, cloud: veil.mul(0.35), glint: veil.mul(0.12), film: zero }
    }
    case 'zoning': {
      // amethyst: colour concentrated in growth bands parallel to the rhombohedron faces
      const sector = abs(p.y).mul(0.7).add(length(p.xz).mul(0.5))
      const band = smoothstep(0.25, 0.75, abs(fract(sector.mul(4.0).add(mx_noise_float(p.mul(1.5)).mul(0.15))).sub(0.5)).mul(2.0))
      return { shade: mix(one, float(0.55), band.mul(density)), cloud: zero, glint: zero, film: zero }
    }
    case 'pinpoint': {
      // sparse tiny dark crystals (graphite / sulphide)
      const q = p.mul(11.0)
      const cell = floor(q)
      const keep = smoothstep(0.93, 0.97, hash(dot(cell, vec3(1.0, 57.0, 113.0))))
      const d = length(fract(q).sub(0.5))
      const dot_ = smoothstep(0.14, 0.06, d).mul(keep).mul(density)
      return { shade: mix(one, float(0.15), dot_), cloud: zero, glint: zero, film: zero }
    }
    case 'silk': {
      // rutile needles in the basal plane, three sets 60° apart (what makes star rubies)
      const xz = p.xz.mul(24.0)
      const needles = (dx: number, dy: number, seed: number) => {
        const dir = vec2(dx, dy)
        const across = dot(xz, vec2(dir.y.negate(), dir.x))
        const along = dot(xz, dir)
        const line = smoothstep(0.07, 0.0, abs(fract(across).sub(0.5)))
        const broken = smoothstep(0.35, 0.6, mx_noise_float(vec3(along.mul(0.15), floor(across), p.y.mul(6.0).add(seed))))
        return line.mul(broken)
      }
      const silk = max(max(needles(1, 0, 0), needles(0.5, 0.8660254, 3)), needles(-0.5, 0.8660254, 7))
      const s = silk.mul(density)
      return { shade: one, cloud: s.mul(0.25), glint: s.mul(0.45), film: zero }
    }
    case 'jardin': {
      // emerald "garden": mossy, branching fracture fillings
      const moss = mx_fractal_noise_float(p.mul(3.2), 4, 2.0, 0.5)
      const m = smoothstep(0.05, 0.35, moss).mul(density)
      return { shade: mix(one, float(0.6), m), cloud: m.mul(0.45), glint: zero, film: zero }
    }
    case 'cleavage': {
      // topaz: perfect {001} cleavage — flat cracks across c that flash interference colours
      const crack = smoothstep(0.035, 0.0, abs(fract(p.y.mul(3.5).add(mx_noise_float(p.mul(0.8)).mul(0.12))).sub(0.5)))
      const patch = smoothstep(0.0, 0.3, mx_noise_float(p.mul(2.5)))
      const c = crack.mul(patch).mul(density)
      return { shade: one, cloud: c.mul(0.15), glint: c.mul(0.25), film: c }
    }
  }
}

export function createGemNodeMaterial(kind: InclusionKind): GemNodeMaterial {
  const uAlong = uniform(new Color('#ffffff'))
  const uAcross = uniform(new Color('#ffffff'))
  const uInclusions = uniform(0)
  const uFluor = uniform(0)
  const uFluorColor = uniform(new Color('#000000'))
  const uGlow = uniform(0)
  const uGlowColor = uniform(new Color('#000000'))
  const uFrost = uniform(0)
  const uRoughness = uniform(0.03)

  const inc = inclusionNodes(kind, uInclusions)
  // 1 head-on, 0 at grazing angles
  const facing = Fn(() => abs(dot(normalize(normalView), positionViewDirection)))()

  // |n·c| of the face you look through: 1 on a basal face (looking down c), 0 on a prism face
  const pleo = clamp(attribute('pleo', 'float'), 0, 1)

  const baseColor = Fn(() => {
    const k = pleo.mul(pleo)
    const tint = mix(uAcross, uAlong, k)
    // the colour mostly comes from absorption (attenuationColor); keep the surface tint light
    return mix(vec3(1, 1, 1), tint, 0.55).mul(inc.shade)
  })()

  const emissive = Fn(() => {
    const fluor = uFluorColor.mul(uFluor).mul(facing.mul(0.6).add(0.4)).mul(0.35)
    const glow = uGlowColor.mul(uGlow).mul(facing.mul(0.7).add(0.3))
    const glint = vec3(1, 0.97, 0.92).mul(inc.glint).mul(0.35)
    return fluor.add(glow).add(glint)
  })()

  const etch = Fn(() => smoothstep(-0.2, 0.6, mx_noise_float(positionGeometry.mul(28.0))))()

  const material = new MeshPhysicalNodeMaterial()
  material.side = FrontSide
  material.transmission = 0.96
  material.thickness = 1
  material.attenuationDistance = 1
  material.flatShading = true
  material.color.set('#ffffff')

  material.colorNode = baseColor
  material.emissiveNode = emissive
  material.roughnessNode = mix(uRoughness, float(0.55), uFrost.mul(etch.mul(0.6).add(0.4)))
  material.transmissionNode = float(0.96).sub(inc.cloud).sub(uFrost.mul(0.2)).clamp(0.3, 1)
  material.clearcoatRoughnessNode = mix(float(0.05), float(0.5), uFrost)
  if (kind === 'cleavage') {
    material.iridescenceNode = inc.film
    material.iridescenceIOR = 1.33 // air / fluid film in the crack
    material.iridescenceThicknessRange = [180, 650]
  }

  return {
    material,
    update(a, frost) {
      uAlong.value.set(a.alongC)
      uAcross.value.set(a.acrossC)
      uInclusions.value = a.inclusions
      uFluor.value = a.fluorescence
      uFluorColor.value.set(a.fluorescenceColor)
      uGlow.value = a.incandescence
      uGlowColor.value.set(a.incandescenceColor)
      uFrost.value = frost
      uRoughness.value = a.roughness
    },
    dispose() {
      material.dispose()
    },
  }
}
