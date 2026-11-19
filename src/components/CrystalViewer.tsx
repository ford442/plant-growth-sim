import { useEffect, useMemo, useRef, useState, type RefObject } from 'react'
import { useFrame } from '@react-three/fiber'
import { Html, Lightformer, Sparkles } from '@react-three/drei'
import * as THREE from 'three'
import { useSimStore } from '../stores/simStore'
import { GEMSTONE_PRESETS, type GemstoneDef, type SubstrateKind } from '../simulation/GemstonePresets'
import {
  GEODE_RADIUS,
  KIMBERLITE_CENTER,
  KIMBERLITE_RADIUS,
  PLATE_RADIUS,
  specimenPolyhedron,
  zoneColors,
} from '../simulation/CrystalGrowth'
import { familyLabelAnchors, polyhedronEdges, polyhedronExtents, polyhedronToMesh, type Vec3 } from '../simulation/CrystalHabit'
import { lerpColor, mixColors } from '../simulation/color'
import { LatticeView } from './LatticeView'

export type GemViewScale = 'formation' | 'crystal' | 'lattice'

export interface GemViewOptions {
  faceIndexing: boolean
  phantoms: boolean
}

/**
 * Formation view: substrate is laid out in cm (1 world unit = 1 cm); crystals
 * of small-growing gems are drawn a little enlarged so the druse stays legible.
 */
const formationMm = (def: GemstoneDef) => 0.1 * Math.min(1.8, Math.max(1, 8 / def.kinetics.maxRadius))

// ---------------------------------------------------------------------------
// Shared hooks
// ---------------------------------------------------------------------------

/** Volume-weighted body colour of the specimen (re-computed when zones change). */
function useBodyColor(def: GemstoneDef): string {
  const zones = useSimStore((s) => s.crystal.zones)
  const peak = useSimStore((s) => Math.round(s.crystal.peakTemperature / 10) * 10)
  // the newest zone's weight grows with the crystal: refresh every 0.25 mm
  const rq = useSimStore((s) => Math.round(s.crystal.nuclei[0].radius * 4) / 4)
  return useMemo(() => {
    const crystal = useSimStore.getState().crystal
    return mixColors(zoneColors(def, { ...crystal, zones, peakTemperature: peak }))
  }, [def, zones, peak, rq])
}

/**
 * Keeps a BufferGeometry of the specimen habit normalised to unit equivalent
 * radius. It is rebuilt only when the face-distance ratios actually change, so
 * smooth growth is just a per-frame scale.
 */
function useHabitGeometry(def: GemstoneDef, onRebuild?: (hn: number[]) => void) {
  const geometry = useRef<THREE.BufferGeometry>(new THREE.BufferGeometry())
  const lastH = useRef<number[] | null>(null)
  const halfLength = useRef(1)
  const halfExtent = useRef(1)
  const target = useRef<THREE.Mesh | THREE.InstancedMesh | null>(null)

  useEffect(() => {
    lastH.current = null
  }, [def])
  useEffect(() => () => geometry.current.dispose(), [])

  const update = (h: number[], radius: number) => {
    const hn = h.map((x) => x / Math.max(radius, 1e-6))
    const prev = lastH.current
    if (prev && prev.length === hn.length && hn.every((x, i) => Math.abs(x - prev[i]) < 0.004)) return
    lastH.current = hn
    const poly = specimenPolyhedron(def, hn)
    const mesh = polyhedronToMesh(poly)
    const colors = new Float32Array(mesh.families.length * 3)
    const c = new THREE.Color()
    for (let i = 0; i < mesh.families.length; i++) {
      c.set(def.faces[mesh.families[i]]?.color ?? '#888888')
      colors.set([c.r, c.g, c.b], i * 3)
    }
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.BufferAttribute(mesh.positions, 3))
    g.setAttribute('normal', new THREE.BufferAttribute(mesh.normals, 3))
    g.setAttribute('color', new THREE.BufferAttribute(colors, 3))
    g.computeBoundingSphere()
    const old = geometry.current
    geometry.current = g
    if (target.current) target.current.geometry = g
    old.dispose()
    const ext = polyhedronExtents(poly)
    halfLength.current = ext.length / 2
    halfExtent.current = Math.max(ext.length, ext.width) / 2
    onRebuild?.(hn)
  }

  const attach = (m: THREE.Mesh | THREE.InstancedMesh | null) => {
    target.current = m
    if (m) m.geometry = geometry.current
  }

  return { update, attach, halfLength, halfExtent, geometry }
}

