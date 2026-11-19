import { useEffect } from 'react'
import { useThree } from '@react-three/fiber'
import { attachGpuLossHandlers, type GpuLossKind } from './gpuLossRecovery'
import { disposeRenderer } from './createRenderer'

/**
 * Mount inside a `<Canvas>`: wires GPU-loss handlers to the renderer and
 * disposes it (incl. the WebGPU device) when the Canvas unmounts, so switching
 * modes never leaks a renderer or device.
 */
export function RendererLifecycle({ onDeviceLost }: { onDeviceLost?: (kind: GpuLossKind) => void }) {
  const gl = useThree((s) => s.gl)
  useEffect(() => {
    const detach = attachGpuLossHandlers(gl, {
      onLost: (kind, detail) => console.warn(`[Renderer] GPU ${kind}`, detail ?? ''),
      onRestored: (kind) => {
        // WebGL restores in place; a lost WebGPU device needs a fresh Canvas
        if (kind === 'device-lost') onDeviceLost?.(kind)
      },
    })
    return () => {
      detach()
      disposeRenderer(gl)
    }
  }, [gl, onDeviceLost])
  return null
}
