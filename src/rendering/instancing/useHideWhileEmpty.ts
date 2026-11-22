/**
 * Keeps an `InstancedMesh` out of the render list while it has no instances.
 *
 * Borrowed from ford442/watershed (`src/rendering/instancing/`), trimmed to the
 * one rule this repo needs. Watershed found that three's node (WebGPU/TSL)
 * pipeline cannot compile a zero-count `InstancedMesh` — it emits an unsized
 * `mat4` array inside a uniform block — and that rendering **one** frame at
 * count 0 poisons that object's program for good: raising the count later does
 * not rebuild it. The classic `WebGLRenderer` never cared, and parasite mode is
 * classic-only today (`NODE_READY_MODES.parasite`), so here the guard is
 * insurance for the port plus a free saving: an empty layer costs no draw call.
 *
 * Order matters. Call this *after* the `useFrame` that sets `mesh.count`, so the
 * guard sees this frame's count and not the previous one (subscribers of equal
 * priority run in registration order), and mount the mesh with `visible={false}`
 * so the very first rendered frame is safe whenever its owner first fills it.
 */

import { useFrame } from '@react-three/fiber'
import type { RefObject } from 'react'
import type * as THREE from 'three'

/** An instanced mesh may only be drawn while it has instances (and was not hidden by its owner). */
export function resolveInstancedVisibility(count: number, declaredVisible: boolean): boolean {
  return declaredVisible && count > 0
}

export function useHideWhileEmpty(ref: RefObject<THREE.InstancedMesh | null>, declaredVisible = true): void {
  useFrame(() => {
    const mesh = ref.current
    if (!mesh) return
    const wanted = resolveInstancedVisibility(mesh.count, declaredVisible)
    if (mesh.visible !== wanted) mesh.visible = wanted
  })
}
