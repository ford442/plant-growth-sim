import { useEffect, useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import { Html } from '@react-three/drei'
import * as THREE from 'three'
import { useSimStore } from '../../stores/simStore'
import {
  CELL_H,
  CELL_W,
  cellIndex,
  cellMoisture,
  cellSaturation,
  cellX,
  cellZ,
  largestGeode,
  MAX_NODULES,
  noduleLabel,
  rootSystem,
  SOIL_CELLS,
  SOIL_COLS,
  SOIL_DEPTH,
  SOIL_ROWS,
  SOIL_WIDTH,
  type SoilMineral,
  type SoilState,
} from '../../simulation/SoilField'
import { MINERAL_HEX, overlayColor, saturationParam, uptakeParam, type SoilOverlay } from './palette'
import { RootPose, rootSkeleton } from './rootSkeleton'
import { WaterFlowLayer } from './WaterFlowLayer'

/**
 * The Roots view's soil: a vertical slice under the plant, one tile per soil
 * cell coloured by the chosen field, the root system clipped to the
 * simulated root front, and the mineral nodules growing in it. Everything is
 * derived from `useSimStore.getState().soil` inside useFrame (at ~10 Hz — the
 * soil changes over sim-days, not frames), so React does not re-render per tick.
 */

const SLAB = 0.3 // m, thickness of the slice
const FRONT = SLAB / 2
/** Drawn radius (m) of a nodule: √-scaled and exaggerated so millimetre nodules read at slice scale. */
const noduleRadius = (mm: number) => 0.012 + 0.016 * Math.sqrt(Math.max(0, mm))
const REFRESH = 0.1 // s

/** Plant activity for the CO₂-dependent calcite field, as the sim uses it. */
function activity(): number {
  const { weather, waterStatus } = useSimStore.getState()
  return Math.max(0, 1 - Math.abs(weather.temperature - 22) / 25) * waterStatus
}

function cellValue(s: SoilState, overlay: SoilOverlay, i: number, act: number): number {
  switch (overlay) {
    case 'moisture':
      return cellMoisture(s, i)
    case 'uptake':
      return uptakeParam(s.uptakeField[i])
    case 'silica':
      return saturationParam(cellSaturation(s, i, 'silica', act))
    case 'calcite':
      return saturationParam(cellSaturation(s, i, 'calcite', act))
    case 'cement':
      return s.cementSilica[i] + s.cementCalcite[i]
    case 'roots':
      return s.roots[i]
  }
}

function SoilTiles({ overlay }: { overlay: SoilOverlay }) {
  const mesh = useRef<THREE.InstancedMesh>(null)
  const clock = useRef(REFRESH)
  const color = useMemo(() => new THREE.Color(), [])

  useEffect(() => {
    const m = mesh.current
    if (!m) return
    const o = new THREE.Object3D()
    for (let row = 0; row < SOIL_ROWS; row++)
      for (let col = 0; col < SOIL_COLS; col++) {
        o.position.set(cellX(col), -cellZ(row), 0)
        o.updateMatrix()
        m.setMatrixAt(cellIndex(col, row), o.matrix)
      }
    m.instanceMatrix.needsUpdate = true
    clock.current = REFRESH // repaint now
  }, [overlay])

  useFrame((_, dt) => {
    const m = mesh.current
    clock.current += dt
    if (!m || clock.current < REFRESH) return
    clock.current = 0
    const s = useSimStore.getState().soil
    const act = activity()
    for (let i = 0; i < SOIL_CELLS; i++) {
      const cement = s.cementSilica[i] + s.cementCalcite[i]
      color.set(overlayColor(overlay, cellValue(s, overlay, i, act), cement))
      m.setColorAt(i, color)
    }
    if (m.instanceColor) m.instanceColor.needsUpdate = true
  })

  return (
    <instancedMesh ref={mesh} args={[undefined, undefined, SOIL_CELLS]} frustumCulled={false}>
      <boxGeometry args={[CELL_W * 0.96, CELL_H * 0.94, SLAB]} />
      <meshBasicMaterial toneMapped={false} />
    </instancedMesh>
  )
}

function RootLines({ pose }: { pose: RootPose }) {
  const { skeleton } = pose
  const geometry = useMemo(() => {
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(skeleton.length * 6), 3))
    g.setDrawRange(0, 0)
    return g
  }, [skeleton])
  useEffect(() => () => geometry.dispose(), [geometry])
  const clock = useRef(REFRESH)
  const seen = useRef(-1)

  useFrame((_, dt) => {
    clock.current += dt
    if (clock.current < REFRESH) return
    clock.current = 0
    // scaled to the root front and clipped at the same hardpans the sim stops roots at
    const posed = pose.update(useSimStore.getState().soil)
    if (seen.current === pose.version) return
    seen.current = pose.version

    const pos = geometry.attributes.position as THREE.BufferAttribute
    const arr = pos.array as Float32Array
    let n = 0
    for (let i = 0; i < skeleton.length; i++) {
      if (!posed.visible[i]) continue
      const zf = FRONT + 0.012 + skeleton[i].order * 0.004
      arr.set([posed.x0[i], -posed.z0[i], zf, posed.x1[i], -posed.z1[i], zf], n * 6)
      n++
    }
    geometry.setDrawRange(0, n * 2)
    pos.needsUpdate = true
    geometry.computeBoundingSphere()
  })

  return (
    <lineSegments geometry={geometry} frustumCulled={false}>
      <lineBasicMaterial color={MINERAL_HEX.root} transparent opacity={0.9} />
    </lineSegments>
  )
}

