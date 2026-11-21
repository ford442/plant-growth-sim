/**
 * Fixed-step driver for the parasite world.
 *
 * The browser hands the store a different `dt` every frame (60 Hz, 144 Hz, a
 * slow phone, a tab that just woke up). If `stepWorld` were called once per
 * frame with that `dt`, the same seed would give a different run on every
 * machine, and a golden test or a replay could not exist. Instead the store
 * *accumulates* real time and this module spends it in identical steps, so a
 * run is a pure function of (seed, config, number of steps).
 *
 * One step is {@link FIXED_STEP_SECONDS} of 1× play — **in both gears**
 * (docs/design/parasite-mode.md §3): 0.015 lesion hours and ≈0.067 action
 * seconds. The speed slider changes how *many* steps run per real second, never
 * how big each one is.
 *
 * Why 1/60 s and not the 0.25 sim-hour the original issue suggested: the views
 * read `world` straight off the store every frame with no interpolation, so a
 * 0.25 h step (≈ 0.28 s of play at 1×) would move every parasite ~3.6 times a
 * second. A step this small is also the regime the whole sim was tuned in, and
 * costs ≈ 0.04 ms (p99 ≈ 0.2 ms) even with the scene full. To change it, change
 * `FIXED_STEP_SECONDS`: nothing else depends on its value, and the golden test
 * will (rightly) need re-recording.
 */

import { advanceClocks, REFERENCE_SPEED, type Clocks } from './stages'
import { stepWorld, type ParasiteConfig, type ParasiteWorld } from './world'

/** Real seconds of 1× play per step. */
export const FIXED_STEP_SECONDS = 1 / 60

/** The two-gear clocks of one step. Constant: every step is identical. */
export const FIXED_STEP_CLOCKS: Readonly<Clocks> = Object.freeze(
  advanceClocks(FIXED_STEP_SECONDS, REFERENCE_SPEED),
)

/**
 * Most steps one frame may run. `SimClock` clamps a frame to 0.1 s and the
 * speed slider tops out at 6×, so the longest *legal* frame owes 36 steps; 48
 * leaves headroom. Past the cap the excess is dropped, not queued: a slow
 * device plays in slow motion instead of falling ever further behind.
 */
export const MAX_STEPS_PER_FRAME = 48

export interface FixedStepResult {
  world: ParasiteWorld
  /** Part of a step still owed, in [0, 1). Pass it back in next frame. */
  accumulator: number
  /** Steps actually run this frame. */
  steps: number
  /** Whole steps discarded because the frame owed more than the cap. */
  dropped: number
}

/** A finite, non-negative number, else 0. Keeps NaN out of the accumulator. */
const finiteOrZero = (x: number) => (x > 0 && Number.isFinite(x) ? x : 0)

/**
 * Spend `dtSeconds` of real time (at the shared `speed`, in plant days per
 * second) as whole fixed steps.
 *
 * Pure: returns a new world and leaves the one it was given alone. When
 * `stopAfter` is supplied it is called with the world after every step, and a
 * `true` ends the frame there — which is how the store lands a win or a loss on
 * the same step whatever the frame rate.
 */
export function advanceFixed(
  world: ParasiteWorld,
  cfg: ParasiteConfig,
  accumulator: number,
  dtSeconds: number,
  speed: number,
  stopAfter?: (world: ParasiteWorld) => boolean,
): FixedStepResult {
  const r = advanceSteps(world, (w) => stepWorld(w, cfg, FIXED_STEP_CLOCKS), accumulator, dtSeconds, speed, stopAfter)
  return { world: r.state, accumulator: r.accumulator, steps: r.steps, dropped: r.dropped }
}

export interface StepsResult<T> {
  state: T
  accumulator: number
  steps: number
  dropped: number
}

/**
 * The fixed-step budget for any pure, step-at-a-time sim on the parasite clock
 * (the world, the lytic sandbox): same step size, same per-frame cap, same
 * remainder handling. `step` must be pure and always advance by
 * {@link FIXED_STEP_CLOCKS}.
 */
export function advanceSteps<T>(
  state: T,
  step: (state: T) => T,
  accumulator: number,
  dtSeconds: number,
  speed: number,
  stopAfter?: (state: T) => boolean,
): StepsResult<T> {
  const dt = finiteOrZero(dtSeconds)
  const k = finiteOrZero(speed) / REFERENCE_SPEED
  const owed = accumulator + (dt * k) / FIXED_STEP_SECONDS

  let whole = Math.floor(owed)
  const remainder = owed - whole
  let dropped = 0
  if (whole > MAX_STEPS_PER_FRAME) {
    dropped = whole - MAX_STEPS_PER_FRAME
    whole = MAX_STEPS_PER_FRAME
  }

  let s = state
  let steps = 0
  while (steps < whole) {
    s = step(s)
    steps++
    if (stopAfter?.(s)) break
  }
  return { state: s, accumulator: remainder, steps, dropped }
}
