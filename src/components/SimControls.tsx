import { useSimStore } from '../stores/simStore'

export function SimControls() {
  const isPlaying = useSimStore((s) => s.isPlaying)
  const play = useSimStore((s) => s.play)
  const pause = useSimStore((s) => s.pause)
  const reset = useSimStore((s) => s.reset)
  const speed = useSimStore((s) => s.speed)
  const setSpeed = useSimStore((s) => s.setSpeed)
  const age = useSimStore((s) => s.age)
  const height = useSimStore((s) => s.height)
  const biomass = useSimStore((s) => s.biomass)
  const growthRate = useSimStore((s) => s.growthRate)

  return (
    <div className="panel sim-controls">
      <h3>Simulation</h3>

      <div className="btn-row">
        <button className="btn primary" onClick={isPlaying ? pause : play}>
          {isPlaying ? '⏸ Pause' : '▶ Play'}
        </button>
        <button className="btn" onClick={reset}>
          ↺ Reset
        </button>
      </div>

      <div className="control">
        <label>
          Speed
          <span className="val">{speed.toFixed(1)} d/s</span>
        </label>
        <input
          type="range"
          min={0.05}
          max={3}
          step={0.05}
          value={speed}
          onChange={(e) => setSpeed(+e.target.value)}
        />
      </div>

      <div className="stats-grid">
        <div className="stat">
          <span className="stat-label">Age</span>
          <span className="stat-value">{age.toFixed(1)} d</span>
        </div>
        <div className="stat">
          <span className="stat-label">Height</span>
          <span className="stat-value">{height.toFixed(2)} m</span>
        </div>
        <div className="stat">
          <span className="stat-label">Biomass</span>
          <span className="stat-value">{biomass.toFixed(2)}</span>
        </div>
        <div className="stat">
          <span className="stat-label">Growth</span>
          <span className="stat-value">{growthRate.toFixed(3)}</span>
        </div>
      </div>
    </div>
  )
}
