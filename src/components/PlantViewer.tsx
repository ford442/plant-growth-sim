import { useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { useSimStore } from '../stores/simStore'
import { SPECIES_LSYSTEMS } from '../simulation/LSystem'
import { morphFactor } from '../simulation/LSystemMorph'
import type { ViewScale } from '../App'
import { registerPlantRoot } from './plantExport'
import { CellularView } from './CellularView'
import { getMorphedPlant, type MorphedPlant } from './plant/MorphedPlant'

interface Props {
  scale: ViewScale
}

// Both layers are re-posed in place every frame by <ArchitectureView/> (see
// MorphedPlant), so they are culled by nothing: their bounds are changing.
function BranchSegments({ plant, color }: { plant: MorphedPlant; color: string }) {
  // simple line segments for now; later upgrade to tubeGeometry or instanced cylinders
  return (
    <lineSegments geometry={plant.branchGeometry} frustumCulled={false}>
      <lineBasicMaterial color={color} linewidth={2} />
    </lineSegments>
  )
}

function Leaves({ plant, color }: { plant: MorphedPlant; color: string }) {
  return (
    <instancedMesh
      key={plant.key}
      args={[undefined, undefined, plant.leafCount]}
      frustumCulled={false}
    >
      <primitive object={plant.leafMatrices} attach="instanceMatrix" />
      <planeGeometry args={[1, 1.4]} />
      <meshStandardMaterial
        color={color}
        side={THREE.DoubleSide}
        roughness={0.7}
        metalness={0.05}
      />
    </instancedMesh>
  )
}

function ArchitectureView() {
  const species = useSimStore((s) => s.species)
  // whole iteration only: React re-renders when the stage steps, not per tick
  const stage = useSimStore((s) => s.lsystemIterations)
  const height = useSimStore((s) => s.height)
  const waterStatus = useSimStore((s) => s.waterStatus)

  const def = SPECIES_LSYSTEMS[species] ?? SPECIES_LSYSTEMS.sunflower

  // The expensive part — L-system strings, lineage, geometry — runs once per
  // iteration step and is shared by every plant on screen. Growth *between*
  // steps is a cheap re-pose of that geometry in useFrame below.
  const plant = useMemo(() => {
    const p = getMorphedPlant(species, stage)
    p.setMorph(morphFactor(useSimStore.getState().lsystemProgress, p.stage))
    return p
  }, [species, stage])

  // gentle sway from wind
  const group = useRef<THREE.Group>(null)
  const wind = useSimStore((s) => s.weather.wind)

  useFrame((state) => {
    // Growth is read from the sim every frame, so it follows play/pause, speed
    // and the weather-driven growth rate exactly. Clamped: if the sim stepped to
    // the next iteration a frame before React re-rendered, this still shows the
    // end of the morph it holds rather than jumping back.
    plant.setMorph(morphFactor(useSimStore.getState().lsystemProgress, plant.stage))

    if (!group.current) return
    const t = state.clock.elapsedTime
    const sway = Math.sin(t * 1.2) * 0.015 * Math.min(wind, 8)
    group.current.rotation.z = sway
    group.current.rotation.x = Math.sin(t * 0.7) * 0.008 * wind
  })

  // scale whole plant by current height for growth feel
  const scale = Math.max(0.3, height / 1.8)

  // slight color shift when water stressed
  const stemColor = waterStatus < 0.35 ? '#6b4a2a' : def.color
  const leafColor =
    waterStatus < 0.35 ? '#8a7a3a' : (def.leafColor ?? '#3d8b3d')

  return (
    <group ref={group} scale={[scale, scale, scale]} position={[0, 0, 0]}>
      <BranchSegments plant={plant} color={stemColor} />
      <Leaves plant={plant} color={leafColor} />
      {/* ground disk */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.01, 0]} receiveShadow>
        <circleGeometry args={[3.5, 48]} />
        <meshStandardMaterial color="#1a2a1a" roughness={0.95} />
      </mesh>
    </group>
  )
}

function RootsView() {
  // Simple root system placeholder
  const roots = useMemo(() => {
    const pts: THREE.Vector3[] = []
    for (let i = 0; i < 40; i++) {
      const a = (i / 40) * Math.PI * 2
      const r = 0.3 + Math.random() * 1.8
      const y = -0.2 - Math.random() * 2.2
      pts.push(new THREE.Vector3(Math.cos(a) * r * 0.6, y, Math.sin(a) * r * 0.6))
    }
    return pts
  }, [])

  return (
    <group>
      {/* soil volume hint */}
      <mesh position={[0, -1.2, 0]}>
        <boxGeometry args={[5, 2.4, 5]} />
        <meshStandardMaterial
          color="#2a1f14"
          transparent
          opacity={0.35}
          roughness={1}
        />
      </mesh>
      {/* main taproot */}
      <mesh position={[0, -1.1, 0]}>
        <cylinderGeometry args={[0.06, 0.02, 2.2, 8]} />
        <meshStandardMaterial color="#5a4030" />
      </mesh>
      {roots.map((p, i) => (
        <mesh key={i} position={p}>
          <sphereGeometry args={[0.03 + Math.random() * 0.04, 6, 6]} />
          <meshStandardMaterial color="#6a5040" />
        </mesh>
      ))}
    </group>
  )
}

function MacroView() {
  // Multiple plants for garden feel
  return (
    <group>
      <ArchitectureView />
      {/* a couple of background plants */}
      <group position={[2.2, 0, -1.5]} scale={0.7}>
        <ArchitectureView />
      </group>
      <group position={[-2.5, 0, -0.8]} scale={0.55}>
        <ArchitectureView />
      </group>
    </group>
  )
}

// The simulation tick lives in <SimClock /> (shared with the gem viewer).
export function PlantViewer({ scale }: Props) {
  // Root group is registered so the UI can export the on-screen scene as GLB.
  return (
    <group ref={registerPlantRoot} name="plant-scene">
      {scale === 'macro' && <MacroView />}
      {scale === 'architecture' && <ArchitectureView />}
      {scale === 'cellular' && <CellularView />}
      {scale === 'roots' && <RootsView />}
    </group>
  )
}
