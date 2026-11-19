import { useMemo } from 'react'
import { useSimStore } from '../stores/simStore'
import { useTimeStore } from '../stores/timeStore'
import { useModeStore } from '../stores/modeStore'
import { GEMSTONE_PRESETS } from '../simulation/GemstonePresets'
import { specimenMetrics } from '../simulation/CrystalGrowth'

export function SimControls() {
  const isPlaying = useTimeStore((s) => s.isPlaying)
  const play = useTimeStore((s) => s.play)
  const pause = useTimeStore((s) => s.pause)
  const reset = useSimStore((s) => s.reset)
  const resetCrystal = useSimStore((s) => s.resetCrystal)
  const mode = useModeStore((s) => s.mode)
  const speed = useTimeStore((s) => s.speed)
  const setSpeed = useTimeStore((s) => s.setSpeed)
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
        <button className="btn" onClick={mode === 'gem' ? resetCrystal : reset}>
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

      {mode === 'parasite' ? null : mode === 'gem' ? (
        <CrystalStats />
      ) : (
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
      )}
    </div>
  )
}

function CrystalStats() {
  const gemstone = useSimStore((s) => s.gemstone)
  const crystal = useSimStore((s) => s.crystal)
  const def = GEMSTONE_PRESETS[gemstone]
  const m = useMemo(() => specimenMetrics(def, crystal.h), [def, crystal.h])
  const rate = crystal.radialRate
  return (
    <div className="stats-grid">
      <div className="stat">
        <span className="stat-label">Age</span>
        <span className="stat-value">{crystal.age.toFixed(1)} d</span>
      </div>
      <div className="stat">
        <span className="stat-label">Length × width</span>
        <span className="stat-value">
          {m.length.toFixed(1)} × {m.width.toFixed(1)} mm
        </span>
      </div>
      <div className="stat">
        <span className="stat-label">Mass</span>
        <span className="stat-value">{m.carats < 10 ? m.carats.toFixed(2) : m.carats.toFixed(1)} ct</span>
      </div>
      <div className="stat">
        <span className="stat-label">Growth</span>
        <span className="stat-value">
          {rate >= 0 ? '+' : ''}
          {(rate * 1000).toFixed(0)} µm/d
        </span>
      </div>
      <div className="stat">
        <span className="stat-label">Crystals</span>
        <span className="stat-value">{crystal.nuclei.length}</span>
      </div>
      <div className="stat">
        <span className="stat-label">Growth zones</span>
        <span className="stat-value">{crystal.zones.length}</span>
      </div>
    </div>
  )
}
