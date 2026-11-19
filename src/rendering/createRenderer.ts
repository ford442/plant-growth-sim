/**
 * Renderer bootstrap (trimmed port of ford442/watershed
 * `src/rendering/createRenderer.ts`), shaped as an R3F `gl` factory.
 *
 * - `webgl`: classic `WebGLRenderer` (GLSL materials). Plant and gem modes use
 *   this so they render exactly as before.
 * - `webgpu`: `WebGPURenderer` from `three/webgpu` when the probe found an
 *   adapter, otherwise the same renderer on its WebGL2 backend. Only modes whose
 *   materials are node/TSL-compatible (parasite, later) should ask for it.
 */
import * as THREE from 'three'
import type { GLProps } from '@react-three/fiber'
import type { GraphicsCapability } from './probeGraphicsCapability'

export type RendererBackend = 'webgl' | 'webgpu'

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
      // dynamic import keeps the WebGPU build out of the plant-mode bundle path
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

/**
 * Release GPU resources owned by a renderer the Canvas is done with. R3F's own
 * unmount already forces WebGL context loss; this covers what it doesn't:
 * renderer-held resources and, for WebGPU, the device itself.
 */
export function disposeRenderer(renderer: unknown): void {
  const r = renderer as {
    dispose?: () => void
    isWebGPURenderer?: boolean
    backend?: { isWebGPUBackend?: boolean; device?: { destroy?: () => void } }
  }
  const device = r.isWebGPURenderer && r.backend?.isWebGPUBackend ? r.backend.device : undefined
  r.dispose?.()
  device?.destroy?.()
}
