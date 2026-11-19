/**
 * GPU loss handling (trimmed port of ford442/watershed
 * `src/rendering/gpuLossRecovery.ts`). Listens for WebGL context loss /
 * restore and WebGPU device loss, and returns a detach function so a
 * remounting Canvas never stacks listeners.
 */

export type GpuLossKind = 'context-lost' | 'device-lost'

export interface GpuLossCallbacks {
  onLost(kind: GpuLossKind, detail?: string): void
  onRestored(kind: GpuLossKind): void
}

interface DeviceLossInfo {
  api?: string
  message?: string
  reason?: string | null
}

interface LossCapableRenderer {
  domElement?: HTMLCanvasElement
  isWebGPURenderer?: boolean
  backend?: { isWebGPUBackend?: boolean }
  onDeviceLost?: (info: DeviceLossInfo) => void
}

function isNativeWebGPU(gl: LossCapableRenderer): boolean {
  return gl.isWebGPURenderer === true && gl.backend?.isWebGPUBackend === true
}

export function attachGpuLossHandlers(renderer: unknown, callbacks: GpuLossCallbacks): () => void {
  const gl = renderer as LossCapableRenderer
  let detached = false
  const cleanups: Array<() => void> = []

  const canvas = gl.domElement
  if (canvas) {
    const onContextLost = (event: Event) => {
      event.preventDefault() // without this the browser never restores
      if (!detached) callbacks.onLost('context-lost')
    }
    const onContextRestored = () => {
      if (!detached) callbacks.onRestored('context-lost')
    }
    canvas.addEventListener('webglcontextlost', onContextLost)
    canvas.addEventListener('webglcontextrestored', onContextRestored)
    cleanups.push(() => {
      canvas.removeEventListener('webglcontextlost', onContextLost)
      canvas.removeEventListener('webglcontextrestored', onContextRestored)
    })
  }

  if (isNativeWebGPU(gl)) {
    const previous = gl.onDeviceLost
    gl.onDeviceLost = (info: DeviceLossInfo) => {
      previous?.call(gl, info) // three's default: logs and marks the renderer lost
      if (detached) return
      // a lost device is not restorable in place — the caller remounts the Canvas
      callbacks.onLost('device-lost', info?.message ?? undefined)
      callbacks.onRestored('device-lost')
    }
    cleanups.push(() => {
      gl.onDeviceLost = previous
    })
  }

  return () => {
    if (detached) return
    detached = true
    for (const cleanup of cleanups) cleanup()
  }
}
