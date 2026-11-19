import { useFrame } from '@react-three/fiber'
import { useSimStore } from '../stores/simStore'

/**
 * Drives the Zustand tick loop once per frame, independent of which viewer is
 * mounted, so plant and gem simulations share one clock. Long frames (e.g.
 * after a background tab resumes) are clamped to keep the integrators stable.
 */
export function SimClock() {
  const tick = useSimStore((s) => s.tick)
  useFrame((_, dt) => {
    tick(Math.min(dt, 0.1))
  })
  return null
}
