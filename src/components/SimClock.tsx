import { useEffect } from 'react'
import { startSimClock } from '../stores/clockDriver'

/**
 * Mounts the shared simulation clock. Render it **outside** `<Canvas>`: the
 * canvas remounts on GPU loss or a backend switch and may not exist at all, and
 * the clock must not stop or fork when it does. All the work is in
 * `stores/clockDriver.ts` (one reference-counted requestAnimationFrame loop);
 * views only read the stores, they never tick them.
 */
export function SimClock() {
  useEffect(() => startSimClock(), [])
  return null
}
