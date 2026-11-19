import { useEffect, useState } from 'react'
import { getGraphicsCapability, type GraphicsCapability } from './probeGraphicsCapability'

/** The session's probed capability, or null while the (one-time) probe runs. */
export function useGraphicsCapability(): GraphicsCapability | null {
  const [cap, setCap] = useState<GraphicsCapability | null>(null)
  useEffect(() => {
    let alive = true
    getGraphicsCapability().then((c) => alive && setCap(c))
    return () => {
      alive = false
    }
  }, [])
  return cap
}
