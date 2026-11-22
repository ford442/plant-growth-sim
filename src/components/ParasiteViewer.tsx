/**
 * Multi-scale viewer for parasite mode.
 *
 * Follows the same contract as the plant and gem viewers: nothing is stored
 * here, every frame reads the pure world out of `useParasiteStore.getState()`
 * and writes instance matrices. Scene coordinates are micrometres, scaled into
 * world units per view so one camera envelope covers all four scales.
 */

import { useEffect, useMemo, useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import * as THREE from 'three'
import { useParasiteStore } from '../stores/parasiteStore'
import { NICHE_DEFS } from '../simulation/parasite/hostImmunity'
import { STAGE_DEFS, type AgentStage } from '../simulation/parasite/stages'
import { tractionForce } from '../simulation/parasite/glideosome'
import {
  MAX_AGENTS,
  MAX_CYSTS,
  MAX_OOCYSTS,
  TISSUE_RADIUS,
  type Agent,
  type HostCell,
  type ParasiteWorld,
} from '../simulation/parasite/world'
import { crescentGeometry, hideInstance, orientInstance } from './parasite/bodyGeometry'
import { OrganelleView } from './parasite/OrganelleView'
import { CellSandboxView } from './parasite/CellSandboxView'
import { TissueSliceView } from './parasite/TissueSliceView'

export type ParasiteViewScale = 'environment' | 'tissue' | 'slice' | 'cell' | 'organelle' | 'sandbox'

/** World units per micrometre, per view. */
const UNIT: Record<ParasiteViewScale, number> = {
  environment: 0.075,
  tissue: 0.105,
  // 1 µm = 0.05 units: a 15 µm host cell is 0.75 units, a 70 µm cyst 3.5, a 7 µm bradyzoite 0.35
  slice: 0.05,
  cell: 0.17,
  organelle: 1,
  sandbox: 0.12,
}

export const PARASITE_VIEW_TARGET: Record<ParasiteViewScale, [number, number, number]> = {
  environment: [0, 0, 0],
  tissue: [0, 0, 0],
  slice: [0, 0, 0],
  cell: [0, 0, 0],
  organelle: [0, 0, 0],
  sandbox: [0, 0, 0],
}

/**
 * Camera distance per view. The four scales span four orders of magnitude of
 * subject size, so the shared camera has to be re-framed when the player moves
 * between them — otherwise the tissue view opens up inside a host cell.
 */
const VIEW_DISTANCE: Record<ParasiteViewScale, number> = {
  environment: 11,
  tissue: 15.5,
  // ~330 µm of tissue across the view: a handful of cyst plots, the zoom wheel does the rest
  slice: 20,
  cell: 9,
  organelle: 9.5,
  sandbox: 10.5,
}

/**
 * Where the camera sits for each view. The organelle view is framed from the
 * side, because the body's long axis runs along Z and an end-on camera would
 * foreshorten the very anatomy the view exists to show.
 */
const VIEW_DIRECTION: Record<ParasiteViewScale, [number, number, number]> = {
  environment: [0.15, 0.55, 1],
  tissue: [0.15, 0.4, 1],
  // from well above, so the section reads as a plane and the cysts as domes standing in it
  slice: [0.2, 0.85, 0.55],
  cell: [0.15, 0.4, 1],
  organelle: [1, 0.3, 0.42],
  // looking down onto the dish, so the glide trail and the host dome both read
  sandbox: [0.2, 0.85, 0.75],
}

/**
 * Frames the shared camera for the current parasite view, and puts it back
 * where it found it on unmount so plant and gem modes are unaffected.
 */
export function ParasiteCameraRig({ scale }: { scale: ParasiteViewScale }) {
  const camera = useThree((s) => s.camera) as THREE.PerspectiveCamera
  const controls = useThree((s) => s.controls) as { target: THREE.Vector3; update: () => void } | null
  const entry = useRef<{ position: THREE.Vector3; near: number; far: number } | null>(null)

  useEffect(() => {
    if (!entry.current) {
      entry.current = { position: camera.position.clone(), near: camera.near, far: camera.far }
    }
    return () => {
      const e = entry.current
      if (!e) return
      camera.position.copy(e.position)
      camera.near = e.near
      camera.far = e.far
      camera.updateProjectionMatrix()
    }
  }, [camera])

  useEffect(() => {
    const direction = new THREE.Vector3(...VIEW_DIRECTION[scale]).normalize()
    camera.position.copy(direction.multiplyScalar(VIEW_DISTANCE[scale]))
    camera.near = 0.05
    camera.far = 300
    camera.updateProjectionMatrix()
    controls?.target.set(0, 0, 0)
    controls?.update()
  }, [scale, camera, controls])

  return null
}

const AGENT_ORDER: AgentStage[] = ['tachyzoite', 'bradyzoite', 'sporozoite', 'merozoite']

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

/** Evenly spread directions on a sphere — used for rosette and cyst packing. */
function fibonacciDirection(i: number, n: number, out: THREE.Vector3): THREE.Vector3 {
  const y = n === 1 ? 0 : 1 - (i / (n - 1)) * 2
  const r = Math.sqrt(Math.max(0, 1 - y * y))
  const theta = i * 2.399963229728653
  return out.set(Math.cos(theta) * r, y, Math.sin(theta) * r)
}

function useAgentGeometries() {
  const geometries = useMemo(() => {
    const out = {} as Record<AgentStage, THREE.BufferGeometry>
    for (const stage of AGENT_ORDER) {
      const def = STAGE_DEFS[stage]
      out[stage] = crescentGeometry({
        length: def.length,
        width: def.width,
        // bradyzoites are the more strongly curved of the two (research §2.2)
        bend: stage === 'bradyzoite' ? 0.19 : 0.14,
        radialSegments: 10,
        lengthSegments: 18,
      })
    }
    return out
  }, [])
  useEffect(() => () => Object.values(geometries).forEach((g) => g.dispose()), [geometries])
  return geometries
}

/** Instanced swarm of zoites, grouped by stage so each gets its own mesh. */
function AgentSwarm({ capacity = MAX_AGENTS, filter }: { capacity?: number; filter?: (a: Agent) => boolean }) {
  const geometries = useAgentGeometries()
  const meshes = useRef<Partial<Record<AgentStage, THREE.InstancedMesh | null>>>({})
  const matrix = useMemo(() => new THREE.Matrix4(), [])
  const color = useMemo(() => new THREE.Color(), [])

  useFrame(() => {
    const { world } = useParasiteStore.getState()
    const agents = filter ? world.agents.filter(filter) : world.agents
    for (const stage of AGENT_ORDER) {
      const mesh = meshes.current[stage]
      if (!mesh) continue
      const mine = agents.filter((a) => a.stage === stage)
      const n = Math.min(mine.length, capacity)
      for (let i = 0; i < capacity; i++) {
        if (i < n) {
          const a = mine[i]
          orientInstance(matrix, a.glide.pos, a.glide.heading, a.glide.up)
          mesh.setMatrixAt(i, matrix)
          color.set(STAGE_DEFS[stage].color)
          // a slipping parasite reads as washed out; one in the junction glows
          if (a.glide.slipping) color.lerp(new THREE.Color('#4a5560'), 0.55)
          if (a.mj) color.lerp(new THREE.Color('#ffffff'), 0.35)
          mesh.setColorAt(i, color)
        } else {
          mesh.setMatrixAt(i, hideInstance(matrix))
        }
      }
      mesh.instanceMatrix.needsUpdate = true
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true
    }
  })

  return (
    <>
      {AGENT_ORDER.map((stage) => (
        <instancedMesh
          key={stage}
          ref={(m) => {
            meshes.current[stage] = m
          }}
          args={[geometries[stage], undefined, capacity]}
          frustumCulled={false}
        >
          <meshStandardMaterial
            roughness={0.42}
            metalness={0.08}
            emissive={STAGE_DEFS[stage].color}
            emissiveIntensity={0.22}
          />
        </instancedMesh>
      ))}
    </>
  )
}

/**
 * The annular constriction: a ring that travels apex→posterior on every
 * traction cycle and tightens as the parasite pulls itself through it. This is
 * the visible signature of gliding being a pinch rather than a push.
 */
function TractionRings({ capacity = MAX_AGENTS }: { capacity?: number }) {
  const mesh = useRef<THREE.InstancedMesh>(null)
  const matrix = useMemo(() => new THREE.Matrix4(), [])
  const position = useMemo(() => new THREE.Vector3(), [])

  useFrame(() => {
    const m = mesh.current
    if (!m) return
    const { world } = useParasiteStore.getState()
    for (let i = 0; i < capacity; i++) {
      const a = world.agents[i]
      const force = a && !a.mj ? tractionForce(a.glide) : 0
      if (!a || force < 0.05) {
        m.setMatrixAt(i, hideInstance(matrix))
        continue
      }
      const def = STAGE_DEFS[a.stage]
      const offset = (0.5 - a.glide.ringS) * def.length
      position
        .set(a.glide.heading.x, a.glide.heading.y, a.glide.heading.z)
        .multiplyScalar(offset)
        .add(new THREE.Vector3(a.glide.pos.x, a.glide.pos.y, a.glide.pos.z))
      orientInstance(matrix, position, a.glide.heading, a.glide.up, 0.6 + 0.5 * force)
      m.setMatrixAt(i, matrix)
    }
    m.instanceMatrix.needsUpdate = true
  })

  return (
    <instancedMesh ref={mesh} args={[undefined, undefined, capacity]} frustumCulled={false}>
      <torusGeometry args={[1.35, 0.16, 6, 20]} />
      <meshStandardMaterial color="#9bf6e4" emissive="#45d6bb" emissiveIntensity={1.1} transparent opacity={0.65} />
    </instancedMesh>
  )
}

/** The AMA1–RON2 ring, drawn where a parasite is crossing into a host cell. */
function JunctionRings({ capacity = MAX_AGENTS }: { capacity?: number }) {
  const mesh = useRef<THREE.InstancedMesh>(null)
  const matrix = useMemo(() => new THREE.Matrix4(), [])
  const position = useMemo(() => new THREE.Vector3(), [])
  const normal = useMemo(() => new THREE.Vector3(), [])
  const up = useMemo(() => new THREE.Vector3(0, 1, 0), [])

  useFrame(() => {
    const m = mesh.current
    if (!m) return
    const { world } = useParasiteStore.getState()
    const invading = world.agents.filter(
      (a) => a.mj && (a.mj.phase === 'junction' || a.mj.phase === 'penetrating' || a.mj.phase === 'rhoptryNeck'),
    )
    for (let i = 0; i < capacity; i++) {
      const a = invading[i]
      const cell = a ? world.cells.find((c) => c.id === a.mj!.cellId) : undefined
      if (!a || !cell) {
        m.setMatrixAt(i, hideInstance(matrix))
        continue
      }
      normal
        .set(a.glide.pos.x - cell.pos.x, a.glide.pos.y - cell.pos.y, a.glide.pos.z - cell.pos.z)
        .normalize()
      position.copy(normal).multiplyScalar(cell.radius).add(new THREE.Vector3(cell.pos.x, cell.pos.y, cell.pos.z))
      // the ring constricts around the parasite as it is drawn through
      const tighten = 0.55 + 0.45 * a.mj!.ringFraction
      orientInstance(matrix, position, normal, up, tighten)
      m.setMatrixAt(i, matrix)
    }
    m.instanceMatrix.needsUpdate = true
  })

  return (
    <instancedMesh ref={mesh} args={[undefined, undefined, capacity]} frustumCulled={false}>
      <torusGeometry args={[1.7, 0.3, 8, 26]} />
      <meshStandardMaterial color="#ffd98a" emissive="#ff9d3c" emissiveIntensity={1.4} transparent opacity={0.85} />
    </instancedMesh>
  )
}

/** Host cells, coloured by tissue niche and dimmed once lysed. */
function HostCells({ cells }: { cells: number }) {
  const body = useRef<THREE.InstancedMesh>(null)
  const matrix = useMemo(() => new THREE.Matrix4(), [])
  const color = useMemo(() => new THREE.Color(), [])
  const identityUp = useMemo(() => new THREE.Vector3(0, 1, 0), [])
  const forward = useMemo(() => new THREE.Vector3(0, 0, 1), [])

  useFrame(() => {
    const m = body.current
    if (!m) return
    const { world } = useParasiteStore.getState()
    for (let i = 0; i < cells; i++) {
      const c = world.cells[i]
      if (!c) {
        m.setMatrixAt(i, hideInstance(matrix))
        continue
      }
      const swell = c.pv ? 1 + 0.05 * Math.cbrt(c.pv.parasites) : 1
      orientInstance(matrix, c.pos, forward, identityUp, c.radius * swell)
      m.setMatrixAt(i, matrix)
      color.set(NICHE_DEFS[c.niche].color)
      if (c.state === 'lysed') color.lerp(new THREE.Color('#141a1f'), 0.75)
      else if (c.pv) color.lerp(new THREE.Color(c.pv.converting ? '#a78bfa' : '#ffffff'), 0.4)
      m.setColorAt(i, color)
    }
    m.instanceMatrix.needsUpdate = true
    if (m.instanceColor) m.instanceColor.needsUpdate = true
  })

  return (
    <instancedMesh ref={body} args={[undefined, undefined, cells]} frustumCulled={false}>
      <sphereGeometry args={[1, 20, 14]} />
      <meshPhysicalMaterial
        transparent
        opacity={0.16}
        roughness={0.5}
        transmission={0.4}
        thickness={2}
        depthWrite={false}
        side={THREE.DoubleSide}
      />
    </instancedMesh>
  )
}

/** Parasites inside vacuoles, laid out as rosettes. */
function VacuoleContents({ perCell = 6 }: { perCell?: number }) {
  const geometries = useAgentGeometries()
  const mesh = useRef<THREE.InstancedMesh>(null)
  const matrix = useMemo(() => new THREE.Matrix4(), [])
  const color = useMemo(() => new THREE.Color(), [])
  const dir = useMemo(() => new THREE.Vector3(), [])
  const pos = useMemo(() => new THREE.Vector3(), [])
  const up = useMemo(() => new THREE.Vector3(0, 1, 0), [])
  const capacity = 28 * perCell

  useFrame(() => {
    const m = mesh.current
    if (!m) return
    const { world } = useParasiteStore.getState()
    let k = 0
    for (const cell of world.cells) {
      if (!cell.pv || cell.state === 'lysed') continue
      const n = Math.min(cell.pv.parasites, perCell)
      const ring = cell.radius * 0.45
      for (let i = 0; i < n && k < capacity; i++, k++) {
        fibonacciDirection(i, Math.max(2, n), dir)
        pos.copy(dir).multiplyScalar(ring).add(new THREE.Vector3(cell.pos.x, cell.pos.y, cell.pos.z))
        // rosettes point their apical ends outward
        orientInstance(matrix, pos, dir, up, 0.75)
        m.setMatrixAt(k, matrix)
        color.set(cell.pv.converting ? STAGE_DEFS.bradyzoite.color : STAGE_DEFS.tachyzoite.color)
        m.setColorAt(k, color)
      }
    }
    for (let i = k; i < capacity; i++) m.setMatrixAt(i, hideInstance(matrix))
    m.instanceMatrix.needsUpdate = true
    if (m.instanceColor) m.instanceColor.needsUpdate = true
  })

  return (
    <instancedMesh ref={mesh} args={[geometries.tachyzoite, undefined, capacity]} frustumCulled={false}>
      <meshStandardMaterial roughness={0.4} emissive="#2fae9a" emissiveIntensity={0.3} />
    </instancedMesh>
  )
}

/** Tissue cysts: 5 → 70 µm spheres with a thin glycosylated wall. */
function Cysts({ capacity = MAX_CYSTS }: { capacity?: number }) {
  const inner = useRef<THREE.InstancedMesh>(null)
  const wall = useRef<THREE.InstancedMesh>(null)
  const matrix = useMemo(() => new THREE.Matrix4(), [])
  const color = useMemo(() => new THREE.Color(), [])
  const up = useMemo(() => new THREE.Vector3(0, 1, 0), [])
  const forward = useMemo(() => new THREE.Vector3(0, 0, 1), [])

  useFrame(() => {
    const a = inner.current
    const b = wall.current
    if (!a || !b) return
    const { world } = useParasiteStore.getState()
    const live = world.cysts.filter((c) => c.intact)
    for (let i = 0; i < capacity; i++) {
      const c = live[i]
      if (!c) {
        a.setMatrixAt(i, hideInstance(matrix))
        b.setMatrixAt(i, hideInstance(matrix))
        continue
      }
      const r = c.diameter / 2
      orientInstance(matrix, c.pos, forward, up, r)
      a.setMatrixAt(i, matrix)
      // the wall is <0.5 µm, so it is drawn as a thin shell just outside
      orientInstance(matrix, c.pos, forward, up, r + c.wall)
      b.setMatrixAt(i, matrix)
      color.set(NICHE_DEFS[c.niche].color).lerp(new THREE.Color(STAGE_DEFS.bradyzoite.color), 0.55)
      a.setColorAt(i, color)
    }
    a.instanceMatrix.needsUpdate = true
    b.instanceMatrix.needsUpdate = true
    if (a.instanceColor) a.instanceColor.needsUpdate = true
  })

  return (
    <>
      <instancedMesh ref={inner} args={[undefined, undefined, capacity]} frustumCulled={false}>
        <sphereGeometry args={[1, 20, 14]} />
        <meshStandardMaterial roughness={0.55} emissive="#4c2f7a" emissiveIntensity={0.3} transparent opacity={0.72} />
      </instancedMesh>
      <instancedMesh ref={wall} args={[undefined, undefined, capacity]} frustumCulled={false}>
        <sphereGeometry args={[1, 20, 14]} />
        <meshStandardMaterial
          color="#e9d8ff"
          transparent
          opacity={0.18}
          side={THREE.BackSide}
          depthWrite={false}
        />
      </instancedMesh>
    </>
  )
}

// ---------------------------------------------------------------------------
// Scenes
// ---------------------------------------------------------------------------

function TissueScene() {
  return (
    <group scale={UNIT.tissue}>
      {/* tissue boundary, for a sense of the simulated volume */}
      <mesh>
        <sphereGeometry args={[TISSUE_RADIUS, 32, 20]} />
        <meshBasicMaterial color="#13303a" wireframe transparent opacity={0.1} />
      </mesh>
      <HostCells cells={28} />
      <VacuoleContents perCell={6} />
      <Cysts />
      <AgentSwarm filter={(a) => !a.mj || a.mj.phase !== 'vacuoleSealed'} />
      <TractionRings />
      <JunctionRings />
    </group>
  )
}

/**
 * Single-cell view: the vacuole that matters right now, blown up, with the
 * rosette, the junction and the egress cascade visible.
 */
function CellScene() {
  const geometries = useAgentGeometries()
  const host = useRef<THREE.Mesh>(null)
  const pvShell = useRef<THREE.Mesh>(null)
  const nucleus = useRef<THREE.Mesh>(null)
  const rosette = useRef<THREE.InstancedMesh>(null)
  const pores = useRef<THREE.InstancedMesh>(null)
  const matrix = useMemo(() => new THREE.Matrix4(), [])
  const color = useMemo(() => new THREE.Color(), [])
  const dir = useMemo(() => new THREE.Vector3(), [])
  const pos = useMemo(() => new THREE.Vector3(), [])
  const up = useMemo(() => new THREE.Vector3(0, 1, 0), [])
  const ROSETTE_CAP = 64
  const PORE_CAP = 32

  useFrame(() => {
    const { world } = useParasiteStore.getState()
    const cell = focusCell(world)
    const pv = cell?.pv ?? null
    const parasites = pv?.parasites ?? 0

    // A vacuole holding 64 zoites genuinely distends its host cell, so both the
    // vacuole and the cell are sized from the contents rather than drawn at
    // their resting size. The floor keeps a single 6 µm tachyzoite inside its
    // own vacuole instead of poking through it.
    const halfLength = STAGE_DEFS.tachyzoite.length / 2
    const pvRadius = parasites > 0 ? Math.max(halfLength * 1.25, 3.4 * Math.cbrt(parasites) + 2.5) : 0
    const cellRadius = Math.max(cell?.radius ?? 7.5, pvRadius + 2.4)

    if (host.current) {
      host.current.scale.setScalar(cellRadius)
      const mat = host.current.material as THREE.MeshPhysicalMaterial
      mat.color.set(cell ? NICHE_DEFS[cell.niche].color : '#2a3b45')
      mat.opacity = cell?.state === 'lysed' ? 0.05 : 0.14
    }
    if (nucleus.current) {
      nucleus.current.visible = !!cell && cell.state !== 'lysed'
      nucleus.current.position.set(cellRadius * 0.45, cellRadius * 0.3, -cellRadius * 0.3)
      nucleus.current.scale.setScalar(cellRadius * 0.3)
    }
    if (pvShell.current) {
      pvShell.current.visible = pvRadius > 0
      pvShell.current.scale.setScalar(Math.max(0.001, pvRadius))
      const mat = pvShell.current.material as THREE.MeshPhysicalMaterial
      // acidification reads as the vacuole turning hot
      const acid = pv ? Math.min(1, (7.2 - pv.egress.ph) / 1.4) : 0
      mat.color.set(pv?.converting ? '#a78bfa' : '#7fe8d4').lerp(new THREE.Color('#ff8a4c'), acid)
      mat.emissiveIntensity = 0.1 + 0.6 * acid
      mat.emissive.set(mat.color)
    }

    if (rosette.current) {
      const n = Math.min(parasites, ROSETTE_CAP)
      for (let i = 0; i < ROSETTE_CAP; i++) {
        if (i >= n) {
          rosette.current.setMatrixAt(i, hideInstance(matrix))
          continue
        }
        fibonacciDirection(i, Math.max(2, n), dir)
        // Zoites sit radially with their apical ends outward, so the shell
        // radius is set by where the tips land, not by a fraction of the PV.
        // Past one full shell a real rosette packs inward in layers.
        const layer = n > 24 ? 1 - 0.28 * ((i % 3) / 2) : 1
        const shellRadius = n === 1 ? 0 : Math.max(0, pvRadius - halfLength * 1.05) * layer
        pos.copy(dir).multiplyScalar(shellRadius)
        orientInstance(matrix, pos, dir, up, 1)
        rosette.current.setMatrixAt(i, matrix)
        color.set(pv?.converting ? STAGE_DEFS.bradyzoite.color : STAGE_DEFS.tachyzoite.color)
        rosette.current.setColorAt(i, color)
      }
      rosette.current.instanceMatrix.needsUpdate = true
      if (rosette.current.instanceColor) rosette.current.instanceColor.needsUpdate = true
    }

    // TgPLP1 pores: hexameric rings punched through the membranes
    if (pores.current) {
      const count = pv ? Math.min(PORE_CAP, Math.floor(pv.egress.pores)) : 0
      for (let i = 0; i < PORE_CAP; i++) {
        if (i >= count) {
          pores.current.setMatrixAt(i, hideInstance(matrix))
          continue
        }
        fibonacciDirection(i, PORE_CAP, dir)
        pos.copy(dir).multiplyScalar(pvRadius)
        orientInstance(matrix, pos, dir, up, 1)
        pores.current.setMatrixAt(i, matrix)
      }
      pores.current.instanceMatrix.needsUpdate = true
    }
  })

  return (
    <group scale={UNIT.cell}>
      <mesh ref={host}>
        <sphereGeometry args={[1, 40, 28]} />
        <meshPhysicalMaterial
          transparent
          opacity={0.14}
          roughness={0.4}
          transmission={0.5}
          thickness={3}
          depthWrite={false}
          side={THREE.DoubleSide}
        />
      </mesh>
      <mesh ref={nucleus}>
        <sphereGeometry args={[1, 24, 16]} />
        <meshStandardMaterial color="#35506b" roughness={0.7} transparent opacity={0.5} />
      </mesh>
      <mesh ref={pvShell}>
        <sphereGeometry args={[1, 36, 24]} />
        <meshPhysicalMaterial
          transparent
          opacity={0.2}
          roughness={0.25}
          transmission={0.7}
          thickness={1.5}
          depthWrite={false}
          side={THREE.DoubleSide}
        />
      </mesh>
      <instancedMesh ref={rosette} args={[geometries.tachyzoite, undefined, 64]} frustumCulled={false}>
        <meshStandardMaterial roughness={0.4} emissive="#2fae9a" emissiveIntensity={0.3} />
      </instancedMesh>
      <instancedMesh ref={pores} args={[undefined, undefined, 32]} frustumCulled={false}>
        <torusGeometry args={[0.5, 0.17, 6, 12]} />
        <meshStandardMaterial color="#ffb199" emissive="#ff5a2b" emissiveIntensity={1.6} />
      </instancedMesh>
    </group>
  )
}

/** The cell the player most likely wants to watch. */
function focusCell(world: ParasiteWorld): HostCell | null {
  let best: HostCell | null = null
  for (const c of world.cells) {
    if (!c.pv) continue
    if (!best || c.pv.parasites > (best.pv?.parasites ?? 0)) best = c
  }
  return best ?? world.cells.find((c) => c.state !== 'lysed') ?? world.cells[0] ?? null
}

/** Soil and water: the oocyst field, where nothing moves and nothing breathes. */
function EnvironmentScene() {
  const body = useRef<THREE.InstancedMesh>(null)
  const sporocysts = useRef<THREE.InstancedMesh>(null)
  const matrix = useMemo(() => new THREE.Matrix4(), [])
  const color = useMemo(() => new THREE.Color(), [])
  const pos = useMemo(() => new THREE.Vector3(), [])
  const scaleV = useMemo(() => new THREE.Vector3(), [])
  const quat = useMemo(() => new THREE.Quaternion(), [])
  const euler = useMemo(() => new THREE.Euler(), [])
  const SPORO_CAP = MAX_OOCYSTS * 2

  useFrame(() => {
    const m = body.current
    const s = sporocysts.current
    if (!m || !s) return
    const { world } = useParasiteStore.getState()

    for (let i = 0; i < MAX_OOCYSTS; i++) {
      const o = world.oocysts[i]
      if (!o) {
        m.setMatrixAt(i, hideInstance(matrix))
        continue
      }
      // 11 × 13 µm subspherical: slightly prolate
      euler.set(o.spin * 0.6, o.spin, 0)
      quat.setFromEuler(euler)
      pos.set(o.pos.x, o.pos.y, o.pos.z)
      scaleV.set(5.5, 5.5, 6.5)
      m.setMatrixAt(i, matrix.compose(pos, quat, scaleV))
      color
        .set(o.sporulated ? STAGE_DEFS.sporulatedOocyst.color : STAGE_DEFS.unsporulatedOocyst.color)
        // weathering bleaches them out before they vanish
        .lerp(new THREE.Color('#2b2f33'), 1 - o.viability)
      m.setColorAt(i, color)
    }
    m.instanceMatrix.needsUpdate = true
    if (m.instanceColor) m.instanceColor.needsUpdate = true

    // two sporocysts per sporulated oocyst (each holding four sporozoites)
    let k = 0
    for (const o of world.oocysts) {
      if (!o.sporulated) continue
      for (let j = 0; j < 2 && k < SPORO_CAP; j++, k++) {
        euler.set(o.spin * 0.6, o.spin, 0)
        quat.setFromEuler(euler)
        const offset = (j === 0 ? -1 : 1) * 2.6
        pos.set(o.pos.x, o.pos.y, o.pos.z + offset)
        scaleV.set(3, 3, 4)
        s.setMatrixAt(k, matrix.compose(pos, quat, scaleV))
      }
    }
    for (let i = k; i < SPORO_CAP; i++) s.setMatrixAt(i, hideInstance(matrix))
    s.instanceMatrix.needsUpdate = true
  })

  return (
    <group scale={UNIT.environment}>
      {/* soil surface */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -8, 0]} receiveShadow>
        <circleGeometry args={[62, 48]} />
        <meshStandardMaterial color="#3a2e21" roughness={0.95} />
      </mesh>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -7.9, 0]}>
        <ringGeometry args={[56, 62, 64]} />
        <meshBasicMaterial color="#51402c" transparent opacity={0.6} />
      </mesh>
      <instancedMesh ref={body} args={[undefined, undefined, MAX_OOCYSTS]} frustumCulled={false}>
        <sphereGeometry args={[1, 18, 14]} />
        <meshPhysicalMaterial roughness={0.35} transmission={0.5} thickness={4} transparent opacity={0.9} />
      </instancedMesh>
      <instancedMesh ref={sporocysts} args={[undefined, undefined, SPORO_CAP]} frustumCulled={false}>
        <sphereGeometry args={[1, 14, 10]} />
        <meshStandardMaterial color="#fff0c2" emissive="#c08a28" emissiveIntensity={0.35} roughness={0.5} />
      </instancedMesh>
    </group>
  )
}