function GemMaterial({
  def,
  color,
  thickness,
  faceIndexing,
}: {
  def: GemstoneDef
  color: string
  thickness: number
  faceIndexing: boolean
}) {
  if (faceIndexing) {
    return <meshStandardMaterial vertexColors flatShading roughness={0.45} metalness={0.05} />
  }
  return (
    <meshPhysicalMaterial
      color={lerpColor('#ffffff', color, 0.55)}
      transmission={0.96}
      thickness={thickness}
      ior={def.optics.ior}
      dispersion={def.optics.dispersion * 12}
      roughness={def.optics.roughness}
      attenuationColor={color}
      attenuationDistance={0.9}
      specularIntensity={1}
      clearcoat={0.6}
      clearcoatRoughness={0.05}
      envMapIntensity={2.2}
      emissive={color}
      emissiveIntensity={0.08}
      flatShading
    />
  )
}

// ---------------------------------------------------------------------------
// Substrates (matrix rock) — procedural, deterministic
// ---------------------------------------------------------------------------

function noise3(x: number, y: number, z: number): number {
  return (
    Math.sin(x * 3.1 + y * 1.7) * 0.5 +
    Math.sin(y * 4.3 + z * 2.9) * 0.3 +
    Math.sin(z * 5.7 + x * 3.3) * 0.2
  )
}

function roughen(g: THREE.BufferGeometry, amp: number, keepTop?: number) {
  const p = g.attributes.position as THREE.BufferAttribute
  const v = new THREE.Vector3()
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i)
    if (keepTop !== undefined && v.y >= keepTop - 1e-3) {
      v.y += noise3(v.x * 2, 0, v.z * 2) * amp * 0.25
    } else {
      const n = 1 + noise3(v.x, v.y, v.z) * amp
      v.multiplyScalar(n)
    }
    p.setXYZ(i, v.x, v.y, v.z)
  }
  g.computeVertexNormals()
  return g
}

function Substrate({ kind, color }: { kind: SubstrateKind; color: string }) {
  const parts = useMemo(() => {
    if (kind === 'geode') {
      const outer = roughen(new THREE.SphereGeometry(GEODE_RADIUS + 1.0, 48, 24, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2), 0.035)
      const inner = new THREE.SphereGeometry(GEODE_RADIUS + 0.02, 48, 24, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2)
      const rim = new THREE.RingGeometry(GEODE_RADIUS, GEODE_RADIUS + 1.0, 96, 6)
      // agate banding as vertex colours
      const pos = rim.attributes.position as THREE.BufferAttribute
      const cols = new Float32Array(pos.count * 3)
      const c = new THREE.Color()
      for (let i = 0; i < pos.count; i++) {
        const r = Math.hypot(pos.getX(i), pos.getY(i))
        const band = Math.sin((r - GEODE_RADIUS) * 55) * 0.5 + 0.5
        c.set(lerpColor('#a89cb6', '#5d5168', band))
        if (r > GEODE_RADIUS + 0.8) c.set(color)
        cols.set([c.r, c.g, c.b], i * 3)
      }
      rim.setAttribute('color', new THREE.BufferAttribute(cols, 3))
      return { outer, inner, rim }
    }
    if (kind === 'kimberlite') {
      const blob = roughen(new THREE.IcosahedronGeometry(KIMBERLITE_RADIUS, 4), 0.07)
      return { blob }
    }
    const slab = roughen(new THREE.CylinderGeometry(PLATE_RADIUS + 0.6, PLATE_RADIUS + 0.2, 0.8, 40, 4), 0.06, 0.4)
    return { slab }
  }, [kind, color])

  useEffect(() => () => Object.values(parts).forEach((g) => g.dispose()), [parts])

  if ('outer' in parts) {
    return (
      <group>
        <mesh geometry={parts.outer} receiveShadow>
          <meshStandardMaterial color={color} roughness={0.95} side={THREE.FrontSide} />
        </mesh>
        <mesh geometry={parts.inner}>
          <meshStandardMaterial color="#5c5068" roughness={0.6} side={THREE.BackSide} />
        </mesh>
        <mesh geometry={parts.rim} rotation={[-Math.PI / 2, 0, 0]}>
          <meshStandardMaterial vertexColors roughness={0.5} side={THREE.DoubleSide} />
        </mesh>
      </group>
    )
  }
  if ('blob' in parts) {
    return (
      <group position={KIMBERLITE_CENTER}>
        <mesh geometry={parts.blob} receiveShadow>
          <meshStandardMaterial color={color} roughness={0.9} flatShading />
        </mesh>
        <OlivineSpecks />
      </group>
    )
  }
  return (
    <mesh geometry={parts.slab} position={[0, -0.4, 0]} receiveShadow>
      <meshStandardMaterial color={color} roughness={0.95} flatShading />
    </mesh>
  )
}

