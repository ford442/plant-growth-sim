import { useEffect, useMemo, useRef, useState, type RefObject } from 'react'
import { useFrame } from '@react-three/fiber'
import { Html, Lightformer } from '@react-three/drei'
import * as THREE from 'three'
import { useSimStore } from '../stores/simStore'
import { useTimeStore } from '../stores/timeStore'
import { GEMSTONE_PRESETS, type GemstoneDef, type SubstrateKind } from '../simulation/GemstonePresets'
import { GEODE_RADIUS, KIMBERLITE_CENTER, KIMBERLITE_RADIUS, PLATE_RADIUS, specimenPolyhedron } from '../simulation/CrystalGrowth'
import { familyLabelAnchors, polyhedronEdges, polyhedronExtents, type Vec3 } from '../simulation/CrystalHabit'
import { HABIT_TAU, easeHabit, gemAppearance, relaxFrost, type HabitPose } from '../simulation/GemOptics'
import { lerpColor } from '../simulation/color'
import { HabitGeometry } from './gem/habitGeometry'
import { useGemMaterial } from './gem/useGemMaterial'
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
// Shared: the eased specimen, its habit mesh and its optical material
// ---------------------------------------------------------------------------

/**
 * Per-frame driver shared by the formation and crystal views. It eases the
 * displayed specimen towards the simulation's (`easeHabit`: fast-forward steps
 * and sudden condition changes morph instead of snapping), re-meshes the habit
 * from that pose, and pushes `gemAppearance()` into the gem material — no React
 * state, so colour follows each growth zone continuously as it thickens.
 */
function useSpecimen(def: GemstoneDef) {
  const habit = useMemo(() => new HabitGeometry(def), [def])
  useEffect(() => () => habit.dispose(), [habit])
  const gem = useGemMaterial(def)
  const state = useRef({ pose: null as HabitPose | null, buf: { h: [] as number[], radius: 0, age: 0 }, frost: 0 })

  /** Advance one frame; returns the displayed specimen radius (mm). */
  const step = (dt: number, faceIndexing: boolean, worldPerMm: number, thicknessOf: (radius: number) => number) => {
    const { crystal, geology } = useSimStore.getState()
    const st = state.current
    const target: HabitPose = { h: crystal.h, radius: crystal.nuclei[0].radius, age: crystal.age }
    st.pose = easeHabit(st.pose, target, dt, HABIT_TAU, st.buf)
    const a = gemAppearance(def, crystal, geology)
    st.frost = relaxFrost(st.frost, a.frostTarget, useTimeStore.getState().isPlaying ? dt : 0)
    // the TSL material reads the pleochroism from `pleo`; the classic one from the vertex colours
    habit.update(st.pose.h, st.pose.radius, faceIndexing ? { mode: 'family' } : { mode: 'pleo', alongC: a.alongC, acrossC: a.acrossC })
    if (!faceIndexing) gem.update(a, st.frost, worldPerMm, thicknessOf(st.pose.radius))
    return st.pose.radius
  }

  return { habit, gem, step }
}

