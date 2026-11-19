import { useSimStore } from '../stores/simStore'
import { GEMSTONE_PRESETS, GEOLOGY_RANGES } from '../simulation/GemstonePresets'
import { growthMode, GROWTH_MODE_LABEL, type CrystalStatus } from '../simulation/CrystalGrowth'
import { PhaseDiagram } from './PhaseDiagram'

const LP_MIN = Math.log10(GEOLOGY_RANGES.pressure.min)
const LP_MAX = Math.log10(GEOLOGY_RANGES.pressure.max)

const STATUS_LABEL: Record<CrystalStatus, { text: string; tone: 'good' | 'warn' | 'bad' }> = {
  growing: { text: 'Growing', tone: 'good' },
  mature: { text: 'Mature — cavity / supply exhausted', tone: 'good' },
  equilibrium: { text: 'Saturated — no net growth', tone: 'warn' },
  unstable: { text: 'Outside stability field', tone: 'bad' },
  dissolving: { text: 'Undersaturated — dissolving', tone: 'bad' },
  resorbing: { text: 'Resorbing outside its field', tone: 'bad' },
}

const formatP = (p: number) => (p < 1 ? p.toFixed(2) : p < 10 ? p.toFixed(1) : p.toFixed(0))

export function GeologyPanel() {
  const gemstone = useSimStore((s) => s.gemstone)
  const geology = useSimStore((s) => s.geology)
  const setGeology = useSimStore((s) => s.setGeology)
  const status = useSimStore((s) => s.crystal.status)
  const peak = useSimStore((s) => s.crystal.peakTemperature)
  const def = GEMSTONE_PRESETS[gemstone]

  const stability = def.stability(geology)
  const sigma = geology.saturation - 1
  const mode = growthMode(sigma, stability)
  const note = def.phaseNote(geology, peak)
  const st = STATUS_LABEL[status]

  return (
    <div className="panel geology-panel">
      <h3>Geology & Growth Medium</h3>

      <div className="control">
        <label>
          Temperature
          <span className="val">{geology.temperature.toFixed(0)}°C</span>
        </label>
        <input
          type="range"
          min={GEOLOGY_RANGES.temperature.min}
          max={GEOLOGY_RANGES.temperature.max}
          step={5}
          value={geology.temperature}
          onChange={(e) => setGeology({ temperature: +e.target.value })}
        />
      </div>

      <div className="control">
        <label>
          Pressure
          <span className="val">
            {formatP(geology.pressure)} kbar <span className="muted">≈ {(geology.pressure * 3.3).toFixed(geology.pressure < 3 ? 1 : 0)} km</span>
          </span>
        </label>
        <input
          type="range"
          min={LP_MIN}
          max={LP_MAX}
          step={0.005}
          value={Math.log10(geology.pressure)}
          onChange={(e) => setGeology({ pressure: 10 ** +e.target.value })}
        />
      </div>

      <div className="control">
        <label>
          Saturation S
          <span className="val">
            {geology.saturation.toFixed(2)} <span className="muted">σ {sigma >= 0 ? '+' : ''}{(sigma * 100).toFixed(0)}%</span>
          </span>
        </label>
        <input
          type="range"
          min={GEOLOGY_RANGES.saturation.min}
          max={GEOLOGY_RANGES.saturation.max}
          step={0.01}
          value={geology.saturation}
          onChange={(e) => setGeology({ saturation: +e.target.value })}
        />
      </div>

      <div className="control">
        <label title={`${def.dopant.effect} (max ${def.dopant.maxLabel})`}>
          {def.dopant.label}
          <span className="val">{(geology.impurity * 100).toFixed(0)}%</span>
        </label>
        <input
          type="range"
          min={0}
          max={1}
          step={0.01}
          value={geology.impurity}
          onChange={(e) => setGeology({ impurity: +e.target.value })}
        />
      </div>

      <PhaseDiagram def={def} geology={geology} onPick={(temperature, pressure) => setGeology({ temperature, pressure })} />

      <div className="status-bar">
        <div className="status-label">Phase stability</div>
        <div className="bar-track">
          <div
            className="bar-fill"
            style={{
              width: `${stability * 100}%`,
              background: stability > 0.6 ? 'var(--accent)' : stability > 0.2 ? '#fbbf24' : '#f87171',
            }}
          />
        </div>
        <div className={`gem-status tone-${st.tone}`}>{st.text}</div>
        <div className="gem-mode">{GROWTH_MODE_LABEL[mode]}</div>
        {note && <div className="gem-note">{note}</div>}
        <button className="btn reset-conditions" onClick={() => setGeology({ ...def.defaults })}>
          Restore {def.name.toLowerCase()} formation conditions
        </button>
      </div>
    </div>
  )
}