/** The root system (drawn) and the water moving through it, on one shared pose. */
function RootSystem({ flow }: { flow: boolean }) {
  const species = useSimStore((s) => s.species)
  const def = rootSystem(species)
  const pose = useMemo(() => new RootPose(rootSkeleton(def, species.length), def), [def, species])
  return (
    <>
      <RootLines pose={pose} />
      {flow && <WaterFlowLayer pose={pose} />}
    </>
  )
}

function NoduleLayer({ mineral }: { mineral: SoilMineral }) {
  const mesh = useRef<THREE.InstancedMesh>(null)
  const o = useMemo(() => new THREE.Object3D(), [])
  useFrame(() => {
    const m = mesh.current
    if (!m) return
    const nodules = useSimStore.getState().soil.nodules
    let n = 0
    for (const nod of nodules) {
      if (nod.mineral !== mineral) continue
      const r = noduleRadius(nod.radius)
      o.position.set(cellX(nod.col) + nod.jx * CELL_W * 0.5, -cellZ(nod.row) + nod.jz * CELL_H * 0.4, FRONT)
      // calcite rhizoliths sheath a root: drawn elongated down the root
      o.scale.set(r, mineral === 'calcite' && nod.rooted ? r * 1.6 : r, r)
      o.rotation.set(0, 0, (nod.jx - nod.jz) * 0.8)
      o.updateMatrix()
      m.setMatrixAt(n++, o.matrix)
    }
    m.count = n
    m.instanceMatrix.needsUpdate = true
  })
  return (
    <instancedMesh ref={mesh} args={[undefined, undefined, MAX_NODULES]} frustumCulled={false}>
      <icosahedronGeometry args={[1, 2]} />
      {mineral === 'silica' ? (
        <meshPhysicalMaterial color={MINERAL_HEX.silica} roughness={0.25} clearcoat={0.8} sheen={0.5} sheenColor="#ffffff" />
      ) : (
        <meshStandardMaterial color={MINERAL_HEX.calcite} roughness={0.75} />
      )}
    </instancedMesh>
  )
}

/** Labels that only move when something structural happens (React re-renders on those). */
function SoilLabels() {
  const blockedAt = useSimStore((s) => s.soil.blockedAt)
  const geodeKey = useSimStore((s) => {
    const g = largestGeode(s.soil)
    return g ? `${g.id}:${g.col}:${g.row}` : ''
  })
  const geode = geodeKey ? useSimStore.getState().soil.nodules.find((n) => `${n.id}:${n.col}:${n.row}` === geodeKey) : null

  const ticks = [0.5, 1, 1.5, 2]
  return (
    <group>
      {ticks.map((d) => (
        <Html key={d} position={[-SOIL_WIDTH / 2 - 0.08, -d, FRONT]} zIndexRange={[20, 0]} style={{ pointerEvents: 'none', transform: 'translate(-100%, -50%)' }}>
          <span className="soil-tick">{d} m</span>
        </Html>
      ))}
      {blockedAt !== null && (
        <Html position={[SOIL_WIDTH / 2 + 0.08, -blockedAt, FRONT]} zIndexRange={[20, 0]} style={{ pointerEvents: 'none', transform: 'translate(0, -50%)' }}>
          <span className="soil-callout hardpan">← hardpan stops the main root</span>
        </Html>
      )}
      {geode && (
        <Html
          position={[cellX(geode.col) + geode.jx * CELL_W * 0.5, -cellZ(geode.row), FRONT + 0.05]}
          zIndexRange={[20, 0]}
          style={{ pointerEvents: 'none', transform: 'translate(14px, -50%)' }}
        >
          <span className="soil-callout geode">{noduleLabel(geode)}</span>
        </Html>
      )}
    </group>
  )
}

export function SoilView({ overlay, flow = true }: { overlay: SoilOverlay; flow?: boolean }) {
  return (
    <group>
      {/* dark backing so the gaps between tiles read as a grid */}
      <mesh position={[0, -SOIL_DEPTH / 2, -0.01]}>
        <boxGeometry args={[SOIL_WIDTH + 0.04, SOIL_DEPTH + 0.04, SLAB - 0.04]} />
        <meshBasicMaterial color="#0b0906" />
      </mesh>
      <SoilTiles overlay={overlay} />
      <RootSystem flow={flow} />
      <NoduleLayer mineral="silica" />
      <NoduleLayer mineral="calcite" />
      <SoilLabels />
      {/* ground line */}
      <mesh position={[0, 0.005, 0]}>
        <boxGeometry args={[SOIL_WIDTH + 0.1, 0.01, SLAB + 0.02]} />
        <meshStandardMaterial color="#2f4a2a" roughness={0.9} />
      </mesh>
    </group>
  )
}
