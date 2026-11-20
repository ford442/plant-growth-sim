import { useEffect } from 'react'
import { useThree } from '@react-three/fiber'
import { attachGpuLossHandlers, type GpuLossKind } from './gpuLossRecovery'
import { describeRenderer, type ActiveRenderer } from './createRenderer'

interface Props {
  onDeviceLost?: (kind: GpuLossKind) => void
  /** Called with the renderer this Canvas really got, and with null when it goes away. */
  onActive?: (active: ActiveRenderer | null) => void
}

/**
 * Mount inside a `<Canvas>`: wires GPU-loss handlers to the renderer and
 * reports which renderer is live.
 *
 * It deliberately does NOT dispose the renderer. R3F owns any renderer built by
 * a `gl` factory and disposes it (WebGPU device included) when the Canvas
 * unmounts. Disposing it here as well is actively harmful: React StrictMode
 * runs this cleanup on a *live* renderer in dev, and `WebGPURenderer.dispose()`
 * on its WebGL2 backend calls `loseContext()` — the canvas goes blank.
 */
export function RendererLifecycle({ onDeviceLost, onActive }: Props) {
  const gl = useThree((s) => s.gl)

  useEffect(() => {
    const active = describeRenderer(gl)
    console.info(`[Renderer] active: ${active}`)
    onActive?.(active)
    return () => onActive?.(null)
  }, [gl, onActive])

  useEffect(() => {
    const detach = attachGpuLossHandlers(gl, {
      onLost: (kind, detail) => console.warn(`[Renderer] GPU ${kind}`, detail ?? ''),
      onRestored: (kind) => {
        // WebGL restores in place; a lost WebGPU device needs a fresh Canvas
        if (kind === 'device-lost') onDeviceLost?.(kind)
      },
    })
    return detach
  }, [gl, onDeviceLost])
  return null
}
