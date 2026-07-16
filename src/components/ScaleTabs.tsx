import type { ViewScale } from '../App'

const TABS: { id: ViewScale; label: string; icon: string }[] = [
  { id: 'macro', label: 'Macro', icon: '🌍' },
  { id: 'architecture', label: 'Architecture', icon: '🌳' },
  { id: 'cellular', label: 'Cellular', icon: '🧬' },
  { id: 'roots', label: 'Roots', icon: '🌱' },
]

interface Props {
  scale: ViewScale
  onChange: (s: ViewScale) => void
}

export function ScaleTabs({ scale, onChange }: Props) {
  return (
    <div className="scale-tabs">
      {TABS.map((tab) => (
        <button
          key={tab.id}
          className={`scale-tab ${scale === tab.id ? 'active' : ''}`}
          onClick={() => onChange(tab.id)}
        >
          <span className="icon">{tab.icon}</span>
          {tab.label}
        </button>
      ))}
    </div>
  )
}
