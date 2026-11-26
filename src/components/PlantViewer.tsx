import { useEffect, useMemo, useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import * as THREE from 'three'
import { useSimStore } from '../stores/simStore'
import { SPECIES_LSYSTEMS } from '../simulation/LSystem'
import { morphFactor } from '../simulation/LSystemMorph'
import type { ViewScale } from '../App'
import { registerPlantRoot } from './plantExport'
import { CellularView } from './CellularView'
import { getMorphedPlant, type MorphedPlant } from './plant/MorphedPlant'
import { useLeafNodeMaterial } from './plant/useLeafNodeMaterial'
import { SoilView } from './soil/SoilView'
import type { SoilOverlay } from './soil/palette'

interface Props {
  scale: ViewScale
  /** Field shown on the soil slice in the Roots view. */
  soilOverlay?: SoilOverlay
  /** Animate water moving soil → root → stem in the Roots view. */
  soilFlow?: boolean
}

/** Orbit target per plant view: the Roots view looks into the soil. */
export const PLANT_VIEW_TARGET: Record<ViewScale, [number, number, number]> = {
  macro: [0, 0, 0],
  architecture: [0, 0, 0],
  cellular: [0, 0, 0],
  roots: [0, -0.7, 0],
}

// Both layers are re-posed in place every frame by <ArchitectureView/> (see
// MorphedPlant), so they are culled by nothing: their bounds are changing.
function Branches({ plant, color }: { plant: MorphedPlant; color: string }) {
  // One instanced cylinder per L-system segment (see plant/branchMatrix.ts).
  return (
    <instancedMesh
      key={plant.key}
      args={[undefined, undefined, plant.segmentCount]}
      frustumCulled={false}
    >
      <primitive object={plant.branchMatrices} attach="instanceMatrix" />
      {/* shared between plants, so a primitive: R3F must not dispose it on unmount */}
      <primitive object={plant.branchGeometry} attach="geometry" />
      <meshStandardMaterial color={color} roughness={0.9} metalness={0} />
    </instancedMesh>
  )
}

interface LeavesProps {
  plant: MorphedPlant
  /** Colour for the standard material (already tinted for water stress). */
  color: string
  /** The TSL node material when the renderer supports it and it has loaded; otherwise null. */
  nodeMaterial: THREE.Material | null
}

function Leaves({ plant, color, nodeMaterial }: LeavesProps) {
  return (
    <instancedMesh
      key={plant.key}
      args={[undefined, undefined, plant.leafCount]}
      frustumCulled={false}
    >
      <primitive object={plant.leafMatrices} attach="instanceMatrix" />
      {/* shared between plants, so a primitive: R3F must not dispose it on unmount */}
      <primitive object={plant.leafGeometry} attach="geometry" />
      {nodeMaterial ? (
        // owned (and disposed) by useLeafNodeMaterial, which outlives this re-keyed mesh
        <primitive object={nodeMaterial} attach="material" />
      ) : (
        <meshStandardMaterial
          color={color}
          side={THREE.DoubleSide}
          roughness={0.7}
          metalness={0.05}
        />
      )}
    </instancedMesh>
  )
}

function ArchitectureView({ ground = true }: { ground?: boolean }) {
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
  const healthyLeaf = def.leafColor ?? '#3d8b3d'
  const stemColor = waterStatus < 0.35 ? '#6b4a2a' : def.color
  const leafColor = waterStatus < 0.35 ? '#8a7a3a' : healthyLeaf

  // TSL leaf (WebGPURenderer only, see docs/design/webgpu-tsl.md). It does its own
  // water-stress tint continuously, so it takes the species colour, not `leafColor`.
  const nodeLeaf = useLeafNodeMaterial(healthyLeaf)

  return (
    <group ref={group} scale={[scale, scale, scale]} position={[0, 0, 0]}>
      <Branches plant={plant} color={stemColor} />
      <Leaves plant={plant} color={leafColor} nodeMaterial={nodeLeaf?.material ?? null} />
      {/* ground disk (left out over the soil slice, which it would hide) */}
      {ground && (
        <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.01, 0]} receiveShadow>
          <circleGeometry args={[3.5, 48]} />
          <meshStandardMaterial color="#1a2a1a" roughness={0.95} />
        </mesh>
      )}
    </group>
  )
}

/** The plant above ground and the soil slice it draws on below. */
function RootsView({ overlay, flow }: { overlay: SoilOverlay; flow: boolean }) {
  // look at the slice face-on (the default camera looks down on the plant);
  // put the camera back on the way out so the other views keep their framing
  const camera = useThree((s) => s.camera)
  useEffect(() => {
    const before = camera.position.clone()
    camera.position.set(0.6, 0.4, 7.2)
    return () => {
      camera.position.copy(before)
    }
  }, [camera])

  return (
    <group>
      <ArchitectureView ground={false} />
      <SoilView overlay={overlay} flow={flow} />
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

// The simulation tick lives in <SimClock /> (outside the Canvas, shared by every mode).
export function PlantViewer({ scale, soilOverlay = 'moisture', soilFlow = true }: Props) {
  // Root group is registered so the UI can export the on-screen scene as GLB.
  return (
    <group ref={registerPlantRoot} name="plant-scene">
      {scale === 'macro' && <MacroView />}
      {scale === 'architecture' && <ArchitectureView />}
      {scale === 'cellular' && <CellularView />}
      {scale === 'roots' && <RootsView overlay={soilOverlay} flow={soilFlow} />}
    </group>
  )
}
