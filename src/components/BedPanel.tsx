import { useEffect, useState } from 'react'
import { useSimStore } from '../stores/simStore'
import type { Individual } from '../simulation/plot'

const SAMPLE_MS = 250

/**
 * The bed as a list: pick the focused plant (the one Architecture, Cellular and
 * Roots show). Samples the store a few times a second rather than per tick.
 */
export function BedPanel() {
  const focusId = useSimStore((s) => s.focusId)
  const setFocus = useSimStore((s) => s.setFocus)
  const [plot, setPlot] = useState<Individual[]>(() => useSimStore.getState().plot)
  useEffect(() => {
    const id = setInterval(() => setPlot(useSimStore.getState().plot), SAMPLE_MS)
    return () => clearInterval(id)
  }, [])

  return (
    <div className="panel bed-panel">
      <h3>Bed</h3>
      <ul className="bed-list">
        {plot.map((p) => (
          <li key={p.id}>
            <button className={`bed-row ${p.id === focusId ? 'active' : ''}`} onClick={() => setFocus(p.id)}>
              <span className="bed-name">{p.species}</span>
              <span className="bed-stat">{p.age.toFixed(0)} d</span>
              <span className="bed-stat">{p.height.toFixed(2)} m</span>
              <span className="bed-stat">💧 {(p.waterStatus * 100).toFixed(0)}%</span>
            </button>
          </li>
        ))}
      </ul>
      <p className="bed-hint">Click a plant in Macro or pick one here; the other views follow it.</p>
    </div>
  )
}
