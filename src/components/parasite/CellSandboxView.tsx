/**
 * Single-cell lytic sandbox: one tachyzoite, one host cell, one full loop.
 *
 * Reads `useLyticStore.getState().lytic` every frame (never subscribes to
 * per-tick values) and poses meshes from it. Everything is in micrometres; the
 * parent group scales it into world units. Nothing here feeds back into the
 * sim.
 *
 *  - dish: the substrate the parasite glides on (it cannot swim)
 *  - host: translucent dome with a nucleus; distends round the growing PV and
 *    fades once TgPLP1 has breached it
 *  - tachyzoite: the 6 × 2 µm crescent with its conoid at the apex (detached
 *    and drifting under RNG2 loss); a trail shows the helical glide
 *  - moving junction: a torus fixed on the host membrane whose radius follows
 *    the body's cross-section where it passes the ring, closing at the
 *    posterior as the PV seals
 *  - rosette + daughter buds during endodyogeny, PLP1 pores during egress,
 *    released daughters after lysis
 */

import { useEffect, useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { useLyticStore } from '../../stores/lyticStore'
import { STAGE_DEFS } from '../../simulation/parasite/stages'
import { PORES_TO_RUPTURE, PV_PH_PERMISSIVE, PV_PH_RESTING } from '../../simulation/parasite/egress'
import { HOST_HEIGHT, HOST_RADIUS, SANDBOX_CAPACITY, type LyticState } from '../../simulation/parasite/lytic/sandbox'
import { budProgress, pvRadius, rosettePose } from '../../simulation/parasite/lytic/rosette'
import {
  BODY_LENGTH,
  BODY_WIDTH,
  CONOID_DIAMETER,
  CONOID_LENGTH,
  HALF_LENGTH,
} from '../../simulation/parasite/lytic/substrateGlide'
import { bodyRadius, crescentGeometry, hideInstance, orientInstance } from './bodyGeometry'

const BEND = 0.12
const TRAIL_POINTS = 900
const BUD_CAP = SANDBOX_CAPACITY
const Y = new THREE.Vector3(0, 1, 0)

/** Vacuole radius for the current state (smooth through each round). */
function currentPvRadius(s: LyticState): number {
  const pv = s.pv
  if (!pv) return 0
  return pvRadius(pv.parasites * 2 ** pv.division)
}

/** Body roll during the glide, so the crescent's bow turns with the helix. */
function rollUp(heading: THREE.Vector3, twist: number, out: THREE.Vector3): THREE.Vector3 {
  const side = new THREE.Vector3().crossVectors(heading, Y).normalize()
  return out.copy(Y).multiplyScalar(Math.cos(twist)).addScaledVector(side, Math.sin(twist))
}

export function CellSandboxView() {
  const setActive = useLyticStore((s) => s.setActive)
  useEffect(() => {
    setActive(true)
    return () => setActive(false)
  }, [setActive])

  const body = useMemo(() => crescentGeometry({ length: BODY_LENGTH, width: BODY_WIDTH, bend: BEND }), [])
  useEffect(() => () => body.dispose(), [body])

  const host = useRef<THREE.Mesh>(null)
  const nucleus = useRef<THREE.Mesh>(null)
  const pvShell = useRef<THREE.Mesh>(null)
  const zoite = useRef<THREE.Group>(null)
  const conoid = useRef<THREE.Mesh>(null)
  const ring = useRef<THREE.Mesh>(null)
  const rosette = useRef<THREE.InstancedMesh>(null)
  const buds = useRef<THREE.InstancedMesh>(null)
  const pores = useRef<THREE.InstancedMesh>(null)
  const released = useRef<THREE.InstancedMesh>(null)
  const trail = useRef<THREE.Line>(null)

  const tmp = useMemo(
    () => ({
      m: new THREE.Matrix4(),
      v: new THREE.Vector3(),
      h: new THREE.Vector3(),
      up: new THREE.Vector3(),
      x: new THREE.Vector3(),
      q: new THREE.Quaternion(),
      c: new THREE.Color(),
      hot: new THREE.Color('#ff8a4c'),
      cool: new THREE.Color('#7fe8d4'),
    }),
    [],
  )
  const trailState = useRef({ count: 0, key: '' })
  const trailGeometry = useMemo(() => {
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(TRAIL_POINTS * 3), 3))
    g.setDrawRange(0, 0)
    return g
  }, [])
  useEffect(() => () => trailGeometry.dispose(), [trailGeometry])
  // a plain THREE.Line: JSX <line> collides with the SVG element type
  const trailLine = useMemo(() => new THREE.Line(), [])

  useFrame(() => {
    const s = useLyticStore.getState().lytic
    const { m, v, h, up, x, q, c } = tmp
    const pvR = currentPvRadius(s)

    // --- host dome: distends over the vacuole, fades after rupture ----------
    const dome = Math.max(HOST_HEIGHT, s.pv ? s.pv.center.y + pvR + 1.2 : 0)
    if (host.current) {
      host.current.scale.set(HOST_RADIUS, dome, HOST_RADIUS)
      const mat = host.current.material as THREE.MeshPhysicalMaterial
      const inflamed = s.phase === 'trapped' ? (s.pv?.egress.inflammation ?? 0) : 0
      mat.color.set('#4b7f8c').lerp(tmp.hot, Math.min(1, inflamed * 4))
      mat.opacity = 0.2 * (1 - 0.85 * s.lysis)
      host.current.visible = s.lysis < 1 || mat.opacity > 0.01
    }
    if (nucleus.current) {
      // the vacuole settles on the entry side, the nucleus sits across from it
      const side = s.inward ? v.set(s.inward.x, 0, s.inward.z) : v.set(1, 0, 0)
      nucleus.current.position.set(side.x * 7, 2.6, side.z * 7)
      nucleus.current.scale.set(5.5, 2.4, 5)
      ;(nucleus.current.material as THREE.MeshStandardMaterial).opacity = 0.55 * (1 - s.lysis)
    }

    // --- vacuole --------------------------------------------------------------
    if (pvShell.current) {
      pvShell.current.visible = !!s.pv && s.phase !== 'lysed'
      if (s.pv) {
        pvShell.current.position.set(s.pv.center.x, s.pv.center.y, s.pv.center.z)
        pvShell.current.scale.setScalar(pvR)
        const mat = pvShell.current.material as THREE.MeshPhysicalMaterial
        // acidification reads as the vacuole turning hot
        const acid = Math.min(1, (PV_PH_RESTING - s.pv.egress.ph) / (PV_PH_RESTING - PV_PH_PERMISSIVE))
        mat.color.copy(tmp.cool).lerp(tmp.hot, acid)
        mat.emissive.copy(mat.color)
        mat.emissiveIntensity = 0.08 + 0.5 * acid + 0.6 * s.pv.egress.calcium * acid
      }
    }

    // --- the single invading tachyzoite --------------------------------------
    const single = s.phase !== 'replicate' && s.phase !== 'egress' && s.phase !== 'lysed' && s.phase !== 'trapped'
    if (zoite.current) {
      zoite.current.visible = single
      if (single) {
        const z = s.zoite
        h.set(z.heading.x, z.heading.y, z.heading.z).normalize()
        if (s.phase === 'glide' || s.phase === 'stalled') rollUp(h, z.twist, up)
        else up.copy(Y)
        orientInstance(m, z.pos, h, up, 1)
        // through the junction: shift by the bow so the fixed ring stays on the
        // body's centre line where it crosses
        if (s.phase === 'invade' && s.mj?.phase === 'penetrating') {
          x.setFromMatrixColumn(m, 0)
          const amp = BEND * BODY_LENGTH * Math.sin(Math.PI * s.mj.progress)
          m.setPosition(v.setFromMatrixPosition(m).addScaledVector(x, -amp))
        }
        zoite.current.matrixAutoUpdate = false
        zoite.current.matrix.copy(m)
      }
    }
    if (conoid.current) {
      // RNG2 tethers the conoid to the apical polar ring; without it it drifts off
      const loose = !s.zoite.conoid
      const t = loose ? Math.min(1, s.actionSeconds / 6) : 0
      conoid.current.position.set(0.35 * t, 0.2 * t, HALF_LENGTH + CONOID_LENGTH * 0.4 + 0.5 * t)
      conoid.current.rotation.set(Math.PI / 2 + 0.7 * t, 0, 0.4 * t)
      ;(conoid.current.material as THREE.MeshStandardMaterial).emissiveIntensity = loose ? 0.3 : 1.4
    }

    // --- moving junction ring -------------------------------------------------
    if (ring.current) {
      const mj = s.mj
      const shown =
        !!mj && !!s.entry && !!s.inward && (mj.phase === 'rhoptryNeck' || mj.phase === 'junction' || mj.phase === 'penetrating')
      ring.current.visible = shown
      if (shown && mj && s.entry && s.inward) {
        // position along the body that is passing the ring right now
        const along = mj.phase === 'penetrating' ? mj.progress : 0.06
        const width = bodyRadius(Math.min(0.999, along), BODY_WIDTH / 2)
        const forming = mj.phase === 'rhoptryNeck' ? 0.4 + 0.6 * mj.ron2 : 1
        const r = Math.max(0.02, (width + 0.06) * forming)
        q.setFromUnitVectors(v.set(0, 0, 1), h.set(s.inward.x, s.inward.y, s.inward.z))
        ring.current.position.set(s.entry.x, s.entry.y, s.entry.z)
        ring.current.quaternion.copy(q)
        ring.current.scale.set(r, r, 1)
        ;(ring.current.material as THREE.MeshStandardMaterial).opacity = mj.phase === 'rhoptryNeck' ? 0.5 : 0.95
      }
    }

    // --- rosette and daughter buds -------------------------------------------
    const pv = s.pv
    const showRosette = !!pv && (s.phase === 'replicate' || s.phase === 'egress' || s.phase === 'trapped')
    if (rosette.current && buds.current) {
      const n = showRosette && pv ? pv.parasites : 0
      const division = pv && s.phase === 'replicate' ? pv.division : 1
      const bud = s.phase === 'replicate' ? budProgress(division) : 0
      let b = 0
      for (let i = 0; i < SANDBOX_CAPACITY; i++) {
        if (i >= n || !pv) {
          rosette.current.setMatrixAt(i, hideInstance(m))
          continue
        }
        const pose = rosettePose(n, i, division, pv.axis)
        v.set(pv.center.x + pose.offset.x, pv.center.y + pose.offset.y, pv.center.z + pose.offset.z)
        h.set(pose.heading.x, pose.heading.y, pose.heading.z)
        orientInstance(m, v, h, Y, 1)
        rosette.current.setMatrixAt(i, m)
        c.set(STAGE_DEFS.tachyzoite.color)
        rosette.current.setColorAt(i, c)
        // endodyogeny: two daughter buds assemble inside each mother
        if (bud > 0 && b + 1 < BUD_CAP * 2) {
          x.setFromMatrixColumn(m, 0)
          for (const side of [-1, 1]) {
            const p = v.clone().addScaledVector(x, side * 0.42).addScaledVector(h, 0.4 * (1 - bud))
            orientInstance(m, p, h, Y, 0.25 + 0.6 * bud)
            buds.current.setMatrixAt(b++, m)
          }
        }
      }
      for (let i = b; i < BUD_CAP * 2; i++) buds.current.setMatrixAt(i, hideInstance(m))
      rosette.current.instanceMatrix.needsUpdate = true
      if (rosette.current.instanceColor) rosette.current.instanceColor.needsUpdate = true
      buds.current.instanceMatrix.needsUpdate = true
      ;(rosette.current.material as THREE.MeshStandardMaterial).opacity = bud > 0 ? 1 - 0.55 * bud : 1
    }

    // --- TgPLP1 pores ---------------------------------------------------------
    if (pores.current) {
      const count = pv && s.phase === 'egress' ? Math.min(PORES_TO_RUPTURE, Math.floor(pv.egress.pores)) : 0
      for (let i = 0; i < PORES_TO_RUPTURE; i++) {
        if (i >= count || !pv) {
          pores.current.setMatrixAt(i, hideInstance(m))
          continue
        }
        // Fibonacci sphere: evenly spread over the vacuole membrane
        const y = 1 - (2 * (i + 0.5)) / PORES_TO_RUPTURE
        const rr = Math.sqrt(1 - y * y)
        const a = i * 2.399963
        h.set(Math.cos(a) * rr, y, Math.sin(a) * rr)
        v.set(pv.center.x, pv.center.y, pv.center.z).addScaledVector(h, pvR)
        orientInstance(m, v, h, Y, 1)
        pores.current.setMatrixAt(i, m)
      }
      pores.current.instanceMatrix.needsUpdate = true
    }

    // --- released daughters ---------------------------------------------------
    if (released.current) {
      for (let i = 0; i < SANDBOX_CAPACITY; i++) {
        const d = s.released[i]
        if (!d) {
          released.current.setMatrixAt(i, hideInstance(m))
          continue
        }
        h.set(d.heading.x, d.heading.y, d.heading.z)
        orientInstance(m, d.pos, h, Y, 1)
        released.current.setMatrixAt(i, m)
      }
      released.current.instanceMatrix.needsUpdate = true
    }

    // --- glide trail ----------------------------------------------------------
    const key = `${s.seed}:${s.flags.deltaPlp1}:${s.flags.rng2Loss}`
    const ts = trailState.current
    if (ts.key !== key || s.actionSeconds === 0) {
      ts.key = key
      ts.count = 0
    }
    if (s.phase === 'glide' && s.zoite.contact && ts.count < TRAIL_POINTS) {
      const arr = trailGeometry.attributes.position.array as Float32Array
      const last = ts.count - 1
      const p = s.zoite.pos
      const far = last < 0 || Math.hypot(arr[last * 3] - p.x, arr[last * 3 + 2] - p.z) > 0.08
      if (far) {
        arr[ts.count * 3] = p.x
        arr[ts.count * 3 + 1] = 0.05
        arr[ts.count * 3 + 2] = p.z
        ts.count++
        trailGeometry.attributes.position.needsUpdate = true
      }
    }
    trailGeometry.setDrawRange(0, ts.count)
    if (trail.current) trail.current.visible = ts.count > 1
  })

  return (
    <group userData={{ noExport: true }}>
      {/* the dish: gliding only happens on a surface */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.02, 0]}>
        <circleGeometry args={[62, 64]} />
        <meshStandardMaterial color="#0b1a1f" roughness={0.9} />
      </mesh>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0, 0]}>
        <ringGeometry args={[HOST_RADIUS + 0.2, HOST_RADIUS + 0.7, 96]} />
        <meshBasicMaterial color="#1f4a52" transparent opacity={0.6} />
      </mesh>

      <mesh ref={host}>
        <sphereGeometry args={[1, 56, 24, 0, Math.PI * 2, 0, Math.PI / 2]} />
        <meshPhysicalMaterial
          transparent
          opacity={0.2}
          roughness={0.35}
          transmission={0.4}
          thickness={2}
          depthWrite={false}
          side={THREE.DoubleSide}
        />
      </mesh>
      <mesh ref={nucleus}>
        <sphereGeometry args={[1, 28, 18]} />
        <meshStandardMaterial color="#35506b" roughness={0.7} transparent opacity={0.55} depthWrite={false} />
      </mesh>
      <mesh ref={pvShell}>
        <sphereGeometry args={[1, 40, 26]} />
        <meshPhysicalMaterial
          transparent
          opacity={0.22}
          roughness={0.25}
          transmission={0.6}
          thickness={1.5}
          depthWrite={false}
          side={THREE.DoubleSide}
        />
      </mesh>

      <group ref={zoite}>
        <mesh geometry={body}>
          <meshStandardMaterial color={STAGE_DEFS.tachyzoite.color} roughness={0.4} emissive="#2fae9a" emissiveIntensity={0.35} />
        </mesh>
        <mesh ref={conoid}>
          <coneGeometry args={[CONOID_DIAMETER / 2, CONOID_LENGTH, 14, 1, true]} />
          <meshStandardMaterial color="#fff6c8" emissive="#ffd166" emissiveIntensity={1.4} side={THREE.DoubleSide} />
        </mesh>
      </group>

      <mesh ref={ring}>
        <torusGeometry args={[1, 0.09, 10, 40]} />
        <meshStandardMaterial color="#ffe08a" emissive="#ffb703" emissiveIntensity={1.8} transparent opacity={0.95} />
      </mesh>

      <instancedMesh ref={rosette} args={[body, undefined, SANDBOX_CAPACITY]} frustumCulled={false}>
        <meshStandardMaterial roughness={0.4} emissive="#2fae9a" emissiveIntensity={0.3} transparent />
      </instancedMesh>
      <instancedMesh ref={buds} args={[body, undefined, BUD_CAP * 2]} frustumCulled={false}>
        <meshStandardMaterial color="#c4fff3" roughness={0.35} emissive="#5eead4" emissiveIntensity={0.8} />
      </instancedMesh>
      <instancedMesh ref={pores} args={[undefined, undefined, PORES_TO_RUPTURE]} frustumCulled={false}>
        <torusGeometry args={[0.45, 0.15, 6, 12]} />
        <meshStandardMaterial color="#ffb199" emissive="#ff5a2b" emissiveIntensity={1.6} />
      </instancedMesh>
      <instancedMesh ref={released} args={[body, undefined, SANDBOX_CAPACITY]} frustumCulled={false}>
        <meshStandardMaterial color={STAGE_DEFS.tachyzoite.color} roughness={0.4} emissive="#2fae9a" emissiveIntensity={0.45} />
      </instancedMesh>

      <primitive
        object={trailLine}
        ref={trail}
        geometry={trailGeometry}
        frustumCulled={false}
      >
        <lineBasicMaterial color="#5eead4" transparent opacity={0.45} />
      </primitive>
    </group>
  )
}
