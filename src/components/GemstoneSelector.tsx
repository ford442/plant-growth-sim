import { useSimStore } from '../stores/simStore'
import { GEMSTONE_IDS, GEMSTONE_PRESETS } from '../simulation/GemstonePresets'

export function GemstoneSelector() {
  const gemstone = useSimStore((s) => s.gemstone)
  const setGemstone = useSimStore((s) => s.setGemstone)

  return (
    <div className="species-selector">
      {GEMSTONE_IDS.map((id) => {
        const g = GEMSTONE_PRESETS[id]
        return (
          <button
            key={id}
            className={`species-btn ${gemstone === id ? 'active' : ''}`}
            onClick={() => setGemstone(id)}
            title={`${g.name} — ${g.mineral} (${g.formula})`}
          >
            <span className="gem-glyph" style={{ background: g.swatch }} />
            <span className="label">{g.name}</span>
          </button>
        )
      })}
    </div>
  )
}
