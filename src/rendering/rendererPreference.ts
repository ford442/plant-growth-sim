import type { SimMode } from '../stores/modeStore'
import type { RendererBackend } from './createRenderer'

/**
 * Which renderer a mode gets. Pure, so the rules are unit-tested without a GPU.
 *
 * The user's *preference* (`?renderer=webgpu`, or the toggle in the plant
 * sidebar) is only honoured by modes whose whole scene is node/TSL-compatible.
 * Everything else keeps the classic `WebGLRenderer`, so opting in can never
 * break a mode that has not been ported.
 */

/** URL query key: `?renderer=webgpu` opts in, anything else is the WebGL default. */
export const RENDERER_PARAM = 'renderer'

/**
 * Modes verified to render correctly under `WebGPURenderer` (docs/design/webgpu-tsl.md §4).
 * Flip a mode to `true` only after walking every one of its views on both backends.
 */
export const NODE_READY_MODES: Record<SimMode, boolean> = {
  plant: true,
  gem: true, // walked: formation / crystal / lattice, face indexing, all six gems (webgpu-tsl.md §8)
  parasite: false, // not yet checked
}

export function parseRendererPreference(search: string): RendererBackend {
  return new URLSearchParams(search).get(RENDERER_PARAM) === 'webgpu' ? 'webgpu' : 'webgl'
}

/** The preference with `?renderer=` set (or removed, for the default) — no other query keys touched. */
export function withRendererPreference(search: string, preference: RendererBackend): string {
  const params = new URLSearchParams(search)
  if (preference === 'webgpu') params.set(RENDERER_PARAM, 'webgpu')
  else params.delete(RENDERER_PARAM)
  const next = params.toString()
  return next ? `?${next}` : ''
}

/** The backend the Canvas for `mode` is created with. */
export function backendForMode(mode: SimMode, preference: RendererBackend): RendererBackend {
  return NODE_READY_MODES[mode] ? preference : 'webgl'
}
