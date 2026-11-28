/**
 * Organelle close-up: one tachyzoite, cut open, at ~1 world unit per µm.
 *
 * Every dimension is from `docs/research/toxoplasma-gondii-parameters.md` §§3–4:
 * 22 subpellicular microtubules from the apical polar ring running about
 * two-thirds of the body; a conoid 400 nm across and 250 nm long built from 14
 * spiralling tubulin fibres; the apicoplast immediately anterior to the
 * nucleus; rhoptries, micronemes and dense granules at their measured sizes.
 */

import { useEffect, useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import { Html } from '@react-three/drei'
import * as THREE from 'three'
import { crescentGeometry } from './bodyGeometry'
import { useParasiteStore } from '../../stores/parasiteStore'
import { STAGE_DEFS } from '../../simulation/parasite/stages'

/** Research §4: counts that matter, kept as named constants. */
const SUBPELLICULAR_MICROTUBULES = 22
const CONOID_FIBRES = 14
const CONOID_BASE_DIAMETER = 0.4 // µm
const CONOID_LENGTH = 0.25 // µm
const RNG2_FILAMENTS = 22

const LABEL_STYLE: React.CSSProperties = {
  fontSize: '0.6rem',
  letterSpacing: '0.04em',
  color: '#9ad6c8',
  background: 'rgba(6, 14, 16, 0.82)',
  border: '1px solid #1d3a3a',
  borderRadius: 6,
  padding: '3px 7px',
  whiteSpace: 'nowrap',
  pointerEvents: 'none',
  transform: 'translate(-50%, -50%)',
}

function Label({ position, text }: { position: [number, number, number]; text: string }) {
  return (
    <Html position={position} center distanceFactor={9} zIndexRange={[20, 0]}>
      <div style={LABEL_STYLE}>{text}</div>
    </Html>
  )
}

/** The 22 subpellicular microtubules, as lines under the pellicle. */
function SubpellicularNetwork({ length, width }: { length: number; width: number }) {
  const geometry = useMemo(() => {
    const points: number[] = []
    const amp = 0.12 * length
    for (let i = 0; i < SUBPELLICULAR_MICROTUBULES; i++) {
      const a = (i / SUBPELLICULAR_MICROTUBULES) * Math.PI * 2
      // each MT starts at the apical polar ring and runs ~2/3 of the body
      for (let s = 0; s < 24; s++) {
        const t0 = (s / 24) * 0.66
        const t1 = ((s + 1) / 24) * 0.66
        for (const t of [t0, t1]) {
          const r = (width / 2) * 0.92 * Math.min(1, (t / 0.22) ** 0.65) * (1 - 0.18 * Math.max(0, (t - 0.5) / 0.5))
          // MTs spiral gently as they run back
          const twist = a + t * 0.9
          points.push(
            amp * Math.sin(Math.PI * t) + Math.cos(twist) * r,
            Math.sin(twist) * r,
            (0.5 - t) * length,
          )
        }
      }
    }
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.Float32BufferAttribute(points, 3))
    return g
  }, [length, width])

  useEffect(() => () => geometry.dispose(), [geometry])

  return (
    <lineSegments geometry={geometry}>
      <lineBasicMaterial color="#3fd6c0" transparent opacity={0.55} />
    </lineSegments>
  )
}

/** Conoid: 14 comma-shaped fibres plus the two preconoidal rings. */
function Conoid({ apexZ, extruded }: { apexZ: number; extruded: number }) {
  const group = useRef<THREE.Group>(null)
  const fibre = useMemo(
    () => new THREE.CylinderGeometry(0.012, 0.012, CONOID_LENGTH, 5, 1, false),
    [],
  )
  useEffect(() => () => fibre.dispose(), [fibre])

  useFrame(() => {
    if (group.current) {
      // Ca²⁺-driven extrusion past the apical polar ring, powered by MyoH
      group.current.position.z = apexZ + extruded * 0.22
    }
  })

  return (
    <group ref={group} position={[0, 0, apexZ]}>
      {Array.from({ length: CONOID_FIBRES }, (_, i) => {
        const a = (i / CONOID_FIBRES) * Math.PI * 2
        const r = CONOID_BASE_DIAMETER / 2
        return (
          <mesh
            key={i}
            geometry={fibre}
            position={[Math.cos(a) * r * 0.78, Math.sin(a) * r * 0.78, 0]}
            rotation={[Math.PI / 2, 0, a * 0.25]}
          >
            <meshStandardMaterial color="#ffe9a8" emissive="#c9a14a" emissiveIntensity={0.3} roughness={0.5} />
          </mesh>
        )
      })}
      {/* two preconoidal rings */}
      {[0.1, 0.16].map((z, i) => (
        <mesh key={z} position={[0, 0, CONOID_LENGTH / 2 + z]} rotation={[Math.PI / 2, 0, 0]}>
          <torusGeometry args={[CONOID_BASE_DIAMETER * (0.34 - i * 0.06), 0.015, 8, 28]} />
          <meshStandardMaterial color="#fff3cf" emissive="#d8b35e" emissiveIntensity={0.45} />
        </mesh>
      ))}
      {/* 2 intraconoidal microtubules */}
      {[-1, 1].map((s) => (
        <mesh key={s} position={[s * 0.035, 0, 0]} rotation={[Math.PI / 2, 0, 0]}>
          <cylinderGeometry args={[0.009, 0.009, CONOID_LENGTH * 1.5, 4]} />
          <meshStandardMaterial color="#8ef0dd" emissive="#2f9c8a" emissiveIntensity={0.3} />
        </mesh>
      ))}
    </group>
  )
}

