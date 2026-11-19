import { useEffect, useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { useSimStore } from '../stores/simStore'
import type { GemstoneDef } from '../simulation/GemstonePresets'
import type { GrowthZone } from '../simulation/CrystalGrowth'
import {
  buildLatticeModel,
  ELEMENT_STYLE,
  layerArrivalTimes,
  layerGrowthMode,
  siteDefect,
  STRUCTURES,
  zoneAtLayer,
  type Element,
  type LatticeModel,
} from '../simulation/CrystalLattice'

const S = 0.2 // world units per Å
const FADE = 0.12 // fraction of a layer-time an atom takes to "land"
const BOND_RADIUS = 0.07 // Å
const PARTICLES = 90
const Y_BASE = 0.6
/** Freshly landed atoms glow for this many layer-times, outlining the front. */
const FRESH_SPAN = 1.1
const FRESH_COLOR = new THREE.Color('#2ee6ff')

/** Complete layers to show beneath the front: ~10 Å of crystal. */
export function latticeDepth(def: GemstoneDef): number {
  const s = STRUCTURES[def.lattice]
  return Math.max(6, Math.round(10 / (s.cell.c / s.layersPerCell)))
}

interface Slots {
  base: number
  zones: GrowthZone[] | null
  count: number
  pos: Float32Array // world-scaled local positions
  radius: Float32Array // world units
  G: Int32Array
  t: Float32Array // arrival time within layer
  vacancy: Uint8Array
  vis: Float32Array
  fresh: Float32Array
  rgb: Float32Array // base colour per slot
  ghostOf: Int32Array // ghost instance → slot
  ghostCount: number
  bondA: Int32Array
  bondB: Int32Array
  bondCount: number
  bondVis: Float32Array
}

function windowCapacity(model: LatticeModel, window: number) {
  let atoms = 0
  let bonds = 0
  for (let s = 0; s < model.layersPerCell; s++) {
    let a = 0
    for (let k = 0; k < window; k++) a += model.byLayer[s + k].length
    atoms = Math.max(atoms, a)
    let b = 0
    for (const [i, j] of model.bonds) {
      const li = model.atoms[i].layer
      const lj = model.atoms[j].layer
      if (li >= s && li < s + window && lj >= s && lj < s + window) b++
    }
    bonds = Math.max(bonds, b)
  }
  return { atoms, bonds }
}

export function LatticeView({ def }: { def: GemstoneDef }) {
  const depth = latticeDepth(def)
  const window = depth + 3
  const model = useMemo(() => buildLatticeModel(def.lattice, window), [def.lattice, window])
  const cap = useMemo(() => windowCapacity(model, window), [model, window])

  const group = useRef<THREE.Group>(null)
  const atomsRef = useRef<THREE.InstancedMesh>(null)
  const bondsRef = useRef<THREE.InstancedMesh>(null)
  const ghostRef = useRef<THREE.InstancedMesh>(null)
  const particlesRef = useRef<THREE.InstancedMesh>(null)

  const slots = useRef<Slots>({
    base: Number.NaN,
    zones: null,
    count: 0,
    pos: new Float32Array(cap.atoms * 3),
    radius: new Float32Array(cap.atoms),
    G: new Int32Array(cap.atoms),
    t: new Float32Array(cap.atoms),
    vacancy: new Uint8Array(cap.atoms),
    vis: new Float32Array(cap.atoms),
    fresh: new Float32Array(cap.atoms),
    rgb: new Float32Array(cap.atoms * 3),
    ghostOf: new Int32Array(cap.atoms),
    ghostCount: 0,
    bondA: new Int32Array(cap.bonds),
    bondB: new Int32Array(cap.bonds),
    bondCount: 0,
    bondVis: new Float32Array(cap.bonds),
  })

  const particles = useMemo(() => {
    const hw = model.halfWidth * S
    const p = new Float32Array(PARTICLES * 3)
    for (let i = 0; i < PARTICLES; i++) {
      p[i * 3] = (Math.random() * 2 - 1) * hw
      p[i * 3 + 1] = Y_BASE + 0.4 + Math.random() * 3.5
      p[i * 3 + 2] = (Math.random() * 2 - 1) * hw
    }
    return p
  }, [model])

  const tmp = useMemo(
    () => ({ m: new THREE.Matrix4(), q: new THREE.Quaternion(), p: new THREE.Vector3(), s: new THREE.Vector3(), d: new THREE.Vector3(), up: new THREE.Vector3(0, 1, 0), c: new THREE.Color() }),
    []
  )

  // host element colours for solute particles
  useEffect(() => {
    const pm = particlesRef.current
    if (!pm) return
    const els = [...new Set(model.atoms.slice(0, 200).map((a) => a.el))]
    for (let i = 0; i < PARTICLES; i++) {
      tmp.c.set(ELEMENT_STYLE[els[i % els.length]].color)
      pm.setColorAt(i, tmp.c)
    }
    if (pm.instanceColor) pm.instanceColor.needsUpdate = true
  }, [model, tmp])

  const rebuild = (base: number, zones: GrowthZone[]) => {
    const st = slots.current
    const am = atomsRef.current
    if (!am) return
    const lp = model.layersPerCell
    const s = ((base % lp) + lp) % lp
    const yShift = s * model.layerSpacing
    const slotOf = new Int32Array(model.atoms.length).fill(-1)
    const dopantHost = def.dopant.replaces as Element
    const dopantEl = def.dopant.element as Element
    let n = 0
    let ghosts = 0
    for (let k = 0; k < window; k++) {
      const layer = s + k
      const G = base + k
      const zone = zoneAtLayer(zones, G)
      const ids = model.byLayer[layer]
      const xz = ids.map((i) => [model.atoms[i].pos[0], model.atoms[i].pos[2]] as [number, number])
      const times = layerArrivalTimes(layerGrowthMode(zone), xz, G, model.halfWidth)
      ids.forEach((atomIdx, j) => {
        const a = model.atoms[atomIdx]
        const defect = siteDefect(zone, G, a.key, a.el, dopantHost)
        const el = defect === 'dopant' ? dopantEl : a.el
        const style = ELEMENT_STYLE[el]
        st.pos[n * 3] = a.pos[0] * S
        st.pos[n * 3 + 1] = (a.pos[1] - yShift) * S
        st.pos[n * 3 + 2] = a.pos[2] * S
        st.radius[n] = style.radius * S
        st.G[n] = G
        st.t[n] = times[j]
        st.vacancy[n] = defect === 'vacancy' ? 1 : 0
        st.vis[n] = -1 // force matrix write
        st.fresh[n] = -1 // force colour write
        if (defect === 'vacancy') st.ghostOf[ghosts++] = n
        tmp.c.set(style.color)
        st.rgb.set([tmp.c.r, tmp.c.g, tmp.c.b], n * 3)
        am.setColorAt(n, tmp.c)
        slotOf[atomIdx] = n
        n++
      })
    }
    st.count = n
    st.ghostCount = ghosts
    let b = 0
    for (const [i, j] of model.bonds) {
      const si = slotOf[i]
      const sj = slotOf[j]
      if (si < 0 || sj < 0) continue
      st.bondA[b] = si
      st.bondB[b] = sj
      st.bondVis[b] = -1
      b++
    }
    st.bondCount = b
    st.base = base
    st.zones = zones
    am.count = n
    if (am.instanceColor) am.instanceColor.needsUpdate = true
    if (bondsRef.current) bondsRef.current.count = b
    if (ghostRef.current) ghostRef.current.count = ghosts
  }

  useFrame((_, dt) => {
    const { crystal } = useSimStore.getState()
    const F = crystal.layerFront
    const base = Math.floor(F) - depth
    const st = slots.current
    if (base !== st.base || crystal.zones !== st.zones) rebuild(base, crystal.zones)
    const am = atomsRef.current
    const bm = bondsRef.current
    const gm = ghostRef.current
    if (!am || !bm || !gm) return

    // slide the slab down continuously so the growing layer stays near Y_BASE
    if (group.current) group.current.position.y = (base - F) * model.layerSpacing * S + Y_BASE

    // atoms: write matrices only where visibility changed
    const arr = am.instanceMatrix.array as Float32Array
    let atomsDirty = false
    let colorsDirty = false
    for (let i = 0; i < st.count; i++) {
      const age = F - st.G[i] - st.t[i]
      const fresh = age > 0 && age < FRESH_SPAN ? Math.round((1 - age / FRESH_SPAN) * 20) / 20 : 0
      if (fresh !== st.fresh[i]) {
        st.fresh[i] = fresh
        tmp.c.setRGB(st.rgb[i * 3], st.rgb[i * 3 + 1], st.rgb[i * 3 + 2]).lerp(FRESH_COLOR, fresh * 0.85)
        am.setColorAt(i, tmp.c)
        colorsDirty = true
      }
      const v = st.vacancy[i] ? 0 : Math.min(1, Math.max(0, age / FADE))
      if (v === st.vis[i]) continue
      st.vis[i] = v
      const r = st.radius[i] * v
      const o = i * 16
      arr[o] = r; arr[o + 1] = 0; arr[o + 2] = 0; arr[o + 3] = 0
      arr[o + 4] = 0; arr[o + 5] = r; arr[o + 6] = 0; arr[o + 7] = 0
      arr[o + 8] = 0; arr[o + 9] = 0; arr[o + 10] = r; arr[o + 11] = 0
      arr[o + 12] = st.pos[i * 3]; arr[o + 13] = st.pos[i * 3 + 1]; arr[o + 14] = st.pos[i * 3 + 2]; arr[o + 15] = 1
      atomsDirty = true
    }
    if (atomsDirty) am.instanceMatrix.needsUpdate = true
    if (colorsDirty && am.instanceColor) am.instanceColor.needsUpdate = true

    // bonds appear once both ends have landed
    let bondsDirty = false
    for (let b = 0; b < st.bondCount; b++) {
      const ia = st.bondA[b]
      const ib = st.bondB[b]
      const v = Math.min(st.vis[ia], st.vis[ib])
      if (v === st.bondVis[b]) continue
      st.bondVis[b] = v
      tmp.p.set((st.pos[ia * 3] + st.pos[ib * 3]) / 2, (st.pos[ia * 3 + 1] + st.pos[ib * 3 + 1]) / 2, (st.pos[ia * 3 + 2] + st.pos[ib * 3 + 2]) / 2)
      tmp.d.set(st.pos[ib * 3] - st.pos[ia * 3], st.pos[ib * 3 + 1] - st.pos[ia * 3 + 1], st.pos[ib * 3 + 2] - st.pos[ia * 3 + 2])
      const length = tmp.d.length()
      tmp.q.setFromUnitVectors(tmp.up, tmp.d.normalize())
      tmp.s.set(BOND_RADIUS * S * v, length * (v > 0 ? 1 : 0), BOND_RADIUS * S * v)
      tmp.m.compose(tmp.p, tmp.q, tmp.s)
      bm.setMatrixAt(b, tmp.m)
      bondsDirty = true
    }
    if (bondsDirty) bm.instanceMatrix.needsUpdate = true

    // vacancy markers show once their layer has filled in around them
    for (let g = 0; g < st.ghostCount; g++) {
      const i = st.ghostOf[g]
      const v = Math.min(1, Math.max(0, (F - st.G[i] - st.t[i]) / FADE))
      tmp.m.makeScale(st.radius[i] * v, st.radius[i] * v, st.radius[i] * v)
      tmp.m.setPosition(st.pos[i * 3], st.pos[i * 3 + 1], st.pos[i * 3 + 2])
      gm.setMatrixAt(g, tmp.m)
    }
    gm.instanceMatrix.needsUpdate = true

    // solute growth units drifting to (or away from) the surface
    const pm = particlesRef.current
    if (pm) {
      const hw = model.halfWidth * S
      const dir = crystal.velocity >= 0 ? -1 : 1
      const speed = 0.25 + Math.min(1.5, Math.abs(crystal.radialRate) * 3)
      const active = Math.abs(crystal.velocity) > 1e-5
      for (let i = 0; i < PARTICLES; i++) {
        let y = particles[i * 3 + 1] + (active ? dir * speed * dt : 0)
        particles[i * 3] += (Math.random() - 0.5) * dt * 0.6
        particles[i * 3 + 2] += (Math.random() - 0.5) * dt * 0.6
        if (y < Y_BASE + 0.25) y = Y_BASE + 3.9
        if (y > Y_BASE + 4) y = Y_BASE + 0.3
        particles[i * 3 + 1] = y
        const x = Math.max(-hw, Math.min(hw, particles[i * 3]))
        const z = Math.max(-hw, Math.min(hw, particles[i * 3 + 2]))
        const fade = Math.min(1, (y - Y_BASE - 0.25) / 0.6) * Math.min(1, (Y_BASE + 4 - y) / 0.6)
        tmp.m.makeScale(0.06 * fade, 0.06 * fade, 0.06 * fade)
        tmp.m.setPosition(x, y, z)
        pm.setMatrixAt(i, tmp.m)
      }
      pm.instanceMatrix.needsUpdate = true
    }
  })

  return (
    <group>
      <group ref={group}>
        <instancedMesh ref={atomsRef} args={[undefined, undefined, cap.atoms]} frustumCulled={false}>
          <sphereGeometry args={[1, 14, 10]} />
          <meshStandardMaterial roughness={0.35} metalness={0.1} />
        </instancedMesh>
        <instancedMesh ref={bondsRef} args={[undefined, undefined, Math.max(1, cap.bonds)]} frustumCulled={false}>
          <cylinderGeometry args={[1, 1, 1, 6]} />
          <meshStandardMaterial color="#8d98a6" roughness={0.6} />
        </instancedMesh>
        <instancedMesh ref={ghostRef} args={[undefined, undefined, cap.atoms]} frustumCulled={false}>
          <icosahedronGeometry args={[1, 1]} />
          <meshBasicMaterial color="#ff5577" wireframe transparent opacity={0.8} />
        </instancedMesh>
      </group>
      <instancedMesh ref={particlesRef} args={[undefined, undefined, PARTICLES]} frustumCulled={false}>
        <sphereGeometry args={[1, 8, 6]} />
        <meshStandardMaterial emissive="#334455" roughness={0.5} transparent opacity={0.7} />
      </instancedMesh>
      {/* growth medium boundary */}
      <mesh position={[0, Y_BASE + 2.2, 0]}>
        <boxGeometry args={[model.halfWidth * 2 * S + 0.3, 4, model.halfWidth * 2 * S + 0.3]} />
        <meshBasicMaterial color="#5a8cff" transparent opacity={0.035} depthWrite={false} side={THREE.BackSide} />
      </mesh>
    </group>
  )
}
