import { useFrame } from '@react-three/fiber'
import { useSimStore } from '../stores/simStore'
import { useModeStore } from '../stores/modeStore'
import { useParasiteStore } from '../stores/parasiteStore'
import { useLyticStore } from '../stores/lyticStore'

/**
 * Drives the Zustand tick loops once per frame, independent of which viewer is
 * mounted, so every mode shares one clock. Long frames (e.g. after a background
 * tab resumes) are clamped to keep the integrators stable.
 *
 * The plant/gem store always ticks — that loop is untouched. The parasite store
 * only ticks while its mode is showing, so an idle agent swarm costs nothing.
 * While the single-cell lytic sandbox is showing, it ticks *instead of* the
 * parasite world: the sandbox is a separate experiment, and an objective
 * resolving off-screen would otherwise pause the shared clock under it.
 */
export function SimClock() {
  const tick = useSimStore((s) => s.tick)
  const tickParasite = useParasiteStore((s) => s.tick)
  const tickLytic = useLyticStore((s) => s.tick)
  useFrame((_, dt) => {
    const clamped = Math.min(dt, 0.1)
    tick(clamped)
    if (useModeStore.getState().mode !== 'parasite') return
    if (useLyticStore.getState().active) tickLytic(clamped)
    else tickParasite(clamped)
  })
  return null
}
