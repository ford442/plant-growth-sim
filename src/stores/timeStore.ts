import { create } from 'zustand'

/**
 * Shared simulation clock controls. Every mode (plant, gem, parasite) reads
 * play/pause and speed from here so there is exactly one clock; each mode's
 * own store keeps its integrator math and only consumes `days` per tick.
 */
export interface TimeState {
  isPlaying: boolean
  speed: number // simulation days per real second
  play: () => void
  pause: () => void
  toggle: () => void
  setSpeed: (s: number) => void
}

export const useTimeStore = create<TimeState>((set) => ({
  isPlaying: true,
  speed: 0.5,
  play: () => set({ isPlaying: true }),
  pause: () => set({ isPlaying: false }),
  toggle: () => set((s) => ({ isPlaying: !s.isPlaying })),
  setSpeed: (speed) => set({ speed }),
}))