/** Apical polar ring plus the 22 RNG2 filaments that tether the conoid to it. */
function ApicalPolarRing({ apexZ, radius }: { apexZ: number; radius: number }) {
  const geometry = useMemo(() => {
    const pts: number[] = []
    for (let i = 0; i < RNG2_FILAMENTS; i++) {
      const a = (i / RNG2_FILAMENTS) * Math.PI * 2
      pts.push(Math.cos(a) * radius, Math.sin(a) * radius, apexZ - 0.03)
      pts.push(Math.cos(a) * radius * 0.55, Math.sin(a) * radius * 0.55, apexZ + 0.16)
    }
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3))
    return g
  }, [apexZ, radius])
  useEffect(() => () => geometry.dispose(), [geometry])

  return (
    <group>
      <mesh position={[0, 0, apexZ - 0.03]} rotation={[Math.PI / 2, 0, 0]}>
        <torusGeometry args={[radius, 0.022, 8, 32]} />
        <meshStandardMaterial color="#d6f5ec" emissive="#54b9a4" emissiveIntensity={0.25} />
      </mesh>
      <lineSegments geometry={geometry}>
        <lineBasicMaterial color="#7ee0cc" transparent opacity={0.7} />
      </lineSegments>
    </group>
  )
}

export function OrganelleView() {
  const stage = STAGE_DEFS.tachyzoite
  const length = stage.length
  const width = stage.width

  const pellicle = useMemo(
    () => crescentGeometry({ length, width, bend: 0.1, radialSegments: 28, lengthSegments: 48 }),
    [length, width],
  )
  const imc = useMemo(
    () => crescentGeometry({ length: length * 0.985, width: width * 0.9, bend: 0.1, radialSegments: 24, lengthSegments: 40 }),
    [length, width],
  )
  useEffect(() => () => {
    pellicle.dispose()
    imc.dispose()
  }, [pellicle, imc])

  // the conoid extrudes on the same Ca²⁺ signal that drives egress
  const extruded = useRef(0)
  const conoidDriver = useRef<THREE.Group>(null)
  useFrame(() => {
    const { world } = useParasiteStore.getState()
    const pv = world.cells.find((c) => c.pv)?.pv
    extruded.current = pv ? Math.min(1, pv.egress.calcium) : 0
    if (conoidDriver.current) conoidDriver.current.scale.setScalar(1)
  })

  const apexZ = length / 2
  const bowX = (t: number) => 0.1 * length * Math.sin(Math.PI * t)

  return (
    <group ref={conoidDriver}>
      {/* plasma membrane + inner membrane complex */}
      <mesh geometry={pellicle}>
        <meshPhysicalMaterial
          color="#7fe8d4"
          transparent
          opacity={0.17}
          roughness={0.35}
          transmission={0.6}
          thickness={0.4}
          side={THREE.DoubleSide}
          depthWrite={false}
        />
      </mesh>
      <mesh geometry={imc}>
        <meshStandardMaterial color="#2a7f72" transparent opacity={0.22} side={THREE.BackSide} />
      </mesh>

      <SubpellicularNetwork length={length} width={width} />
      <ApicalPolarRing apexZ={apexZ - 0.12} radius={width * 0.2} />
      <Conoid apexZ={apexZ - 0.02} extruded={extruded.current} />

      {/* nucleus — central in a tachyzoite */}
      <mesh position={[bowX(0.56), 0, (0.5 - 0.56) * length]}>
        <sphereGeometry args={[width * 0.38, 24, 18]} />
        <meshStandardMaterial color="#b49bf0" roughness={0.6} emissive="#4a3a7a" emissiveIntensity={0.25} />
      </mesh>

      {/* apicoplast — just anterior to the nucleus, four membranes, 35 kb genome */}
      <mesh position={[bowX(0.44), 0, (0.5 - 0.44) * length]} scale={[0.5, 0.5, 1.5]}>
        <sphereGeometry args={[width * 0.2, 18, 14]} />
        <meshStandardMaterial color="#ffd27f" emissive="#b4761f" emissiveIntensity={0.4} roughness={0.5} />
      </mesh>

      {/* rhoptries — club-shaped, necks toward the apex */}
      {[-1, 1].map((s, i) => (
        <mesh
          key={`rop${i}`}
          position={[bowX(0.3) + s * width * 0.18, s * width * 0.1, (0.5 - 0.3) * length]}
          rotation={[Math.PI / 2 - 0.25 * s, 0, 0]}
        >
          <coneGeometry args={[width * 0.12, length * 0.28, 12]} />
          <meshStandardMaterial color="#f4a3c0" roughness={0.55} emissive="#7a2f4a" emissiveIntensity={0.2} />
        </mesh>
      ))}

      {/* micronemes — small rods packed at the apical third */}
      {Array.from({ length: 14 }, (_, i) => {
        const t = 0.16 + (i % 7) * 0.025
        const a = (i / 14) * Math.PI * 2
        const r = width * 0.26
        return (
          <mesh
            key={`mic${i}`}
            position={[bowX(t) + Math.cos(a) * r, Math.sin(a) * r, (0.5 - t) * length]}
            rotation={[Math.PI / 2, 0, 0]}
          >
            <capsuleGeometry args={[0.03, 0.12, 3, 6]} />
            <meshStandardMaterial color="#8fd8ff" emissive="#2b6f9c" emissiveIntensity={0.35} />
          </mesh>
        )
      })}

      {/* dense granules — ~244 nm, scattered through the body */}
      {Array.from({ length: 9 }, (_, i) => {
        const t = 0.4 + (i / 9) * 0.45
        const a = i * 2.3
        const r = width * 0.22
        return (
          <mesh key={`gra${i}`} position={[bowX(t) + Math.cos(a) * r, Math.sin(a) * r, (0.5 - t) * length]}>
            <sphereGeometry args={[0.122, 10, 8]} />
            <meshStandardMaterial color="#dfe9ff" roughness={0.4} />
          </mesh>
        )
      })}

      {/* amylopectin granules — ~201 nm, the bradyzoite's larder, present but sparse here */}
      {Array.from({ length: 5 }, (_, i) => {
        const t = 0.68 + (i / 5) * 0.22
        const a = i * 1.7 + 0.6
        return (
          <mesh
            key={`amy${i}`}
            position={[bowX(t) + Math.cos(a) * width * 0.2, Math.sin(a) * width * 0.2, (0.5 - t) * length]}
          >
            <sphereGeometry args={[0.1, 8, 6]} />
            <meshStandardMaterial color="#cdf5c4" roughness={0.75} />
          </mesh>
        )
      })}

      {/* basal complex — MORN-1 constrictive ring */}
      <mesh position={[bowX(0.97), 0, (0.5 - 0.97) * length]} rotation={[Math.PI / 2, 0, 0]}>
        <torusGeometry args={[width * 0.16, 0.02, 8, 24]} />
        <meshStandardMaterial color="#9fe0ff" emissive="#2f6f8c" emissiveIntensity={0.3} />
      </mesh>

      {/* Labels sit above and below the body along its long axis, so they stay
          legible from the side-on camera the organelle view frames. */}
      <Label position={[0, 1.6, apexZ - 0.6]} text={`Conoid · ${CONOID_FIBRES} fibres, 400 × 250 nm`} />
      <Label position={[0, -1.6, (0.5 - 0.18) * length]} text="Micronemes · MICs, AMA1, PLP1" />
      <Label position={[0, 1.8, (0.5 - 0.3) * length]} text="Rhoptries · ROP16, ROP18/5" />
      <Label position={[0, -2.1, (0.5 - 0.46) * length]} text="Apicoplast · 35 kb genome" />
      <Label position={[0, 2.1, (0.5 - 0.6) * length]} text="Nucleus" />
      <Label position={[0, -1.7, (0.5 - 0.78) * length]} text={`${SUBPELLICULAR_MICROTUBULES} subpellicular MTs`} />
      <Label position={[0, 1.5, (0.5 - 0.99) * length]} text="Basal complex · MORN-1" />
    </group>
  )
}
