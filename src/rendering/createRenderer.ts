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

/**
 * Every flag the app relies on when the GL context is created. They cannot be
 * changed afterwards (a canvas keeps the attributes of its first context), so
 * this is the one place to read them. `powerPreference` and
 * `failIfMajorPerformanceCaveat` come from the capability probe instead
 * (`probeGraphicsCapability.ts`: `high-performance` on a capable GPU).
 */
export const CONTEXT_FLAGS = {
  /** MSAA on the default framebuffer: branches and leaf edges alias badly without it. */
  antialias: true,
  /** Opaque canvas. Each mode paints its own `<color attach="background">`, and no mode composites over the page. */
  alpha: false,
  /** Depth buffer on: every scene needs it. */
  depth: true,
  /** Off until something needs a stencil (e.g. a clip plane or section cap); saves memory and a clear. */
  stencil: false,
  /**
   * Logarithmic depth, so one camera can span a garden (tens of metres) and a
   * cell (tens of microns) without z-fighting. It has to be chosen here, not
   * patched onto materials later. Costs: fragment depth is written in the
   * shader, which defeats early-z, and a hand-written `ShaderMaterial` must
   * include the `logdepthbuf_*` chunks or its depth will not match its neighbours
   * (see `parasite/slice/wallShader.ts`).
   */
  logarithmicDepthBuffer: true,
} as const

/**
 * Output pipeline, named rather than inherited. R3F would pick ACES filmic and
 * sRGB anyway (R3F 9 / three r186 defaults); stating them keeps `Environment`
 * lighting and every mode's look independent of a library default changing.
 */
export const OUTPUT = {
  toneMapping: THREE.ACESFilmicToneMapping,
  toneMappingExposure: 1,
  outputColorSpace: THREE.SRGBColorSpace,
} as const

/**
 * Shadow map used by the plant mode's key light. `<Canvas shadows>` turns the
 * map machinery on; a light only costs anything if it sets `castShadow`, so
 * modes with nothing to cast on (gem, parasite) leave it off.
 * The frustum is sized for the plant view (ground disk radius 3.5, plants that
 * outgrow the frame — see AGENTS.md "Known issue").
 */
export const KEY_LIGHT_SHADOW = {
  mapSize: [1024, 1024] as [number, number],
  /** Half-width of the orthographic shadow frustum, world units. */
  extent: 8,
  near: 1,
  far: 40,
  /** Thin instanced cylinders self-shadow ("acne") without a small bias. */
  bias: -0.0005,
  normalBias: 0.02,
} as const

/**
 * Apply {@link OUTPUT} to a renderer. Pass it as (or call it from) `<Canvas onCreated>`,
 * which runs after R3F has applied its own defaults. Idempotent.
 */
export function configureOutput(renderer: unknown): void {
  const r = renderer as {
    toneMapping: THREE.ToneMapping
    toneMappingExposure: number
    outputColorSpace: string
  }
  r.toneMapping = OUTPUT.toneMapping
  r.toneMappingExposure = OUTPUT.toneMappingExposure
  r.outputColorSpace = OUTPUT.outputColorSpace
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
          alpha: CONTEXT_FLAGS.alpha,
          depth: CONTEXT_FLAGS.depth,
          stencil: CONTEXT_FLAGS.stencil,
          logarithmicDepthBuffer: CONTEXT_FLAGS.logarithmicDepthBuffer,
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
      ...CONTEXT_FLAGS,
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
