import { create } from 'zustand'

/**
 * Which simulation the shell is showing. `gem` stays because gem mode is a
 * working simulation in this repo; `parasite` is the placeholder for epic #3.
 */
export type SimMode = 'plant' | 'gem' | 'parasite'

export interface ModeState {
  mode: SimMode
  setMode: (m: SimMode) => void
}

export const useModeStore = create<ModeState>((set) => ({
  mode: 'plant',
  setMode: (mode) => set({ mode }),
}))
