import { useFrame } from '@react-three/fiber'
import { useSimStore } from '../stores/simStore'
import { useModeStore } from '../stores/modeStore'
import { useParasiteStore } from '../stores/parasiteStore'

/**
 * Drives the Zustand tick loops once per frame, independent of which viewer is
 * mounted, so every mode shares one clock. Long frames (e.g. after a background
 * tab resumes) are clamped to keep the integrators stable.
 *
 * The plant/gem store always ticks — that loop is untouched. The parasite store
 * only ticks while its mode is showing, so an idle agent swarm costs nothing.
 */
export function SimClock() {
  const tick = useSimStore((s) => s.tick)
  const tickParasite = useParasiteStore((s) => s.tick)
  useFrame((_, dt) => {
    const clamped = Math.min(dt, 0.1)
    tick(clamped)
    if (useModeStore.getState().mode === 'parasite') tickParasite(clamped)
  })
  return null
}
