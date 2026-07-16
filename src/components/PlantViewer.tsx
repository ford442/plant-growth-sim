import { useMemo, useRef, useEffect } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { useSimStore } from '../stores/simStore'
import {
  SPECIES_LSYSTEMS,
  generateLSystem,
  interpretLSystem,
} from '../simulation/LSystem'
import type { ViewScale } from '../App'

interface Props {
  scale: ViewScale
}

function BranchSegments({
  segments,
  color,
}: {
  segments: ReturnType<typeof interpretLSystem>['segments']
  color: string
}) {
  const geo = useMemo(() => {
    const positions: number[] = []
    const radii: number[] = []

    for (const seg of segments) {
      positions.push(...seg.start, ...seg.end)
      radii.push(seg.thickness, seg.thickness * 0.85)
    }

    // simple line segments for now; later upgrade to tubeGeometry or instanced cylinders
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
    return g
  }, [segments])

  return (
    <lineSegments geometry={geo}>
      <lineBasicMaterial color={color} linewidth={2} />
    </lineSegments>
  )
}

function Leaves({
  leaves,
  color,
}: {
  leaves: ReturnType<typeof interpretLSystem>['leaves']
  color: string
}) {
  const meshRef = useRef<THREE.InstancedMesh>(null)

  useEffect(() => {
    if (!meshRef.current) return
    const dummy = new THREE.Object3D()
    leaves.forEach((leaf, i) => {
      dummy.position.set(...leaf.position)
      // orient roughly toward direction
      dummy.lookAt(
        leaf.position[0] + leaf.direction[0],
        leaf.position[1] + leaf.direction[1],
        leaf.position[2] + leaf.direction[2]
      )
      dummy.rotateX(Math.PI / 2)
      dummy.scale.setScalar(leaf.size)
      dummy.updateMatrix()
      meshRef.current!.setMatrixAt(i, dummy.matrix)
    })
    meshRef.current.instanceMatrix.needsUpdate = true
  }, [leaves])

  return (
    <instancedMesh ref={meshRef} args={[undefined, undefined, leaves.length]}>
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
  const iterations = useSimStore((s) => s.lsystemIterations)
  const height = useSimStore((s) => s.height)
  const waterStatus = useSimStore((s) => s.waterStatus)

  const def = SPECIES_LSYSTEMS[species] ?? SPECIES_LSYSTEMS.sunflower

  const { segments, leaves } = useMemo(() => {
    const str = generateLSystem(def.axiom, def.rules, iterations)
    return interpretLSystem(str, def, iterations)
  }, [species, iterations, def])

  // gentle sway from wind
  const group = useRef<THREE.Group>(null)
  const wind = useSimStore((s) => s.weather.wind)

  useFrame((state) => {
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
      <BranchSegments segments={segments} color={stemColor} />
      <Leaves leaves={leaves} color={leafColor} />
      {/* ground disk */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.01, 0]} receiveShadow>
        <circleGeometry args={[3.5, 48]} />
        <meshStandardMaterial color="#1a2a1a" roughness={0.95} />
      </mesh>
    </group>
  )
}

function CellularView() {
  // Placeholder for future cellular cross-section
  return (
    <group>
      <mesh>
        <cylinderGeometry args={[1.2, 1.2, 0.15, 64]} />
        <meshStandardMaterial color="#2a4a2a" />
      </mesh>
      {/* concentric rings representing growth rings / tissues */}
      {[0.3, 0.55, 0.8, 1.0].map((r, i) => (
        <mesh key={i} position={[0, 0.08, 0]}>
          <torusGeometry args={[r, 0.04, 8, 48]} />
          <meshStandardMaterial
            color={i % 2 === 0 ? '#4a7a4a' : '#3a5a3a'}
            roughness={0.6}
          />
        </mesh>
      ))}
      <mesh position={[0, 0.2, 0]}>
        <sphereGeometry args={[0.15, 16, 16]} />
        <meshStandardMaterial color="#6aaa6a" emissive="#2a4a2a" emissiveIntensity={0.3} />
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

export function PlantViewer({ scale }: Props) {
  const tick = useSimStore((s) => s.tick)

  useFrame((_, dt) => {
    tick(dt)
  })

  return (
    <>
      {scale === 'macro' && <MacroView />}
      {scale === 'architecture' && <ArchitectureView />}
      {scale === 'cellular' && <CellularView />}
      {scale === 'roots' && <RootsView />}
    </>
  )
}
