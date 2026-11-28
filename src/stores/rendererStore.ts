import { create } from 'zustand'
import type { ActiveRenderer, RendererBackend } from '../rendering/createRenderer'
import { parseRendererPreference, withRendererPreference } from '../rendering/rendererPreference'

/**
 * Renderer choice for the UI. `preference` is what the user asked for;
 * `active` is what the mounted Canvas actually got (null while there is none),
 * reported by <RendererLifecycle/>. Not part of `simStore`: it is view
 * plumbing, not simulation state.
 */
export interface RendererState {
  preference: RendererBackend
  active: ActiveRenderer | null
  setPreference: (p: RendererBackend) => void
  setActive: (a: ActiveRenderer | null) => void
}

function initialPreference(): RendererBackend {
  return typeof window === 'undefined' ? 'webgl' : parseRendererPreference(window.location.search)
}

export const useRendererStore = create<RendererState>((set) => ({
  preference: initialPreference(),
  active: null,
  setPreference: (preference) => {
    // keep the URL in step so a reload (or a shared link) lands on the same renderer
    if (typeof window !== 'undefined') {
      const { pathname, search, hash } = window.location
      window.history.replaceState(null, '', `${pathname}${withRendererPreference(search, preference)}${hash}`)
    }
    set({ preference })
  },
  setActive: (active) => set({ active }),
}))
