import { useEffect, useRef } from 'react'
import { useThree } from '@react-three/fiber'
import * as THREE from 'three'
import { StemDisc } from './cellular/StemDisc'
import { CellLens } from './cellular/CellLens'
import { CENTER_SHIFT, LENS_X, SCENE_HEIGHT, SCENE_WIDTH } from './cellular/geometry'

/**
 * The camera looks square-on: any tilt keystones the lens (verticals converge),
 * and the strip is meant to read like a flat microscope plate. Orbit to see depth.
 */
const CAMERA_LIFT = 0
const CAMERA_MARGIN = 1.08
/** Fallback height of the status strip (TissueHud) along the foot of the viewport, in CSS px. */
const HUD_RESERVE_PX = 124

/**
 * Frames the shared camera square-on to the cross-section, and puts it back
 * where it found it on unmount so the other plant views keep their own framing.
 * The distance is recomputed from the viewport so the whole composition (disc,
 * guides, lens, labels) fits at any window shape.
 */
function CellularCameraRig() {
  const camera = useThree((s) => s.camera) as THREE.PerspectiveCamera
  const size = useThree((s) => s.size)
  const controls = useThree((s) => s.controls) as { target: THREE.Vector3; update: () => void } | null
  const get = useThree((s) => s.get)
  const dom = useThree((s) => s.gl.domElement)
  const entry = useRef<THREE.Vector3 | null>(null)

  useEffect(() => {
    if (!entry.current) entry.current = camera.position.clone()
    return () => {
      if (entry.current) camera.position.copy(entry.current)
      // the other plant views orbit around the origin
      const c = get().controls as { target: THREE.Vector3; update: () => void } | null
      c?.target.set(0, 0, 0)
      c?.update()
    }
  }, [camera, get])

  useEffect(() => {
    const aspect = size.width / Math.max(1, size.height)
    const halfV = Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2)
    // fit the scene into the part of the viewport above the status strip (measured: it grows when the window narrows)
    const hud = dom.parentElement?.querySelector<HTMLElement>('.tissue-hud')
    const reserve = hud ? hud.offsetHeight + 28 : HUD_RESERVE_PX
    const free = Math.max(0.3, 1 - reserve / Math.max(1, size.height))
    const dist =
      Math.max(SCENE_HEIGHT / (2 * halfV * free), SCENE_WIDTH / (2 * halfV * aspect)) * CAMERA_MARGIN
    // …and slide the camera down so the scene sits in the middle of that free part
    const shift = (reserve / 2) * ((2 * halfV * dist) / Math.max(1, size.height))
    camera.position.set(0, CAMERA_LIFT - shift, dist)
    camera.updateProjectionMatrix()
    controls?.target.set(0, -shift, 0)
    controls?.update()
  }, [camera, controls, dom, size.width, size.height])

  return null
}

/**
 * Cellular scale: a real stem cross-section.
 *
 * Left, the whole slice (pith, one band per growth ring, cambium, bark). Right,
 * a magnified strip of it at 3 o'clock showing the cells themselves dividing,
 * enlarging and hardening. Both are drawn from `simStore.tissue`, which is
 * stepped by the shared clock from the same weather and water status as the
 * rest of the plant, so drought, cold and shade show up here as slowed division,
 * small cells and narrow rings.
 */
export function CellularView() {
  return (
    <group position={[CENTER_SHIFT, 0, 0]}>
      <CellularCameraRig />
      <group position={[LENS_X, 0, 0]}>
        <CellLens />
      </group>
      <StemDisc />
    </group>
  )
}
