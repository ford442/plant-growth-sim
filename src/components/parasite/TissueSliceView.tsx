/**
 * The cyst garden: a flat section of tissue with the simulation's tissue cysts
 * growing on it, at real relative scale.
 *
 * Four instanced meshes, so four draw calls however many cysts there are —
 *
 *   host-cell mosaic · cyst bodies · cyst wall shells · bradyzoites
 *
 * plus one flat underlay. Like every other view it holds no simulation: each
 * frame it reads `world.cysts` out of the store and hands them to a `SliceModel`
 * (a view-layer model that owns the instance buffers, eases growth and says what
 * changed). This component binds those buffers, sets the counts, uploads only
 * what changed, and does the three jobs that need the camera: pointer picking,
 * the scale bar, and adaptive LOD. Scene units are micrometres; the parent group
 * scales them into world units.
 *
 * Instancing guard and the adaptive LOD ladder are trimmed from ford442/watershed
 * (`rendering/instancing/useHideWhileEmpty.ts`, `rendering/lod/adaptiveLod.ts`).
 */

import { useEffect, useMemo, useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import * as THREE from 'three'
import { useHideWhileEmpty } from '../../rendering/instancing/useHideWhileEmpty'
import { stepAdaptiveLod } from '../../rendering/lod/adaptiveLod'
import { STAGE_DEFS } from '../../simulation/parasite/stages'
import { useParasiteStore } from '../../stores/parasiteStore'
import { useSliceViewStore } from '../../stores/sliceViewStore'
import { pickSphere } from './slice/cystPick'
import { bradyzoiteGeometry, cellTileGeometry } from './slice/geometry'
import { SLICE_PALETTES } from './slice/palette'
import { niceScaleBar, type ScaleBar } from './slice/scaleBar'
import { CYST_CAPACITY, maxLatticeCells } from './slice/sliceLayout'
import { MAX_BRADYZOITE_INSTANCES, SLICE_LOD } from './slice/sliceLod'
import { SliceModel } from './slice/sliceModel'
import { stressCysts } from './slice/syntheticCysts'
import { WALL_FRAGMENT, WALL_UNIFORMS, WALL_VERTEX } from './slice/wallShader'

const TARGET_FPS = 60
/** The pointer picks anything within this many CSS pixels of a cyst's edge, so a 5 µm cyst is catchable. */
const PICK_SLOP_PX = 8

/** Mark the first `floats` values of an instance attribute for upload — not the whole (max-sized) buffer. */
function touch(attribute: THREE.BufferAttribute | null | undefined, floats: number): void {
  if (!attribute || floats <= 0) return
  attribute.clearUpdateRanges()
  attribute.addUpdateRange(0, floats)
  attribute.needsUpdate = true
}

/** Steps the LOD tier from the measured frame rate, once a second (see `rendering/lod/adaptiveLod.ts`). */
function useAdaptiveLod(): void {
  const sample = useRef({ seconds: 0, frames: 0, hitch: false, low: 0, high: 0 })
  useFrame((_, dt) => {
    const w = sample.current
    w.seconds += dt
    w.frames++
    // a hidden tab or a long stall is not evidence about the GPU
    if (dt > 0.5) w.hitch = true
    if (w.seconds < 1) return
    const fps = w.frames / w.seconds
    const polluted = w.hitch
    w.seconds = 0
    w.frames = 0
    w.hitch = false
    const { lodAuto, lodTier, stepLodTier } = useSliceViewStore.getState()
    if (!lodAuto || polluted) return
    const step = stepAdaptiveLod({ tier: lodTier, fps, targetFps: TARGET_FPS, lowSeconds: w.low, highSeconds: w.high })
    w.low = step.lowSeconds
    w.high = step.highSeconds
    if (step.nextTier) stepLodTier(step.nextTier)
  })
}

export function TissueSliceView() {
  const tier = useSliceViewStore((s) => s.lodTier)
  const lod = SLICE_LOD[tier]

  const model = useMemo(() => new SliceModel(), [])
  const crescent = useMemo(() => bradyzoiteGeometry(lod), [lod])
  const tile = useMemo(() => cellTileGeometry(lod.cellRings), [lod.cellRings])
  useEffect(() => () => crescent.dispose(), [crescent])
  useEffect(() => () => tile.dispose(), [tile])

  const root = useRef<THREE.Group>(null)
  const underlay = useRef<THREE.Mesh>(null)
  const cells = useRef<THREE.InstancedMesh>(null)
  const bodies = useRef<THREE.InstancedMesh>(null)
  const shells = useRef<THREE.InstancedMesh>(null)
  const zoites = useRef<THREE.InstancedMesh>(null)

  const gl = useThree((s) => s.gl)
  const scratch = useMemo(
    () => ({
      raycaster: new THREE.Raycaster(),
      ndc: new THREE.Vector2(),
      inverse: new THREE.Matrix4(),
      origin: new THREE.Vector3(),
      direction: new THREE.Vector3(),
      target: new THREE.Vector3(),
      // pointer state lives outside React: it changes every move event
      pointer: { x: 0, y: 0, inside: false, dragging: false },
      radius: -1,
      niche: null as string | null,
      bar: null as ScaleBar | null,
    }),
    [],
  )

  // the pointer, in normalised device coordinates, for picking
  useEffect(() => {
    const el = gl.domElement
    const p = scratch.pointer
    const move = (e: PointerEvent) => {
      const r = el.getBoundingClientRect()
      p.x = ((e.clientX - r.left) / r.width) * 2 - 1
      p.y = -((e.clientY - r.top) / r.height) * 2 + 1
      p.inside = true
      p.dragging = e.buttons !== 0 // orbiting: the tooltip would only flicker
    }
    const leave = () => {
      p.inside = false
    }
    el.addEventListener('pointermove', move)
    el.addEventListener('pointerleave', leave)
    return () => {
      el.removeEventListener('pointermove', move)
      el.removeEventListener('pointerleave', leave)
      el.style.cursor = ''
      useSliceViewStore.getState().setHover(null)
    }
  }, [gl, scratch])

  useFrame((state, dt) => {
    const cellMesh = cells.current
    const body = bodies.current
    const shell = shells.current
    const zoite = zoites.current
    const group = root.current
    if (!cellMesh || !body || !shell || !zoite || !group) return

    const view = useSliceViewStore.getState()
    const cysts = view.stress > 0 ? stressCysts(view.stress) : useParasiteStore.getState().world.cysts
    const frame = model.update(cysts, {
      dt,
      budget: SLICE_LOD[view.lodTier].bradyzoiteBudget,
      hoverId: view.hoverId,
      niche: view.niche,
    })

    // counts, then upload only what moved
    cellMesh.count = frame.cells
    if (frame.cellsDirty) touch(cellMesh.instanceMatrix, frame.cells * 16)
    if (frame.cellColorsDirty) touch(cellMesh.instanceColor, frame.cells * 3)
    body.count = shell.count = frame.cysts
    if (frame.matricesDirty) {
      touch(body.instanceMatrix, frame.cysts * 16)
      touch(shell.instanceMatrix, frame.cysts * 16)
    }
    if (frame.colorsDirty) {
      touch(body.instanceColor, frame.cysts * 3)
      touch(shell.instanceColor, frame.cysts * 3)
    }
    zoite.count = frame.bradyzoites
    if (frame.bradyDirty || frame.matricesDirty) touch(zoite.instanceMatrix, frame.bradyzoites * 16)

    // the dark intercellular matrix under the mosaic, cut to the patch
    const under = underlay.current
    if (under && model.lattice) {
      if (scratch.radius !== model.lattice.radius) {
        scratch.radius = model.lattice.radius
        under.scale.set(model.lattice.radius + 6, model.lattice.radius + 6, 1)
      }
      if (scratch.niche !== view.niche) {
        scratch.niche = view.niche
        ;(under.material as THREE.MeshBasicMaterial).color.set(SLICE_PALETTES[view.niche].matrix)
      }
    }

    // what the sidebar reports — pushed only when it changes
    const stats = view.stats
    if (stats.cysts !== frame.cysts || stats.drawn !== frame.bradyzoites || stats.total !== frame.totalBradyzoites) {
      view.setStats({ cysts: frame.cysts, drawn: frame.bradyzoites, total: frame.totalBradyzoites })
    }

    // ---- scale bar: micrometres per CSS pixel at the orbit target
    const camera = state.camera as THREE.PerspectiveCamera
    const controls = state.controls as { target: THREE.Vector3 } | null
    group.updateWorldMatrix(true, false)
    const worldPerUm = group.matrixWorld.getMaxScaleOnAxis()
    const distance = camera.position.distanceTo(controls?.target ?? scratch.target.set(0, 0, 0))
    const visibleWorld = 2 * distance * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2))
    const umPerPx = visibleWorld / worldPerUm / state.size.height
    const bar = niceScaleBar(umPerPx)
    if (!scratch.bar || scratch.bar.um !== bar.um || Math.abs(scratch.bar.px - bar.px) >= 1) {
      scratch.bar = bar
      view.setScaleBar(bar)
    }

    // ---- hover: a ray against the cyst spheres (cheaper and steadier than raycasting 200 meshes)
    const p = scratch.pointer
    let hovered: number | null = null
    if (p.inside && !p.dragging && frame.cysts > 0) {
      scratch.ndc.set(p.x, p.y)
      scratch.raycaster.setFromCamera(scratch.ndc, camera)
      scratch.inverse.copy(group.matrixWorld).invert()
      scratch.origin.copy(scratch.raycaster.ray.origin).applyMatrix4(scratch.inverse)
      scratch.direction.copy(scratch.raycaster.ray.direction).transformDirection(scratch.inverse)
      const hit = pickSphere(
        scratch.origin.x,
        scratch.origin.y,
        scratch.origin.z,
        scratch.direction.x,
        scratch.direction.y,
        scratch.direction.z,
        model.pick,
        frame.cysts,
        PICK_SLOP_PX * umPerPx,
      )
      hovered = hit >= 0 ? model.ids[hit] : null
    }
    if (hovered !== view.hoverId) {
      view.setHover(hovered)
      gl.domElement.style.cursor = hovered === null ? '' : 'pointer'
    }
  })

  useAdaptiveLod()

  // the guard goes after the `useFrame` above, so it sees this frame's counts (see the hook)
  useHideWhileEmpty(cells)
  useHideWhileEmpty(bodies)
  useHideWhileEmpty(shells)
  useHideWhileEmpty(zoites)

  return (
    <group ref={root}>
      {/* intercellular matrix: the dark floor the cells sit on, and what the cysts are embedded in */}
      <mesh ref={underlay} rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.3, 0]}>
        <circleGeometry args={[1, 64]} />
        <meshBasicMaterial color={SLICE_PALETTES.cnsCortex.matrix} side={THREE.DoubleSide} />
      </mesh>

      {/* host cells: one hexagonal tile per 15 µm cell */}
      <instancedMesh
        ref={cells}
        args={[undefined, undefined, maxLatticeCells()]}
        geometry={tile}
        count={0}
        visible={false}
        frustumCulled={false}
      >
        <instancedBufferAttribute attach="instanceMatrix" args={[model.cellMatrix, 16]} usage={THREE.DynamicDrawUsage} />
        <instancedBufferAttribute attach="instanceColor" args={[model.cellColor, 3]} usage={THREE.DynamicDrawUsage} />
        <meshStandardMaterial roughness={0.78} metalness={0} />
      </instancedMesh>

      {/* cyst bodies: translucent, so the bradyzoites inside show through */}
      <instancedMesh ref={bodies} args={[undefined, undefined, CYST_CAPACITY]} count={0} visible={false} frustumCulled={false} renderOrder={1}>
        <sphereGeometry args={[1, lod.sphereWidth, lod.sphereHeight]} />
        <instancedBufferAttribute attach="instanceMatrix" args={[model.cystMatrix, 16]} usage={THREE.DynamicDrawUsage} />
        <instancedBufferAttribute attach="instanceColor" args={[model.cystColor, 3]} usage={THREE.DynamicDrawUsage} />
        <meshStandardMaterial roughness={0.35} emissive="#2a1a4d" emissiveIntensity={0.55} transparent opacity={0.42} depthWrite={false} />
      </instancedMesh>

      {/* cyst walls: <0.5 µm, drawn as a fresnel rim on a shell just outside the body */}
      <instancedMesh ref={shells} args={[undefined, undefined, CYST_CAPACITY]} count={0} visible={false} frustumCulled={false} renderOrder={2}>
        <sphereGeometry args={[1, lod.sphereWidth, lod.sphereHeight]} />
        <instancedBufferAttribute attach="instanceMatrix" args={[model.shellMatrix, 16]} usage={THREE.DynamicDrawUsage} />
        <instancedBufferAttribute attach="instanceColor" args={[model.shellColor, 3]} usage={THREE.DynamicDrawUsage} />
        <shaderMaterial
          vertexShader={WALL_VERTEX}
          fragmentShader={WALL_FRAGMENT}
          uniforms={WALL_UNIFORMS}
          transparent
          depthWrite={false}
          blending={THREE.AdditiveBlending}
        />
      </instancedMesh>

      {/* bradyzoites: 7 × 1.5 µm crescents, only in cysts wide enough to hold one, count capped by the LOD tier */}
      <instancedMesh
        ref={zoites}
        args={[undefined, undefined, MAX_BRADYZOITE_INSTANCES]}
        geometry={crescent}
        count={0}
        visible={false}
        frustumCulled={false}
      >
        <instancedBufferAttribute attach="instanceMatrix" args={[model.bradyMatrix, 16]} usage={THREE.DynamicDrawUsage} />
        <meshStandardMaterial
          color={STAGE_DEFS.bradyzoite.color}
          emissive={STAGE_DEFS.bradyzoite.color}
          emissiveIntensity={0.35}
          roughness={0.45}
          metalness={0.05}
        />
      </instancedMesh>
    </group>
  )
}
