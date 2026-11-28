import type { ActiveRenderer, RendererBackend } from '../rendering'
import { useModeStore } from '../stores/modeStore'
import { useRendererStore } from '../stores/rendererStore'

/** What is drawing — the renderer only; whether the leaf shader chunk loaded is a separate matter. */
function statusLine(active: ActiveRenderer | null, preference: RendererBackend): string {
  if (active === null) return 'Starting renderer…'
  if (active === 'webgpu') return 'WebGPU device active.'
  if (active === 'webgl2-nodes') return 'No WebGPU adapter here — node renderer running on its WebGL2 backend.'
  return preference === 'webgpu'
    ? 'WebGPU renderer could not start — fell back to classic WebGL.'
    : 'Classic WebGL renderer.'
}

/**
 * Opt-in switch for the experimental WebGPU/TSL renderer (plant and gem modes —
 * parasite is not node-ready yet, see `NODE_READY_MODES`). Switching
 * remounts the Canvas; simulation state lives in the stores and is untouched.
 */
export function RendererPanel() {
  const preference = useRendererStore((s) => s.preference)
  const active = useRendererStore((s) => s.active)
  const setPreference = useRendererStore((s) => s.setPreference)
  const mode = useModeStore((s) => s.mode)

  return (
    <div className="panel renderer-panel">
      <h3>
        Renderer <span className="muted">experimental</span>
      </h3>
      <div className="btn-row" role="group" aria-label="Renderer">
        <button
          type="button"
          className={`btn ${preference === 'webgl' ? 'primary' : ''}`}
          aria-pressed={preference === 'webgl'}
          onClick={() => setPreference('webgl')}
        >
          WebGL
        </button>
        <button
          type="button"
          className={`btn ${preference === 'webgpu' ? 'primary' : ''}`}
          aria-pressed={preference === 'webgpu'}
          onClick={() => setPreference('webgpu')}
        >
          WebGPU · TSL
        </button>
      </div>
      <p className="small muted" data-testid="renderer-status" data-active={active ?? ''}>
        {statusLine(active, preference)}
      </p>
      <p className="small muted">
        {mode === 'gem'
          ? 'The WebGPU option shades gems with a TSL material: inclusions (silk, jardin, veils, cleavage…), pleochroism, fluorescence, heat glow and etch frost.'
          : 'The WebGPU option shades leaves with a TSL material: translucency, chlorophyll, rain wetness and wind flutter.'}
      </p>
    </div>
  )
}
