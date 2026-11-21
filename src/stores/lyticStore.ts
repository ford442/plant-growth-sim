import { create } from 'zustand'
import { advanceSteps, FIXED_STEP_CLOCKS } from '../simulation/parasite/fixedStep'
import {
  createLytic,
  DEFAULT_LYTIC_FLAGS,
  lyticSettled,
  stepLytic,
  type LyticFlags,
  type LyticState,
} from '../simulation/parasite/lytic/sandbox'
import { useTimeStore } from './timeStore'

/**
 * The single-cell lytic sandbox (parasite mode, "Lytic" view). A sibling of
 * `parasiteStore`, not part of it: it is its own experiment with its own seed,
 * and while it is showing the world sim is held still (see `SimClock`).
 *
 * Same fixed-step clock as the world (`advanceSteps`), so a seed replays
 * identically on any frame rate.
 */
export interface LyticStoreState {
  lytic: LyticState
  flags: LyticFlags
  seed: number
  accumulator: number
  /** The sandbox view is mounted, so `SimClock` should tick this store. */
  active: boolean

  tick: (dt: number) => void
  setActive: (active: boolean) => void
  /** Replay the same seed. */
  replay: () => void
  /** Fresh seed. */
  reroll: () => void
  setFlag: (key: keyof LyticFlags, value: boolean) => void
}

const INITIAL_SEED = 42

export const useLyticStore = create<LyticStoreState>((set, get) => ({
  lytic: createLytic(INITIAL_SEED, DEFAULT_LYTIC_FLAGS),
  flags: DEFAULT_LYTIC_FLAGS,
  seed: INITIAL_SEED,
  accumulator: 0,
  active: false,

  tick: (dt) => {
    const { isPlaying, speed } = useTimeStore.getState()
    if (!isPlaying) return
    const { lytic, accumulator } = get()
    if (lyticSettled(lytic)) return
    const r = advanceSteps(lytic, (s) => stepLytic(s, FIXED_STEP_CLOCKS), accumulator, dt, speed, lyticSettled)
    if (r.steps === 0) {
      if (r.accumulator !== accumulator) set({ accumulator: r.accumulator })
      return
    }
    set({ lytic: r.state, accumulator: r.accumulator })
  },

  setActive: (active) => set({ active }),

  replay: () => {
    useTimeStore.getState().play()
    const { seed, flags } = get()
    set({ lytic: createLytic(seed, flags), accumulator: 0 })
  },

  reroll: () => {
    useTimeStore.getState().play()
    const seed = (Math.random() * 2 ** 31) >>> 0 || 1
    set({ seed, lytic: createLytic(seed, get().flags), accumulator: 0 })
  },

  // a flag changes the experiment, so it restarts the run on the same seed
  setFlag: (key, value) => {
    useTimeStore.getState().play()
    const flags = { ...get().flags, [key]: value }
    set({ flags, lytic: createLytic(get().seed, flags), accumulator: 0 })
  },
}))