/** Dark-field microscopy lighting, kept apart from the plant/gem rigs. */
export function ParasiteLights() {
  return (
    <>
      <ambientLight intensity={0.3} />
      <hemisphereLight args={['#3ad1c0', '#100a18', 0.35]} />
      <directionalLight position={[6, 10, 8]} intensity={0.9} color="#cdfff5" />
      <pointLight position={[-10, -6, -8]} intensity={60} color="#7c4dff" distance={60} />
      <pointLight position={[9, 4, -10]} intensity={45} color="#ff6ea9" distance={60} />
    </>
  )
}

export function ParasiteViewer({ scale }: { scale: ParasiteViewScale }) {
  // During the environmental phase the host-side arrays still hold the previous
  // host's cells. Drawing them would contradict the "there is no host" hint, so
  // the tissue-side scenes stay unmounted until a host exists again.
  const inHost = useParasiteStore((s) => s.world.compartment !== 'environment')
  return (
    <group>
      {scale === 'tissue' && inHost && <TissueScene />}
      {scale === 'slice' && inHost && (
        <group scale={UNIT.slice}>
          <TissueSliceView />
        </group>
      )}
      {scale === 'cell' && inHost && <CellScene />}
      {scale === 'environment' && <EnvironmentScene />}
      {/* the lytic sandbox is its own experiment: it does not need a host in the world */}
      {scale === 'sandbox' && (
        <group scale={UNIT.sandbox}>
          <CellSandboxView />
        </group>
      )}
      {scale === 'organelle' && (
        <group scale={UNIT.organelle}>
          <OrganelleView />
        </group>
      )}
    </group>
  )
}