function OlivineSpecks() {
  const ref = useRef<THREE.InstancedMesh>(null)
  const count = 36
  useEffect(() => {
    if (!ref.current) return
    const d = new THREE.Object3D()
    for (let i = 0; i < count; i++) {
      const u = Math.sin(i * 12.9898) * 43758.5453
      const w = Math.sin(i * 78.233) * 12345.678
      const theta = (u - Math.floor(u)) * Math.PI * 2
      const phi = Math.acos(2 * (w - Math.floor(w)) - 1)
      d.position.set(Math.sin(phi) * Math.cos(theta), Math.cos(phi), Math.sin(phi) * Math.sin(theta)).multiplyScalar(KIMBERLITE_RADIUS * 0.98)
      d.scale.setScalar(0.05 + 0.05 * ((u * 7) % 1 + 1) / 2)
      d.updateMatrix()
      ref.current.setMatrixAt(i, d.matrix)
    }
    ref.current.instanceMatrix.needsUpdate = true
  }, [])
  return (
    <instancedMesh ref={ref} args={[undefined, undefined, count]}>
      <icosahedronGeometry args={[1, 0]} />
      <meshStandardMaterial color="#7a9a3a" roughness={0.6} flatShading />
    </instancedMesh>
  )
}

// ---------------------------------------------------------------------------
// Formation view — the druse / geode / kimberlite specimen
// ---------------------------------------------------------------------------

const EMBED: Record<SubstrateKind, number> = { plate: 0.22, geode: 0.16, kimberlite: 0.35 }

function FormationView({ def, faceIndexing }: { def: GemstoneDef; faceIndexing: boolean }) {
  const meshRef = useRef<THREE.InstancedMesh>(null)
  const habit = useHabitGeometry(def)
  const color = useBodyColor(def)
  const capacity = def.kinetics.nucleation.max + 1
  const tmp = useMemo(
    () => ({ m: new THREE.Matrix4(), q: new THREE.Quaternion(), qs: new THREE.Quaternion(), p: new THREE.Vector3(), s: new THREE.Vector3(), a: new THREE.Vector3(), up: new THREE.Vector3(0, 1, 0) }),
    []
  )

  useFrame(() => {
    const mesh = meshRef.current
    if (!mesh) return
    const { crystal } = useSimStore.getState()
    habit.update(crystal.h, crystal.nuclei[0].radius)
    const embed = EMBED[def.substrate]
    const MM = formationMm(def)
    const n = Math.min(capacity, crystal.nuclei.length)
    for (let i = 0; i < n; i++) {
      const c = crystal.nuclei[i]
      const scale = c.radius * MM
      tmp.a.set(c.axis[0], c.axis[1], c.axis[2])
      tmp.q.setFromUnitVectors(tmp.up, tmp.a)
      tmp.qs.setFromAxisAngle(tmp.up, c.spin)
      tmp.q.multiply(tmp.qs)
      const lift = habit.halfLength.current * scale * (1 - 2 * embed)
      tmp.p.set(c.pos[0] + tmp.a.x * lift, c.pos[1] + tmp.a.y * lift, c.pos[2] + tmp.a.z * lift)
      tmp.s.setScalar(scale)
      tmp.m.compose(tmp.p, tmp.q, tmp.s)
      mesh.setMatrixAt(i, tmp.m)
    }
    mesh.count = n
    mesh.instanceMatrix.needsUpdate = true
  })

  return (
    <group>
      <Substrate kind={def.substrate} color={def.substrateColor} />
      <instancedMesh
        key={`${def.id}-${faceIndexing}`}
        ref={(m) => {
          meshRef.current = m
          habit.attach(m)
        }}
        args={[undefined, undefined, capacity]}
        castShadow
        frustumCulled={false}
      >
        <GemMaterial def={def} color={color} thickness={0.6} faceIndexing={faceIndexing} />
      </instancedMesh>
      {/* hydrothermal fluid / melt shimmer */}
      <Sparkles
        count={50}
        scale={[6, 3, 6]}
        position={[0, 1.4, 0]}
        size={1.6}
        speed={0.25}
        opacity={0.35}
        color={def.substrate === 'kimberlite' ? '#ffb070' : '#cfe8ff'}
      />
    </group>
  )
}

