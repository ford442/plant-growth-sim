import { useMemo } from 'react'
import { useSimStore } from '../stores/simStore'
import { GEMSTONE_PRESETS } from '../simulation/GemstonePresets'
import { growthMode, GROWTH_MODE_LABEL, specimenMetrics } from '../simulation/CrystalGrowth'
import { ELEMENT_STYLE, STRUCTURES, unitCell, type Element } from '../simulation/CrystalLattice'
import type { GemViewOptions, GemViewScale } from './CrystalViewer'

const SYSTEM_LABEL = {
  cubic: 'Cubic',
  hexagonal: 'Hexagonal',
  trigonal: 'Trigonal',
  orthorhombic: 'Orthorhombic',
} as const

function formatLayers(n: number): string {
  if (n >= 1e9) return `${(n / 1e9).toFixed(2)} G`
  if (n >= 1e6) return `${(n / 1e6).toFixed(2)} M`
  if (n >= 1e3) return `${(n / 1e3).toFixed(1)} k`
  return n.toFixed(0)
}

export function GemInfoPanel({
  scale,
  options,
  onOptions,
}: {
  scale: GemViewScale
  options: GemViewOptions
  onOptions: (o: GemViewOptions) => void
}) {
  const gemstone = useSimStore((s) => s.gemstone)
  const h = useSimStore((s) => s.crystal.h)
  const def = GEMSTONE_PRESETS[gemstone]
  const metrics = useMemo(() => specimenMetrics(def, h), [def, h])

  return (
    <div className="panel gem-info">
      <h3>
        {def.name} <span className="muted">{def.formula}</span>
      </h3>
      <p className="gem-blurb">{def.habitNote}</p>

      <div className="kv-grid">
        <span>System</span>
        <b>{SYSTEM_LABEL[def.system]}</b>
        <span>Point / space group</span>
        <b>
          {def.pointGroup} · {def.spaceGroup}
        </b>
        <span>Refractive index</span>
        <b>{def.optics.ior.toFixed(3)}</b>
        <span>Dispersion</span>
        <b>{def.optics.dispersion.toFixed(3)}</b>
        <span>Density · Mohs</span>
        <b>
          {def.optics.density.toFixed(2)} g/cm³ · {def.optics.hardness}
        </b>
      </div>

      <div className="habit-list">
        <div className="status-label">Habit — exposed face area</div>
        {def.faces.map((f, i) => (
          <div key={f.symbol + f.form} className="habit-row">
            <span className="swatch" style={{ background: f.color }} />
            <span className="habit-name">
              <b>{f.symbol}</b> {f.form} <span className="muted">{f.name}</span>
            </span>
            <span className="habit-bar">
              <span style={{ width: `${metrics.faceShare[i] * 100}%`, background: f.color }} />
            </span>
            <span className="habit-pct">{(metrics.faceShare[i] * 100).toFixed(0)}%</span>
          </div>
        ))}
      </div>

      {scale !== 'lattice' && (
        <div className="toggle-row">
          <label className="toggle">
            <input
              type="checkbox"
              checked={options.faceIndexing}
              onChange={(e) => onOptions({ ...options, faceIndexing: e.target.checked })}
            />
            Face indexing
          </label>
          {scale === 'crystal' && (
            <label className="toggle">
              <input
                type="checkbox"
                checked={options.phantoms}
                onChange={(e) => onOptions({ ...options, phantoms: e.target.checked })}
              />
              Growth phantoms
            </label>
          )}
        </div>
      )}

      {scale === 'lattice' && <LatticeLegend />}
    </div>
  )
}

function LatticeLegend() {
  const gemstone = useSimStore((s) => s.gemstone)
  const geology = useSimStore((s) => s.geology)
  const layers = useSimStore((s) => s.crystal.layersDeposited)
  const def = GEMSTONE_PRESETS[gemstone]
  const structure = STRUCTURES[def.lattice]
  const elements = useMemo(() => [...new Set(unitCell(def.lattice).map((a) => a.el))], [def.lattice])
  const mode = growthMode(geology.saturation - 1, def.stability(geology))
  const dopant = def.dopant.element as Element

  return (
    <div className="lattice-legend">
      <div className="status-label">
        {structure.name} · a={structure.cell.a.toFixed(2)} c={structure.cell.c.toFixed(2)} Å
      </div>
      <div className="legend-items">
        {elements.map((el) => (
          <span key={el} className="legend-item">
            <span className="dot" style={{ background: ELEMENT_STYLE[el].color }} />
            {el}
          </span>
        ))}
        <span className="legend-item">
          <span className="dot" style={{ background: ELEMENT_STYLE[dopant].color }} />
          {dopant} → {def.dopant.replaces}
        </span>
        <span className="legend-item">
          <span className="dot ghost" />
          vacancy
        </span>
      </div>
      <div className="kv-grid">
        <span>Surface mechanism</span>
        <b>{GROWTH_MODE_LABEL[mode]}</b>
        <span>Layers deposited</span>
        <b>{formatLayers(layers)}</b>
      </div>
      <p className="muted small">
        Front shown time-lapsed; defect &amp; dopant densities exaggerated ~10³× so they are visible.
        Each layer keeps the conditions it grew under.
      </p>
    </div>
  )
}
