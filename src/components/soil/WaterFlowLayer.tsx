import { useEffect, useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import { Html } from '@react-three/drei'
import * as THREE from 'three'
import { smoothstep } from '../../simulation/color'
import { useSimStore } from '../../stores/simStore'
import { useTimeStore } from '../../stores/timeStore'
import type { RootPose } from './rootSkeleton'
import { stemTopOf } from './stemTop'
import { FLOW, PHASE_FREE, PHASE_SOIL, PHASE_STEM, WaterFlow } from './waterFlow'

/**
 * The Roots view's water: particles that leave the soil where the sim says the
 * roots are drawing from it, run up the drawn roots and rise up the stem
 * (`waterFlow.ts` holds the model; this is only drawing). Everything is read
 * from `useSimStore.getState()` inside useFrame — no React re-render per tick —
 * and the animation stops with the shared clock when the sim is paused.
 */

/** Slice-front depth the particles ride at (the view's SLAB / 2 + the root lines). */
const Z_FRONT = 0.18
const REFRESH = 0.2 // s between re-aims of the emitters at the sink map
/** Width (m) of the stream in the stem. */
const STEM_WIDTH = 0.05
const SIZE = { soil: 0.016, root: 0.02, stem: 0.018 } as const
const TINT = {
  soil: new THREE.Color('#7fcaff'),
  root: new THREE.Color('#33a8ff'),
  stem: new THREE.Color('#b8f1ff'),
}

export function WaterFlowLayer({ pose }: { pose: RootPose }) {
  const flow = useMemo(() => new WaterFlow(pose.skeleton), [pose])
  const mesh = useRef<THREE.InstancedMesh>(null)
  const o = useMemo(() => new THREE.Object3D(), [])
  const clock = useRef(REFRESH)
  const stemTop = useRef(0.5)
  const label = useRef<THREE.Group>(null)
  const seen = useRef<{ version: number; field: readonly number[] | null }>({ version: -1, field: null })

  useEffect(() => {
    // make sure the per-instance colour attribute exists before the first draw
    mesh.current?.setColorAt(0, TINT.root)
  }, [flow])

  useFrame((_, delta) => {
    const m = mesh.current
    if (!m) return
    const dt = Math.min(delta, 0.1)
    const sim = useSimStore.getState()
    const soil = sim.soil
    const posed = pose.update(soil)

    // re-aim the emitters when the sink map or the drawn roots changed
    clock.current += dt
    if (clock.current >= REFRESH) {
      clock.current = 0
      if (seen.current.version !== pose.version || seen.current.field !== soil.uptakeField) {
        seen.current = { version: pose.version, field: soil.uptakeField }
        flow.setSources(posed, soil.uptakeField)
      }
    }

    if (clock.current === 0) {
      stemTop.current = stemTopOf(sim.species, sim.lsystemIterations, sim.height)
      label.current?.position.set(0.12, stemTop.current * 0.75, 0)
    }
    flow.step(useTimeStore.getState().isPlaying ? dt : 0, posed, stemTop.current)

    let n = 0
    for (let i = 0; i < flow.capacity; i++) {
      const phase = flow.phase[i]
      if (phase === PHASE_FREE) continue
      const f = flow.fade[i]
      if (f <= 0.01) continue
      const kind = phase === PHASE_SOIL ? 'soil' : phase === PHASE_STEM ? 'stem' : 'root'
      const y = flow.y[i]
      // in the slice's plane while underground; slides back onto the plant's own axis as it rises
      const up = smoothstep(0, FLOW.collar, y)
      const z = Z_FRONT * (1 - up) + (flow.jit[i] - 0.5) * 0.03
      // in the stem the stream fans across the width of the vessel bundle instead of a single file
      const x = flow.x[i] + (flow.jit[i] - 0.5) * STEM_WIDTH * up
      const r = SIZE[kind] * f * (0.8 + 0.5 * flow.jit[i])
      o.position.set(x, y, z)
      o.scale.setScalar(r)
      o.updateMatrix()
      m.setMatrixAt(n, o.matrix)
      m.setColorAt(n, TINT[kind])
      n++
    }
    m.count = n
    m.instanceMatrix.needsUpdate = true
    if (m.instanceColor) m.instanceColor.needsUpdate = true
  })

  return (
    <>
      <group ref={label} position={[0.12, 0.4, 0]} userData={{ noExport: true }}>
        <Html zIndexRange={[20, 0]} style={{ pointerEvents: 'none', transform: 'translate(0, -50%)' }}>
          <span className="soil-callout flow">↑ xylem carries it to the canopy</span>
        </Html>
      </group>
      <instancedMesh
        ref={mesh}
        args={[undefined, undefined, flow.capacity]}
        frustumCulled={false}
        renderOrder={10}
        // a snapshot of moving particles is noise in a GLB (see plantExport.ts)
        userData={{ noExport: true }}
      >
        <sphereGeometry args={[1, 8, 6]} />
        <meshBasicMaterial transparent depthWrite={false} blending={THREE.AdditiveBlending} toneMapped={false} />
      </instancedMesh>
    </>
  )
}
