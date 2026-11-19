import { useModeStore, type SimMode } from '../stores/modeStore'

const MODES: { id: SimMode; label: string; icon: string }[] = [
  { id: 'plant', label: 'Plants', icon: '🌿' },
  { id: 'gem', label: 'Gems', icon: '💎' },
  { id: 'parasite', label: 'Parasites', icon: '🦠' },
]

export function ModeSwitch() {
  const mode = useModeStore((s) => s.mode)
  const setMode = useModeStore((s) => s.setMode)
  return (
    <div className="mode-switch" role="tablist" aria-label="Simulation mode">
      {MODES.map((m) => (
        <button
          key={m.id}
          role="tab"
          aria-selected={mode === m.id}
          className={`mode-btn ${mode === m.id ? 'active' : ''}`}
          onClick={() => setMode(m.id)}
        >
          <span className="icon">{m.icon}</span>
          {m.label}
        </button>
      ))}
    </div>
  )
}
