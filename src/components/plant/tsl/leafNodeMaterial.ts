/**
 * TSL leaf material — the first node material in the project (issue #19).
 *
 * LOAD ONLY VIA DYNAMIC `import()` (see `useLeafNodeMaterial.ts`). This module
 * statically imports `three/webgpu` and `three/tsl`; a static import anywhere
 * on the default path would drag the whole WebGPU build into the WebGL-only
 * bundle. Node materials also only work on `WebGPURenderer` — on the classic
 * `WebGLRenderer` they would fail to compile — so callers must check
 * `describeRenderer()` first.
 *
 * Built on `MeshSSSNodeMaterial` (a `MeshPhysicalNodeMaterial` with a
 * thickness / back-scatter term), so a leaf glows yellow-green when the sun is
 * behind it. What it does beyond the standard material:
 *
 *  - chlorophyll   pigment mixes from healthy green to senescent yellow-brown,
 *                  and the veins stay green longest (interveinal chlorosis)
 *  - translucency  light scattered through the blade, tinted by the pigment
 *  - wetness       rain / dew darkens the leaf and makes it glossy
 *  - flutter       wind moves the free tip of each leaf, out of phase per leaf
 *
 * The four inputs are uniforms driven by `leafAppearance()`; changing them
 * never recompiles the pipeline. Shape comes from the shared blade mesh
 * (`leafGeometry.ts`) — this material only changes shading and a vertex offset.
 */
import { Color, DoubleSide } from 'three'
import { MeshSSSNodeMaterial } from 'three/webgpu'
import {
  Fn,
  abs,
  color,
  float,
  fract,
  hash,
  instanceIndex,
  mix,
  normalLocal,
  positionLocal,
  sin,
  smoothstep,
  time,
  uniform,
  uv,
  vec3,
} from 'three/tsl'
import type { LeafAppearance } from '../leafAppearance'

/** The colour the classic material swaps to when the plant is stressed; chlorophyll 0 lands here. */
const SENESCENT = '#8a7a3a'
/** Peak tip displacement at full wind, in plant-local units (a leaf is ~0.2 long). */
const FLUTTER_AMPLITUDE = 0.035

export interface LeafNodeMaterial {
  readonly material: MeshSSSNodeMaterial
  /**
   * Push the current appearance into the shader uniforms. `baseColor` is the
   * species' healthy leaf colour. Cheap and allocation-free: call every frame.
   */
  update(appearance: LeafAppearance, baseColor: string, wetness: number): void
  dispose(): void
}

export function createLeafNodeMaterial(initialBaseColor = '#3d8b3d'): LeafNodeMaterial {
  const uBase = uniform(new Color(initialBaseColor))
  const uChlorophyll = uniform(1)
  const uWetness = uniform(0)
  const uTranslucency = uniform(1)
  const uFlutter = uniform(0)

  // --- albedo ---------------------------------------------------------------
  // Midrib plus lateral veins slanting towards the tip, from the blade's UVs (u across, midrib at 0.5; v base → tip).
  const veins = Fn(() => {
    const { x: u, y: v } = uv()
    const fromMid = abs(u.sub(0.5))
    const midrib = smoothstep(0.035, 0.0, fromMid)
    const f = fract(v.mul(7.0).sub(fromMid.mul(3.0)))
    const lateral = smoothstep(0.0, 0.07, f.min(f.oneMinus())).oneMinus()
    // laterals fade out before the margin so the blade edge stays clean
    const inside = smoothstep(0.5, 0.3, fromMid)
    return midrib.max(lateral.mul(inside).mul(0.7))
  })()

  const leafColor = Fn(() => {
    // veins keep their pigment as the blade yellows
    const localChlorophyll = uChlorophyll.add(veins.mul(0.35).mul(uChlorophyll.oneMinus())).clamp(0, 1)
    const blade = mix(color(SENESCENT), uBase, localChlorophyll)
    const veinTint = mix(blade, vec3(0.62, 0.78, 0.4), 0.32)
    const withVeins = mix(blade, veinTint, veins.mul(0.8))
    // per-leaf brightness, deterministic in the instance index
    const tone = hash(instanceIndex).mul(0.18).add(0.91)
    // a wet leaf is darker (water film raises effective refractive index)
    return withVeins.mul(tone).mul(uWetness.mul(0.22).oneMinus())
  })()

  // --- wind -----------------------------------------------------------------
  // `positionNode` runs after the instance matrix, so `positionLocal` and
  // `normalLocal` are already in plant space: push along the leaf's own normal.
  const flutterPosition = Fn(() => {
    const phase = hash(instanceIndex).mul(6.2831853)
    const wave = sin(time.mul(7.0).add(phase)).mul(0.6).add(sin(time.mul(11.3).add(phase.mul(1.7))).mul(0.4))
    const tip = uv().y.mul(uv().y) // pinned at the base, free at the tip
    return positionLocal.add(normalLocal.normalize().mul(wave.mul(tip).mul(uFlutter).mul(FLUTTER_AMPLITUDE)))
  })()

  const material = new MeshSSSNodeMaterial()
  material.side = DoubleSide
  // mirrored into the plain properties so GLB export (plantExport.ts), which
  // reads them, still gets a sensible PBR leaf from this material
  material.color.set(initialBaseColor)
  material.roughness = 0.7
  material.metalness = 0.05

  material.colorNode = leafColor
  material.roughnessNode = mix(float(0.7), float(0.16), uWetness)
  material.metalnessNode = float(0.05)

  // translucency: scattered light is yellower than the surface (chlorophyll
  // absorbs blue and red-ish light on the way through) and scales with hydration
  material.thicknessColorNode = leafColor.mul(vec3(1.25, 1.3, 0.35)).mul(uTranslucency)
  material.thicknessDistortionNode = float(0.25)
  material.thicknessAmbientNode = float(0.12)
  material.thicknessAttenuationNode = float(0.14)
  material.thicknessPowerNode = float(3.0)
  material.thicknessScaleNode = float(8.0)

  material.positionNode = flutterPosition

  let lastBase = initialBaseColor
  return {
    material,
    update(appearance, baseColor, wetness) {
      if (baseColor !== lastBase) {
        lastBase = baseColor
        uBase.value.set(baseColor)
        material.color.set(baseColor)
      }
      uChlorophyll.value = appearance.chlorophyll
      uTranslucency.value = appearance.translucency
      uFlutter.value = appearance.flutter
      uWetness.value = wetness
    },
    dispose() {
      material.dispose()
    },
  }
}
