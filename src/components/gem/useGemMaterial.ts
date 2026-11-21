import { useEffect, useMemo, useState } from 'react'
import { useThree } from '@react-three/fiber'
import * as THREE from 'three'
import { describeRenderer } from '../../rendering'
import type { GemAppearance } from '../../simulation/GemOptics'
import type { GemstoneDef } from '../../simulation/GemstonePresets'
import type { GemNodeMaterial } from './tsl/gemNodeMaterial'

export interface GemMaterial {
  material: THREE.MeshPhysicalMaterial
  /** true once the TSL material is drawing (WebGPURenderer, chunk loaded). */
  isNode: boolean
  /**
   * Push the current appearance in. `worldPerMm` converts the Beer–Lambert
   * distance into scene units, `thickness` is the light path through the
   * specimen (≈ its radius; GemstoneDef.look.absorptionMm is tuned to that) in the units
   * three expects: the mesh's local units, since three multiplies it by the model matrix scale. Allocation-free; call every frame.
   */
  update(a: GemAppearance, frost: number, worldPerMm: number, thickness: number): void
}

const tmp = new THREE.Color()

/** Shared by both backends: everything the plain physical properties can express. */
function applyPhysical(m: THREE.MeshPhysicalMaterial, a: GemAppearance, frost: number, worldPerMm: number, thickness: number, node: boolean) {
  m.ior = a.ior
  m.dispersion = a.dispersion
  m.thickness = thickness
  m.attenuationColor.set(a.body)
  m.attenuationDistance = Math.max(1e-3, a.attenuationMm * worldPerMm)
  m.specularIntensity = a.specularIntensity
  m.clearcoat = a.clearcoat
  m.envMapIntensity = a.envMapIntensity
  // mirrored for GLB export / the classic path; the node material overrides these with nodes
  m.roughness = a.roughness + 0.5 * frost
  if (!node) {
    m.transmission = 0.96 - 0.2 * frost
    m.clearcoatRoughness = 0.05 + 0.45 * frost
    // fluorescence + incandescence + a faint body glow, summed into one emissive colour
    m.emissive.set(a.body).multiplyScalar(0.14) // light scattered inside the stone
    m.emissive.add(tmp.set(a.fluorescenceColor).multiplyScalar(a.fluorescence * 0.3))
    m.emissive.add(tmp.set(a.incandescenceColor).multiplyScalar(a.incandescence))
    m.emissiveIntensity = 1
  }
}

/**
 * The gem's optical material. Classic `MeshPhysicalMaterial` (pleochroism via
 * the habit's vertex colours) on WebGL; on a node renderer the TSL material
 * (`tsl/gemNodeMaterial.ts`, dynamic import only) replaces it once loaded, and
 * the classic one stays if loading fails. Owned here — created per gemstone,
 * disposed on unmount (R3F does not dispose `<primitive>` objects).
 */
export function useGemMaterial(def: GemstoneDef): GemMaterial {
  const gl = useThree((s) => s.gl)
  const nodeRenderer = describeRenderer(gl) !== 'webgl'
  const classic = useMemo(() => {
    const m = new THREE.MeshPhysicalMaterial({
      vertexColors: true,
      transmission: 0.96,
      flatShading: true,
      clearcoatRoughness: 0.05,
    })
    m.name = `gem:${def.id}`
    return m
  }, [def])
  useEffect(() => () => classic.dispose(), [classic])

  const [node, setNode] = useState<GemNodeMaterial | null>(null)
  useEffect(() => {
    if (!nodeRenderer) return
    let alive = true
    let created: GemNodeMaterial | null = null
    import('./tsl/gemNodeMaterial')
      .then((m) => {
        if (!alive) return
        created = m.createGemNodeMaterial(def.look.inclusions.kind)
        created.material.name = `gem:${def.id}`
        setNode(created)
      })
      .catch((err) => console.warn('[Gem] TSL material unavailable — keeping the physical material', err))
    return () => {
      alive = false
      created?.dispose()
      setNode(null)
    }
  }, [nodeRenderer, def])

  return useMemo<GemMaterial>(() => {
    if (node) {
      return {
        material: node.material as unknown as THREE.MeshPhysicalMaterial,
        isNode: true,
        update(a, frost, worldPerMm, thickness) {
          applyPhysical(node.material as unknown as THREE.MeshPhysicalMaterial, a, frost, worldPerMm, thickness, true)
          node.update(a, frost)
        },
      }
    }
    return {
      material: classic,
      isNode: false,
      update(a, frost, worldPerMm, thickness) {
        applyPhysical(classic, a, frost, worldPerMm, thickness, false)
      },
    }
  }, [node, classic])
}
