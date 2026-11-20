import { useEffect, useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { useSimStore } from '../../stores/simStore'
import { cambialResponse, ringProfile, stemMetrics, type TissueState } from '../../simulation/TissueGrowth'
import { DISC_X, LENS_LEFT, LENS_HEIGHT, LENS_X, discRadius, zoomBox } from './geometry'
import { paintDisc } from './paintDisc'
import { HEX } from './palette'

const TEXTURE_SIZE = 640
/** The disc is repainted at most this often (s) — rings only change at cell timescales. */
const REPAINT_EVERY = 0.1

/**
 * The whole stem cross-section, like a slice cut from a stump. It is one painted
 * texture on a disc whose radius follows the stem, so it grows as wood is added;
 * the white box at 3 o'clock is the strip the cell lens magnifies.
 */
export function StemDisc() {
  const group = useRef<THREE.Group>(null)
  const guide = useRef<THREE.BufferGeometry>(null)

  const canvas = useMemo(() => {
    const el = document.createElement('canvas')
    el.width = TEXTURE_SIZE
    el.height = TEXTURE_SIZE
    return el
  }, [])
  const texture = useMemo(() => {
    const t = new THREE.CanvasTexture(canvas)
    t.colorSpace = THREE.SRGBColorSpace
    t.anisotropy = 4
    return t
  }, [canvas])
  useEffect(() => () => texture.dispose(), [texture])

  const painted = useRef<{ tissue: TissueState | null; at: number }>({ tissue: null, at: -1 })

  useFrame((state) => {
    const { tissue, weather, waterStatus } = useSimStore.getState()
    const profile = ringProfile(tissue)
    const m = stemMetrics(tissue, profile)
    const R = discRadius(m.stemRadius)
    group.current?.scale.setScalar(R)

    // Zoom guides: from the strip's outer corners on the disc to the lens' inner corners.
    const box = zoomBox(m)
    const kWorld = R / m.stemRadius
    const bx = DISC_X + box.x1 * kWorld
    const bh = box.halfH * kWorld
    const g = guide.current
    if (g) {
      const p = g.getAttribute('position') as THREE.BufferAttribute
      const lx = LENS_X - LENS_LEFT
      const lh = LENS_HEIGHT / 2
      p.setXYZ(0, bx, bh, 0)
      p.setXYZ(1, lx, lh, 0)
      p.setXYZ(2, bx, -bh, 0)
      p.setXYZ(3, lx, -lh, 0)
      p.needsUpdate = true
    }

    const p = painted.current
    if ((p.tissue !== tissue && state.clock.elapsedTime - p.at > REPAINT_EVERY) || p.at < 0) {
      const ctx = canvas.getContext('2d')
      if (ctx) {
        const { activity } = cambialResponse({
          temperature: weather.temperature,
          light: weather.light,
          water: waterStatus,
        })
        paintDisc(ctx, TEXTURE_SIZE, profile, m, box, activity)
        texture.needsUpdate = true
      }
      p.tissue = tissue
      p.at = state.clock.elapsedTime
    }
  })

  return (
    <>
      <group ref={group} position={[DISC_X, 0, 0]}>
        {/* painted top face */}
        <mesh position={[0, 0, 0.08]}>
          <circleGeometry args={[1, 96]} />
          <meshBasicMaterial map={texture} transparent toneMapped={false} />
        </mesh>
        {/* cut edge of the slice */}
        <mesh rotation={[Math.PI / 2, 0, 0]}>
          <cylinderGeometry args={[1, 1, 0.16, 96, 1, true]} />
          <meshStandardMaterial color={HEX.bark} roughness={0.95} side={THREE.DoubleSide} />
        </mesh>
      </group>

      <lineSegments frustumCulled={false}>
        <bufferGeometry ref={guide}>
          <bufferAttribute attach="attributes-position" args={[new Float32Array(12), 3]} />
        </bufferGeometry>
        <lineBasicMaterial color="#e9f5e4" transparent opacity={0.45} toneMapped={false} />
      </lineSegments>
    </>
  )
}