// ---------------------------------------------------------------------------
// Crystal view — one specimen: optics, face indexing, growth phantoms
// ---------------------------------------------------------------------------

function Phantoms({ def, worldPerMm }: { def: GemstoneDef; worldPerMm: number }) {
  const zones = useSimStore((s) => s.crystal.zones)
  const peak = useSimStore((s) => Math.round(s.crystal.peakTemperature / 10) * 10)
  // a phantom only survives if it is still inside the crystal (not dissolved)
  const rq = useSimStore((s) => Math.round(s.crystal.nuclei[0].radius * 20) / 20)
  const lines = useMemo(() => {
    // each recorded zone start is an old crystal surface: a phantom
    return zones.slice(1).filter((z) => z.radius < rq * 0.97).map((z) => {
      const g = new THREE.BufferGeometry()
      g.setAttribute('position', new THREE.BufferAttribute(polyhedronEdges(specimenPolyhedron(def, z.h), worldPerMm), 3))
      const col = def.bodyColor(z.impurity, z.temperature, peak)
      return { g, color: lerpColor(col, '#ffffff', 0.25), key: `${z.age.toFixed(3)}` }
    })
  }, [zones, def, worldPerMm, peak, rq])
  useEffect(() => () => lines.forEach((l) => l.g.dispose()), [lines])
  return (
    <group>
      {lines.map((l) => (
        // opaque on purpose: opaque objects are captured by the transmission
        // pass, so the phantom is seen refracted through the gem
        <lineSegments key={l.key} geometry={l.g}>
          <lineBasicMaterial color={l.color} />
        </lineSegments>
      ))}
    </group>
  )
}

interface Label {
  family: number
  pos: Vec3
}

