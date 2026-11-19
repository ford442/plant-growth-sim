import type { ViewScale } from '../App'
import type { GemViewScale } from './CrystalViewer'

export interface TabDef<T extends string> {
  id: T
  label: string
  icon: string
}

export const PLANT_TABS: TabDef<ViewScale>[] = [
  { id: 'macro', label: 'Macro', icon: '🌍' },
  { id: 'architecture', label: 'Architecture', icon: '🌳' },
  { id: 'cellular', label: 'Cellular', icon: '🧬' },
  { id: 'roots', label: 'Roots', icon: '🌱' },
]

export const GEM_TABS: TabDef<GemViewScale>[] = [
  { id: 'formation', label: 'Formation', icon: '⛰️' },
  { id: 'crystal', label: 'Crystal', icon: '💎' },
  { id: 'lattice', label: 'Lattice', icon: '⚛️' },
]

interface Props<T extends string> {
  tabs: TabDef<T>[]
  scale: T
  onChange: (s: T) => void
}

export function ScaleTabs<T extends string>({ tabs, scale, onChange }: Props<T>) {
  return (
    <div className="scale-tabs">
      {tabs.map((tab) => (
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
