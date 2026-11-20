/**
 * Renderer bootstrap (trimmed port of ford442/watershed
 * `src/rendering/createRenderer.ts`), shaped as an R3F `gl` factory.
 *
 * - `webgl`: classic `WebGLRenderer` (GLSL materials). The default for every
 *   mode, so nothing changes unless a node-ready mode opts in.
 * - `webgpu`: `WebGPURenderer` from `three/webgpu` when the probe found an
 *   adapter, otherwise the same renderer on its WebGL2 backend (TSL node
 *   materials compile to GLSL there). If the module cannot be loaded or the
 *   renderer cannot initialise, it falls back to the classic `WebGLRenderer`.
 *   Only modes whose materials are node/TSL-compatible may ask for it — see
 *   `NODE_READY_MODES` in `rendererPreference.ts`.
 *
 * What actually came up is reported by `describeRenderer()`; materials that
 * only exist as node materials must check it rather than assume the request
 * was honoured (docs/design/webgpu-tsl.md).
 */
import * as THREE from 'three'
import type { GLProps } from '@react-three/fiber'
import type { GraphicsCapability } from './probeGraphicsCapability'

export type RendererBackend = 'webgl' | 'webgpu'

/**
 * What is really rendering, which can differ from what was asked for:
 * - `webgl`: classic `WebGLRenderer` (no node materials)
 * - `webgpu`: `WebGPURenderer` on a real WebGPU device
 * - `webgl2-nodes`: `WebGPURenderer` on its WebGL2 backend — node/TSL
 *   materials work, WebGPU-only features (compute, storage buffers) do not
 */
export type ActiveRenderer = 'webgl' | 'webgpu' | 'webgl2-nodes'

export interface RendererOptions {
  backend: RendererBackend
  capability: GraphicsCapability
}

/** Returns an R3F-compatible `gl` prop: `gl={rendererFactory(opts)}`. */
export function rendererFactory({ backend, capability }: RendererOptions): GLProps {
  const { antialias, powerPreference, failIfMajorPerformanceCaveat } = capability.envelope

  return async (props: { canvas: unknown }): Promise<THREE.WebGLRenderer> => {
    const canvas = props.canvas as HTMLCanvasElement

    if (backend === 'webgpu') {
      try {
        // dynamic import keeps the WebGPU build out of the default bundle path
        const { WebGPURenderer } = await import('three/webgpu')
        const renderer = new WebGPURenderer({
          canvas,
          antialias,
          powerPreference: powerPreference === 'default' ? undefined : powerPreference,
          forceWebGL: !capability.webgpu,
        })
        await renderer.init()
        // R3F types its root renderer as WebGLRenderer; WebGPURenderer is accepted at runtime
        return renderer as unknown as THREE.WebGLRenderer
      } catch (err) {
        // A failed chunk load or adapter/device request leaves the canvas untouched,
        // so the classic renderer can still take it. (If init() had already claimed a
        // 'webgpu' context the canvas could not be reused and this would throw too.)
        console.warn('[Renderer] WebGPURenderer unavailable — using WebGLRenderer', err)
      }
    }

    return new THREE.WebGLRenderer({
      canvas,
      // plant/gem always asked for MSAA; keep that regardless of probe tier
      antialias: true,
      alpha: false,
      powerPreference,
      failIfMajorPerformanceCaveat,
    })
  }
}

/** Which renderer a Canvas ended up with (see {@link ActiveRenderer}). */
export function describeRenderer(renderer: unknown): ActiveRenderer {
  const r = renderer as { isWebGPURenderer?: boolean; backend?: { isWebGPUBackend?: boolean } } | null
  if (!r?.isWebGPURenderer) return 'webgl'
  return r.backend?.isWebGPUBackend ? 'webgpu' : 'webgl2-nodes'
}