function CrystalView({ def, options }: { def: GemstoneDef; options: GemViewOptions }) {
  const meshRef = useRef<THREE.Mesh>(null)
  const edgesRef = useRef<THREE.LineSegments>(null)
  const turntable = useRef<THREE.Group>(null)
  const [labels, setLabels] = useState<Label[]>([])
  // fixed display scale per gemstone so growth reads as growth; fitted to the
  // habit at its formation conditions (tall quartz vs flat ruby tablets)
  const worldPerMm = useMemo(() => {
    const st = useSimStore.getState()
    const ext = polyhedronExtents(specimenPolyhedron(def, st.crystal.h.map((x) => x / st.crystal.nuclei[0].radius)))
    return 1.9 / (def.kinetics.maxRadius * Math.max(ext.length, ext.width, 2.4) * 0.5)
  }, [def])
  const color = useBodyColor(def)
  const [thickness, setThickness] = useState(1)

  const habit = useHabitGeometry(def, (hn) => {
    const poly = specimenPolyhedron(def, hn)
    // outline edges for crispness
    if (edgesRef.current) {
      edgesRef.current.geometry.dispose()
      const g = new THREE.BufferGeometry()
      g.setAttribute('position', new THREE.BufferAttribute(polyhedronEdges(poly), 3))
      edgesRef.current.geometry = g
    }
    const anchors = familyLabelAnchors(poly)
    setLabels([...anchors.entries()].map(([family, a]) => ({ family, pos: a.pos })))
  })

  useFrame((_, dt) => {
    const { crystal } = useSimStore.getState()
    const r = crystal.nuclei[0].radius
    habit.update(crystal.h, r)
    const s = Math.max(r * worldPerMm, 0.02)
    meshRef.current?.scale.setScalar(s)
    edgesRef.current?.scale.setScalar(s * 1.001)
    if (turntable.current) turntable.current.rotation.y += dt * 0.18
    const t = Math.round(s * 2 * 10) / 10
    if (t !== thickness) setThickness(t)
  })

  return (
    <group>
      <group ref={turntable} position={[0, CRYSTAL_Y, 0]}>
        <mesh
          key={`${def.id}-${options.faceIndexing}`}
          ref={(m) => {
            meshRef.current = m
            habit.attach(m)
          }}
          castShadow
        >
          <GemMaterial def={def} color={color} thickness={thickness} faceIndexing={options.faceIndexing} />
        </mesh>
        <lineSegments ref={edgesRef}>
          <lineBasicMaterial color={options.faceIndexing ? '#0b0b12' : '#ffffff'} transparent opacity={options.faceIndexing ? 0.9 : 0.18} />
        </lineSegments>
        {options.phantoms && <Phantoms def={def} worldPerMm={worldPerMm} />}
        {/* crystallographic c-axis */}
        <mesh>
          <cylinderGeometry args={[0.006, 0.006, 4.2, 6]} />
          <meshBasicMaterial color="#9aa7ff" transparent opacity={0.35} />
        </mesh>
        <Html position={[0, 2.15, 0]} center className="axis-label">
          c
        </Html>
        {options.faceIndexing &&
          labels.map((l) => (
            <FaceLabel key={l.family} def={def} family={l.family} pos={l.pos} meshRef={meshRef} />
          ))}
      </group>
      {/* pedestal */}
      <group position={[0, CRYSTAL_Y - 2.55, 0]}>
        <mesh position={[0, -0.05, 0]} receiveShadow>
          <cylinderGeometry args={[1.6, 1.8, 0.1, 64]} />
          <meshStandardMaterial color="#14121c" roughness={0.4} metalness={0.3} />
        </mesh>
        <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.002, 0]}>
          <ringGeometry args={[1.5, 1.56, 96]} />
          <meshBasicMaterial color={def.swatch} transparent opacity={0.5} />
        </mesh>
      </group>
      <Backlight color={def.swatch} />
    </group>
  )
}

/** Miller-index label that follows the scaled specimen. */
function FaceLabel({
  def,
  family,
  pos,
  meshRef,
}: {
  def: GemstoneDef
  family: number
  pos: Vec3
  meshRef: RefObject<THREE.Mesh | null>
}) {
  const ref = useRef<THREE.Group>(null)
  useFrame(() => {
    const s = meshRef.current?.scale.x ?? 1
    ref.current?.position.set(pos[0] * s * 1.08, pos[1] * s * 1.08, pos[2] * s * 1.08)
  })
  const f = def.faces[family]
  return (
    <group ref={ref}>
      <Html center className="face-label" style={{ borderColor: f.color, color: f.color }}>
        <b>{f.symbol}</b> {f.form}
      </Html>
    </group>
  )
}

// ---------------------------------------------------------------------------
// Studio backdrop: transmissive gems refract whatever is behind them, so give
// them a gradient sweep (and, in the crystal view, softboxes) to work with.
// ---------------------------------------------------------------------------

/** Orbit target per gem view (App passes it to OrbitControls). */
export const GEM_VIEW_TARGET: Record<GemViewScale, [number, number, number]> = {
  formation: [0, 0.6, 0],
  crystal: [0, 1.2, 0],
  lattice: [0, -0.2, 0],
}
const CRYSTAL_Y = 1.25