/** Face-indexing mode: opaque, one flat colour per face family. */
function FaceIndexMaterial() {
  return <meshStandardMaterial vertexColors flatShading roughness={0.45} metalness={0.05} />
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
  const meshRef = useRef<THREE.InstancedMesh | null>(null)
  const { habit, gem, step } = useSpecimen(def)
  const capacity = def.kinetics.nucleation.max + 1
  const MM = formationMm(def)
  const tmp = useMemo(
    () => ({ m: new THREE.Matrix4(), q: new THREE.Quaternion(), qs: new THREE.Quaternion(), p: new THREE.Vector3(), s: new THREE.Vector3(), a: new THREE.Vector3(), up: new THREE.Vector3(0, 1, 0) }),
    []
  )

  useFrame((_, dt) => {
    const mesh = meshRef.current
    if (!mesh) return
    // a typical crystal of the druse sets the transmission path length
    const heroRadius = step(dt, faceIndexing, MM, (r) => Math.max(0.05, r * MM))
    const { crystal } = useSimStore.getState()
    const embed = EMBED[def.substrate]
    const n = Math.min(capacity, crystal.nuclei.length)
    for (let i = 0; i < n; i++) {
      const c = crystal.nuclei[i]
      const scale = (i === 0 ? heroRadius : c.radius) * MM
      tmp.a.set(c.axis[0], c.axis[1], c.axis[2])
      tmp.q.setFromUnitVectors(tmp.up, tmp.a)
      tmp.qs.setFromAxisAngle(tmp.up, c.spin)
      tmp.q.multiply(tmp.qs)
      const lift = habit.halfLength * scale * (1 - 2 * embed)
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
        key={`${def.id}-${faceIndexing}-${gem.isNode}`}
        ref={(m) => {
          habit.attach(m, meshRef.current)
          meshRef.current = m
        }}
        args={[undefined, undefined, capacity]}
        castShadow
        frustumCulled={false}
      >
        {faceIndexing ? <FaceIndexMaterial /> : <primitive object={gem.material} attach="material" />}
      </instancedMesh>
      {/* hydrothermal fluid / melt shimmer */}
      <FluidShimmer hot={def.substrate === 'kimberlite'} />
    </group>
  )
}

const SHIMMER_COUNT = 50

/**
 * Drifting motes in the growth medium. Instanced quads with a basic material
 * rather than drei's `<Sparkles>` (a ShaderMaterial, which WebGPURenderer
 * cannot draw), so the formation view renders on both backends.
 */
function FluidShimmer({ hot }: { hot: boolean }) {
  const ref = useRef<THREE.InstancedMesh>(null)
  const seeds = useMemo(() => {
    const out = new Float32Array(SHIMMER_COUNT * 4)
    for (let i = 0; i < SHIMMER_COUNT; i++) {
      const r = (k: number) => {
        const x = Math.sin(i * 12.9898 + k * 78.233) * 43758.5453
        return x - Math.floor(x)
      }
      out.set([(r(1) - 0.5) * 6, r(2) * 3 - 0.1, (r(3) - 0.5) * 6, r(4)], i * 4)
    }
    return out
  }, [])
  const d = useMemo(() => new THREE.Object3D(), [])
  useFrame(({ clock, camera }) => {
    const mesh = ref.current
    if (!mesh) return
    const t = clock.elapsedTime * 0.25
    for (let i = 0; i < SHIMMER_COUNT; i++) {
      const o = i * 4
      const ph = seeds[o + 3] * 6.283
      d.position.set(seeds[o] + Math.sin(t + ph) * 0.15, 1.4 + seeds[o + 1] - 1.5 + ((t * 0.3 + seeds[o + 3]) % 1) * 0.6, seeds[o + 2] + Math.cos(t * 0.8 + ph) * 0.15)
      d.quaternion.copy(camera.quaternion)
      d.scale.setScalar(0.018 + 0.012 * (0.5 + 0.5 * Math.sin(t * 3 + ph * 2)))
      d.updateMatrix()
      mesh.setMatrixAt(i, d.matrix)
    }
    mesh.instanceMatrix.needsUpdate = true
  })
  return (
    <instancedMesh ref={ref} args={[undefined, undefined, SHIMMER_COUNT]} frustumCulled={false} userData={{ noExport: true }}>
      <circleGeometry args={[1, 8]} />
      <meshBasicMaterial color={hot ? '#ffb070' : '#cfe8ff'} transparent opacity={0.35} depthWrite={false} toneMapped={false} />
    </instancedMesh>
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
  const { habit, gem, step } = useSpecimen(def)
  const seen = useRef(-1)

  useFrame((_, dt) => {
    // three scales `thickness` by the mesh's own scale, and this mesh is the unit-radius habit
    // scaled to size: a path of one radius is thickness 1 (the formation view's instance scale is not
    // part of the model matrix, so it passes world units instead)
    const r = step(dt, options.faceIndexing, worldPerMm, () => 1)
    const s = Math.max(r * worldPerMm, 0.02)
    meshRef.current?.scale.setScalar(s)
    edgesRef.current?.scale.setScalar(s * 1.001)
    if (turntable.current) turntable.current.rotation.y += dt * 0.18
    if (habit.version !== seen.current && habit.poly) {
      seen.current = habit.version
      // outline edges for crispness
      if (edgesRef.current) {
        const pos = polyhedronEdges(habit.poly)
        const g = edgesRef.current.geometry
        const attr = g.getAttribute('position') as THREE.BufferAttribute | undefined
        if (attr && attr.array.length === pos.length) {
          ;(attr.array as Float32Array).set(pos)
          attr.needsUpdate = true
        } else {
          g.dispose()
          const ng = new THREE.BufferGeometry()
          ng.setAttribute('position', new THREE.BufferAttribute(pos, 3))
          edgesRef.current.geometry = ng
        }
      }
      // labels only need to follow face appearance / disappearance
      if (options.faceIndexing) {
        const next = [...familyLabelAnchors(habit.poly).entries()].map(([family, a]) => ({ family, pos: a.pos }))
        setLabels((prev) =>
          prev.length === next.length && prev.every((l, i) => l.family === next[i].family && Math.hypot(l.pos[0] - next[i].pos[0], l.pos[1] - next[i].pos[1], l.pos[2] - next[i].pos[2]) < 0.02)
            ? prev
            : next
        )
      }
    }
  })

  return (
    <group>
      <group ref={turntable} position={[0, CRYSTAL_Y, 0]}>
        <mesh
          key={`${def.id}-${options.faceIndexing}-${gem.isNode}`}
          ref={(m) => {
            habit.attach(m, meshRef.current)
            meshRef.current = m
          }}
          castShadow
        >
          {options.faceIndexing ? <FaceIndexMaterial /> : <primitive object={gem.material} attach="material" />}
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
    // drawn first so the additive backlight lands on top of it
    <mesh geometry={geo} renderOrder={-2}>
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
  // fades to black, not to transparent: the glow is drawn opaque + additive (see Backlight)
  grad.addColorStop(0, 'rgb(230,230,230)')
  grad.addColorStop(0.35, 'rgb(89,89,89)')
  grad.addColorStop(1, 'rgb(0,0,0)')
  g.fillStyle = grad
  g.fillRect(0, 0, 128, 128)
  glowTexture = new THREE.CanvasTexture(c)
  return glowTexture
}

/** Soft glow kept behind the specimen (opposite the camera) for it to refract. */
function Backlight({ color }: { color: string }) {
  const ref = useRef<THREE.Mesh>(null)
  const tint = useMemo(() => lerpColor('#8f86c8', color, 0.35), [color])
  // the old 0.55 opacity, folded into the colour now that the glow is additive
  const tintDim = useMemo(() => new THREE.Color(tint).multiplyScalar(0.55), [tint])
  const center = useMemo(() => new THREE.Vector3(0, CRYSTAL_Y, 0), [])
  const dir = useMemo(() => new THREE.Vector3(), [])
  useFrame(({ camera }) => {
    if (!ref.current) return
    dir.copy(center).sub(camera.position).normalize()
    ref.current.position.copy(center).addScaledVector(dir, 6)
    ref.current.quaternion.copy(camera.quaternion)
  })
  return (
    <mesh ref={ref} renderOrder={-1}>
      <planeGeometry args={[11, 11]} />
      {/* opaque + additive: three's transmission pass only captures opaque objects, so a
          transparent glow would never be seen *through* the gem (it would transmit black) */}
      <meshBasicMaterial map={radialGlow()} color={tintDim} blending={THREE.AdditiveBlending} depthWrite={false} toneMapped={false} fog={false} />
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
