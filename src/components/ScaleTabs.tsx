import type { ViewScale } from '../App'
import type { GemViewScale } from './CrystalViewer'
import type { ParasiteViewScale } from './ParasiteViewer'

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

export const PARASITE_TABS: TabDef<ParasiteViewScale>[] = [
  { id: 'environment', label: 'Soil', icon: '🌱' },
  { id: 'tissue', label: 'Tissue', icon: '🫀' },
  { id: 'slice', label: 'Cyst garden', icon: '🍇' },
  { id: 'cell', label: 'Cell / PV', icon: '🔬' },
  { id: 'organelle', label: 'Organelle', icon: '🧫' },
  { id: 'sandbox', label: 'Lytic cycle', icon: '🔁' },
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