function GradientDome() {
  const geo = useMemo(() => {
    const g = new THREE.SphereGeometry(24, 48, 32)
    const pos = g.attributes.position as THREE.BufferAttribute
    const cols = new Float32Array(pos.count * 3)
    const c = new THREE.Color()
    for (let i = 0; i < pos.count; i++) {
      const y = pos.getY(i) / 24
      c.set(y > 0 ? lerpColor('#2b2640', '#0c0b14', Math.min(1, y * 1.6)) : lerpColor('#2b2640', '#060509', Math.min(1, -y * 3)))
      cols.set([c.r, c.g, c.b], i * 3)
    }
    g.setAttribute('color', new THREE.BufferAttribute(cols, 3))
    return g
  }, [])
  useEffect(() => () => geo.dispose(), [geo])
  return (
    <mesh geometry={geo}>
      <meshBasicMaterial vertexColors side={THREE.BackSide} fog={false} depthWrite={false} />
    </mesh>
  )
}

/** Studio light panels — rendered only into the environment map, so they
 * show up as crisp facet reflections without cluttering the scene. */
export function GemLightformers() {
  return (
    <>
      <Lightformer form="rect" intensity={6} position={[-5, 4, -3]} scale={[2.5, 7, 1]} target={[0, 1, 0]} />
      <Lightformer form="rect" intensity={4} position={[5, 3, 2]} scale={[2, 6, 1]} target={[0, 1, 0]} color="#e4dcff" />
      <Lightformer form="ring" intensity={3} position={[0, 8, 0]} scale={5} rotation-x={Math.PI / 2} />
      <Lightformer form="rect" intensity={2} position={[0, 1, 7]} scale={[8, 1.2, 1]} target={[0, 1, 0]} />
    </>
  )
}

let glowTexture: THREE.CanvasTexture | null = null
function radialGlow(): THREE.CanvasTexture {
  if (glowTexture) return glowTexture
  const c = document.createElement('canvas')
  c.width = c.height = 128
  const g = c.getContext('2d')!
  const grad = g.createRadialGradient(64, 64, 0, 64, 64, 64)
  grad.addColorStop(0, 'rgba(255,255,255,0.9)')
  grad.addColorStop(0.35, 'rgba(255,255,255,0.35)')
  grad.addColorStop(1, 'rgba(255,255,255,0)')
  g.fillStyle = grad
  g.fillRect(0, 0, 128, 128)
  glowTexture = new THREE.CanvasTexture(c)
  return glowTexture
}

/** Soft glow kept behind the specimen (opposite the camera) for it to refract. */
function Backlight({ color }: { color: string }) {
  const ref = useRef<THREE.Mesh>(null)
  const tint = useMemo(() => lerpColor('#8f86c8', color, 0.35), [color])
  const center = useMemo(() => new THREE.Vector3(0, CRYSTAL_Y, 0), [])
  const dir = useMemo(() => new THREE.Vector3(), [])
  useFrame(({ camera }) => {
    if (!ref.current) return
    dir.copy(center).sub(camera.position).normalize()
    ref.current.position.copy(center).addScaledVector(dir, 6)
    ref.current.quaternion.copy(camera.quaternion)
  })
  return (
    <mesh ref={ref}>
      <planeGeometry args={[11, 11]} />
      <meshBasicMaterial map={radialGlow()} color={tint} transparent opacity={0.55} depthWrite={false} toneMapped={false} fog={false} />
    </mesh>
  )
}

export function CrystalViewer({ scale, options }: { scale: GemViewScale; options: GemViewOptions }) {
  const gemstone = useSimStore((s) => s.gemstone)
  const def = GEMSTONE_PRESETS[gemstone]
  return (
    <>
      <GradientDome />
      {scale === 'formation' && <FormationView key={def.id} def={def} faceIndexing={options.faceIndexing} />}
      {scale === 'crystal' && <CrystalView key={def.id} def={def} options={options} />}
      {scale === 'lattice' && <LatticeView key={def.id} def={def} />}
    </>
  )
}
