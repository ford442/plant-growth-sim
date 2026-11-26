import { useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { useSimStore } from '../../stores/simStore'
import { SPECIES_LSYSTEMS } from '../../simulation/LSystem'
import { morphFactor, stageOf } from '../../simulation/LSystemMorph'
import type { Individual } from '../../simulation/plot'
import { getMorphedPlant, type MorphedPlant } from './MorphedPlant'

/** Bed plants are drawn smaller than the single-plant view so the whole plot fits. */
const BED_SCALE = 0.8
const MIN_SCALE = 0.25
const MAX_SCALE = 1.6
const WILT = 0.35

/** Display scale for an individual (the single-plant view uses `height / 1.8` too). */
function bedScale(height: number): number {
  return Math.min(MAX_SCALE, Math.max(MIN_SCALE, (height / 1.8) * BED_SCALE))
}

/**
 * What React needs to re-render for: who is in the bed, their whole L-system stage
 * and whether they are wilting. A string, so the selector only fires when it changes
 * — growth between stages is a re-pose in the one useFrame below.
 */
function bedKey(s: { plot: Individual[]; focusId: string }): string {
  return (
    s.focusId +
    '|' +
    s.plot.map((p) => `${p.id}:${p.species}:${stageOf(p.lsystemProgress)}:${p.waterStatus < WILT ? 1 : 0}`).join('|')
  )
}

interface BedPlantProps {
  ind: Individual
  plant: MorphedPlant
  focused: boolean
  register: (id: string, g: THREE.Group | null) => void
}

/** Meshes only: no frame callback and no store subscription of its own. */
function BedPlant({ ind, plant, focused, register }: BedPlantProps) {
  const def = SPECIES_LSYSTEMS[ind.species]
  const dry = ind.waterStatus < WILT
  const stem = dry ? '#6b4a2a' : def.color
  const leaf = dry ? '#8a7a3a' : (def.leafColor ?? '#3d8b3d')
  const setFocus = useSimStore((s) => s.setFocus)
  return (
    <group position={[ind.x, 0, ind.z]}>
      <group ref={(g) => register(ind.id, g)} rotation={[0, ind.yaw, 0]}>
        <instancedMesh key={`b:${plant.key}`} args={[undefined, undefined, plant.segmentCount]} frustumCulled={false} castShadow>
          <primitive object={plant.branchMatrices} attach="instanceMatrix" />
          <primitive object={plant.branchGeometry} attach="geometry" />
          <meshStandardMaterial color={stem} roughness={0.9} metalness={0} />
        </instancedMesh>
        <instancedMesh key={`l:${plant.key}`} args={[undefined, undefined, plant.leafCount]} frustumCulled={false} castShadow>
          <primitive object={plant.leafMatrices} attach="instanceMatrix" />
          <primitive object={plant.leafGeometry} attach="geometry" />
          <meshStandardMaterial color={leaf} side={THREE.DoubleSide} roughness={0.7} metalness={0.05} />
        </instancedMesh>
      </group>
      {/* click target (the instanced meshes' bounds move every frame, so they are not picked) */}
      <mesh
        position={[0, 0.6, 0]}
        userData={{ noExport: true }}
        onClick={(e) => {
          e.stopPropagation()
          setFocus(ind.id)
        }}
      >
        <cylinderGeometry args={[0.7, 0.7, 1.2, 12]} />
        <meshBasicMaterial transparent opacity={0} depthWrite={false} />
      </mesh>
      {focused && (
        <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.02, 0]} userData={{ noExport: true }}>
          <ringGeometry args={[0.75, 0.88, 48]} />
          <meshBasicMaterial color="#8fe08f" transparent opacity={0.8} />
        </mesh>
      )}
    </group>
  )
}

/**
 * Macro: the whole bed. One component and **one** frame callback for every
 * individual: it re-poses each plant's shared morph from that individual's own
 * progress, scales it by its own height, and sways the lot from `weather.wind`.
 */
export function BedView() {
  const key = useSimStore(bedKey)
  const groups = useRef(new Map<string, THREE.Group>())

  // re-derived only when the key changes (membership, stage, wilt or focus)
  const entries = useMemo(() => {
    void key
    const { plot, focusId } = useSimStore.getState()
    return plot.map((ind) => ({ ind, plant: getMorphedPlant(ind.species, stageOf(ind.lsystemProgress)), focused: ind.id === focusId }))
  }, [key])

  const register = useMemo(
    () => (id: string, g: THREE.Group | null) => {
      if (g) groups.current.set(id, g)
      else groups.current.delete(id)
    },
    [],
  )

  useFrame((state) => {
    const { plot, weather } = useSimStore.getState()
    const t = state.clock.elapsedTime
    const wind = Math.min(weather.wind, 8)
    for (let i = 0; i < plot.length; i++) {
      const ind = plot[i]
      const entry = entries[i]
      if (entry && entry.ind.id === ind.id) entry.plant.setMorph(morphFactor(ind.lsystemProgress, entry.plant.stage))
      const g = groups.current.get(ind.id)
      if (!g) continue
      g.scale.setScalar(bedScale(ind.height))
      const phase = (ind.seed % 628) / 100
      g.rotation.z = Math.sin(t * 1.2 + phase) * 0.015 * wind
      g.rotation.x = Math.sin(t * 0.7 + phase) * 0.008 * wind
    }
  })

  return (
    <group name="bed">
      {entries.map((e) => (
        <BedPlant key={e.ind.id} ind={e.ind} plant={e.plant} focused={e.focused} register={register} />
      ))}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.01, 0]} receiveShadow>
        <circleGeometry args={[6.5, 64]} />
        <meshStandardMaterial color="#1a2a1a" roughness={0.95} />
      </mesh>
    </group>
  )
}
