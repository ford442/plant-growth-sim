import { useEffect, useRef, useState } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import { describeRenderer } from '../../rendering'
import { useSimStore } from '../../stores/simStore'
import { leafAppearance, relaxWetness } from './leafAppearance'
import type { LeafNodeMaterial } from './tsl/leafNodeMaterial'

/**
 * The TSL leaf material, kept in step with the simulation — or `null`, in which
 * case the caller draws its ordinary `meshStandardMaterial`. `null` is the
 * answer on the classic WebGL renderer, while the node module is still loading,
 * and if loading it fails, so the leaves are never missing.
 *
 * Called from a component that outlives the leaf mesh (`ArchitectureView`):
 * the mesh is re-keyed on every L-system stage and the material must not be
 * rebuilt — or flash back to the fallback — each time.
 */
export function useLeafNodeMaterial(baseColor: string): LeafNodeMaterial | null {
  const gl = useThree((s) => s.gl)
  const nodeRenderer = describeRenderer(gl) !== 'webgl'
  const [leaf, setLeaf] = useState<LeafNodeMaterial | null>(null)
  const wetness = useRef(0)

  useEffect(() => {
    if (!nodeRenderer) return
    let alive = true
    let created: LeafNodeMaterial | null = null
    // dynamic: keeps three/webgpu + three/tsl out of the WebGL-only bundle path
    import('./tsl/leafNodeMaterial')
      .then((m) => {
        if (!alive) return
        created = m.createLeafNodeMaterial(baseColor)
        setLeaf(created)
      })
      .catch((err) => console.warn('[Leaf] TSL material unavailable — keeping the standard material', err))
    return () => {
      alive = false
      created?.dispose()
      setLeaf(null)
    }
    // baseColor is pushed through update() below, not by rebuilding the material
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nodeRenderer])

  // Views derive from pure state each frame instead of subscribing (AGENTS.md conventions).
  useFrame((_, dt) => {
    if (!leaf) return
    const s = useSimStore.getState()
    const target = leafAppearance({
      waterStatus: s.waterStatus,
      nutrientStatus: s.nutrientStatus,
      light: s.weather.light,
      humidity: s.weather.humidity,
      precipitation: s.weather.precipitation,
      wind: s.weather.wind,
    })
    wetness.current = relaxWetness(wetness.current, target.wetness, dt)
    leaf.update(target, baseColor, wetness.current)
  })

  return leaf
}
