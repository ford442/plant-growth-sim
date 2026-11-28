/**
 * Boot-time graphics capability probe (trimmed port of ford442/watershed
 * `src/rendering/probeGraphicsCapability.ts`).
 *
 * Answers two questions once per page load:
 *  - can we get a WebGL2 context at all, and with which envelope?
 *  - does the browser expose WebGPU (an adapter we could request)?
 * The probe canvases are released immediately so no context is leaked.
 */

export type GraphicsTier = 'hardware' | 'degraded' | 'unsupported'

export interface GraphicsEnvelope {
  antialias: boolean
  powerPreference: WebGLPowerPreference
  failIfMajorPerformanceCaveat: boolean
}

export const HARDWARE_ENVELOPE: GraphicsEnvelope = {
  antialias: true,
  powerPreference: 'high-performance',
  failIfMajorPerformanceCaveat: true,
}

export const DEGRADED_ENVELOPE: GraphicsEnvelope = {
  antialias: false,
  powerPreference: 'default',
  failIfMajorPerformanceCaveat: false,
}

export interface GraphicsCapability {
  tier: GraphicsTier
  envelope: GraphicsEnvelope
  /** `navigator.gpu` present and an adapter was granted. */
  webgpu: boolean
  statusMessage: string | null
}

function tryWebGL2(attributes: WebGLContextAttributes): { ok: boolean; statusMessage: string | null } {
  if (typeof document === 'undefined') return { ok: false, statusMessage: null }
  const canvas = document.createElement('canvas')
  let statusMessage: string | null = null
  const onError = (e: Event) => {
    statusMessage = (e as WebGLContextEvent).statusMessage || null
  }
  canvas.addEventListener('webglcontextcreationerror', onError)
  let ctx: WebGL2RenderingContext | null = null
  try {
    ctx = canvas.getContext('webgl2', attributes) as WebGL2RenderingContext | null
  } catch (err) {
    statusMessage = statusMessage ?? (err instanceof Error ? err.message : null)
  } finally {
    canvas.removeEventListener('webglcontextcreationerror', onError)
  }
  if (!ctx) return { ok: false, statusMessage }
  // release the probe context right away — browsers cap live contexts
  try {
    ctx.getExtension('WEBGL_lose_context')?.loseContext()
  } catch {
    /* ignore */
  }
  return { ok: true, statusMessage: null }
}

/** Synchronous WebGL2 probe: strict envelope first, then a relaxed one. */
export function probeWebGL2(): Omit<GraphicsCapability, 'webgpu'> {
  const strict = tryWebGL2({ ...HARDWARE_ENVELOPE })
  if (strict.ok) return { tier: 'hardware', envelope: HARDWARE_ENVELOPE, statusMessage: null }
  const relaxed = tryWebGL2({ ...DEGRADED_ENVELOPE })
  if (relaxed.ok) return { tier: 'degraded', envelope: DEGRADED_ENVELOPE, statusMessage: strict.statusMessage }
  return {
    tier: 'unsupported',
    envelope: DEGRADED_ENVELOPE,
    statusMessage: relaxed.statusMessage ?? strict.statusMessage,
  }
}

/** Async WebGPU probe: true only when an adapter is actually granted. */
export async function probeWebGPU(): Promise<boolean> {
  const gpu = (typeof navigator !== 'undefined' ? (navigator as Navigator & { gpu?: GPULike }).gpu : undefined)
  if (!gpu) return false
  try {
    return (await gpu.requestAdapter()) != null
  } catch {
    return false
  }
}

interface GPULike {
  requestAdapter: () => Promise<unknown>
}

let session: Promise<GraphicsCapability> | null = null

/** Probe once per page load; later callers share the same answer. */
export function getGraphicsCapability(): Promise<GraphicsCapability> {
  if (!session) {
    session = probeWebGPU().then((webgpu) => {
      const gl = probeWebGL2()
      if (gl.tier === 'degraded') console.warn('[Renderer] Safe graphics mode — antialias off, default adapter.')
      if (gl.tier === 'unsupported') console.error('[Renderer] No WebGL2 context available.', gl.statusMessage ?? '')
      return { ...gl, webgpu }
    })
  }
  return session
}
