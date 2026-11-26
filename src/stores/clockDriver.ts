import { clampFrame } from '../simulation/clock'
import { useLyticStore } from './lyticStore'
import { useModeStore } from './modeStore'
import { useParasiteStore } from './parasiteStore'
import { useSimStore } from './simStore'

/**
 * The one thing that turns wall-clock time into simulation ticks.
 *
 * It lives outside the R3F `<Canvas>`: a canvas can remount (GPU loss, backend
 * switch) or be absent entirely, and the clock must neither fork nor stop when
 * it does. `startSimClock` is reference-counted, so however many components ask
 * for it (StrictMode mounts twice, a future second canvas) exactly one
 * `requestAnimationFrame` loop runs.
 *
 * Each frame's real `dt` goes to the stores, which clamp it, accumulate it and
 * run fixed steps (`simulation/clock.ts`). Play / pause / speed stay in
 * `timeStore`; a paused sim simply gets steps of zero while the views keep
 * rendering.
 */

/**
 * Advance every simulation by one frame of real time.
 *
 * The plant/gem store always ticks. The parasite store only ticks while its mode
 * is showing, so an idle agent swarm costs nothing; while the single-cell lytic
 * sandbox is showing it ticks *instead of* the parasite world (an objective
 * resolving off-screen would otherwise pause the shared clock under it).
 */
export function tickSimulations(dtSeconds: number): void {
  useSimStore.getState().tick(dtSeconds)
  if (useModeStore.getState().mode !== 'parasite') return
  // the parasite stores run their own fixed step (`parasite/fixedStep.ts`), sized for
  // a frame of at most MAX_FRAME_SECONDS — give them the same clamped frame
  const clamped = clampFrame(dtSeconds)
  if (useLyticStore.getState().active) useLyticStore.getState().tick(clamped)
  else useParasiteStore.getState().tick(clamped)
}

/** The bits of the browser the driver needs, injectable so it can be tested without one. */
export interface ClockEnv {
  requestFrame: (cb: (nowMs: number) => void) => number
  cancelFrame: (handle: number) => void
}

const browserEnv = (): ClockEnv => ({
  requestFrame: (cb) => requestAnimationFrame(cb),
  cancelFrame: (h) => cancelAnimationFrame(h),
})

let users = 0
let handle = 0
let env: ClockEnv | null = null
let lastMs: number | null = null

function frame(nowMs: number): void {
  if (!env) return
  handle = env.requestFrame(frame)
  // the first frame after (re)starting has no predecessor; a backgrounded tab's
  // first frame back has a huge one — `tick` clamps it
  const dt = lastMs === null ? 0 : (nowMs - lastMs) / 1000
  lastMs = nowMs
  tickSimulations(dt)
}

/** Number of components currently holding the clock (for tests / diagnostics). */
export const clockUsers = (): number => users

/**
 * Start (or join) the shared clock. Returns a function that releases it; the
 * loop stops when the last holder lets go.
 */
export function startSimClock(clockEnv: ClockEnv = browserEnv()): () => void {
  if (users === 0) {
    env = clockEnv
    lastMs = null
    handle = clockEnv.requestFrame(frame)
  }
  users++
  let released = false
  return () => {
    if (released) return
    released = true
    users--
    if (users === 0 && env) {
      env.cancelFrame(handle)
      env = null
      lastMs = null
    }
  }
}
