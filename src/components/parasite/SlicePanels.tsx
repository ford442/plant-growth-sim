/**
 * DOM side of the tissue slice: the scale bar and hover tooltip that sit over
 * the viewport, and the sidebar panel (tissue palette, level of detail, scale
 * reference). Like the other parasite panels it only reads stores — the tooltip
 * samples the simulation a few times a second rather than re-rendering per tick.
 */

import { Fragment, useEffect, useMemo, useReducer, useRef } from 'react'
import { LOD_TIERS, type LodTier } from '../../rendering/lod/adaptiveLod'
import { NICHES, NICHE_DEFS } from '../../simulation/parasite/hostImmunity'
import { CYST_MAX_DIAMETER, CYST_MIN_DIAMETER, CYST_WALL_MAX, STAGE_DEFS } from '../../simulation/parasite/stages'
import { CELL_RADIUS, MATURE_CYST_BRADYZOITES } from '../../simulation/parasite/world'
import { useParasiteStore } from '../../stores/parasiteStore'
import { useSliceViewStore } from '../../stores/sliceViewStore'
import { describeCyst } from './slice/cystInfo'
import { SLICE_PALETTES } from './slice/palette'
import { SLICE_LOD } from './slice/sliceLod'
import { stressCysts } from './slice/syntheticCysts'

const TIER_LABEL: Record<LodTier, string> = { low: 'Low', medium: 'Medium', high: 'High', ultra: 'Ultra' }

/** The scale bar: a rule whose width really spans `um` micrometres at the focal plane. */
function SliceScaleBar() {
  const bar = useSliceViewStore((s) => s.scaleBar)
  if (!bar) return null
  return (
    <div className="slice-scalebar" aria-label={`Scale bar, ${bar.label}`}>
      <div className="slice-scalebar-rule" style={{ width: bar.px }} />
      <span>{bar.label}</span>
    </div>
  )
}

/** Stage, age and bradyzoite count of the cyst under the pointer. Follows the pointer in the DOM, not through React state. */
function SliceTooltip() {
  const hoverId = useSliceViewStore((s) => s.hoverId)
  const stress = useSliceViewStore((s) => s.stress)
  const el = useRef<HTMLDivElement>(null)
  const [, refresh] = useReducer((n: number) => n + 1, 0)

  // follow the pointer
  useEffect(() => {
    const host = el.current?.parentElement
    if (!host) return
    const move = (e: PointerEvent) => {
      const tip = el.current
      if (!tip) return
      const r = host.getBoundingClientRect()
      const x = e.clientX - r.left
      const flip = x > r.width - 240 // keep it on screen near the right edge
      tip.style.left = `${flip ? x - 16 : x + 16}px`
      tip.style.top = `${e.clientY - r.top + 16}px`
      tip.style.transform = flip ? 'translateX(-100%)' : ''
    }
    host.addEventListener('pointermove', move)
    return () => host.removeEventListener('pointermove', move)
  }, [])

  // a cyst's age and count move with the sim, but a person reads them a few times a second
  useEffect(() => {
    if (hoverId === null) return
    const id = setInterval(refresh, 200)
    return () => clearInterval(id)
  }, [hoverId])

  const synthetic = useMemo(() => (stress > 0 ? stressCysts(stress) : null), [stress])
  const cyst =
    hoverId === null ? undefined : (synthetic ?? useParasiteStore.getState().world.cysts).find((c) => c.id === hoverId)
  const info = cyst ? describeCyst(cyst) : null

  return (
    <div ref={el} className={`slice-tooltip ${info ? 'show' : ''}`} role="tooltip">
      {info && (
        <>
          <div className={`slice-tooltip-title ${info.stage}`}>{info.title}</div>
          <div className="kv-grid">
            {info.rows.map(([label, value]) => (
              <Fragment key={label}>
                <span>{label}</span>
                <b>{value}</b>
              </Fragment>
            ))}
          </div>
        </>
      )}
    </div>
  )
}

/** Everything that floats over the slice viewport. Absent while there is no host, as the scene itself is. */
export function SliceOverlay() {
  const inHost = useParasiteStore((s) => s.world.compartment !== 'environment')
  if (!inHost) return null
  return (
    <>
      <SliceScaleBar />
      <SliceTooltip />
    </>
  )
}

/** Sidebar: tissue palette, level of detail, and the real sizes everything is drawn at. */
export function SlicePanel() {
  const niche = useSliceViewStore((s) => s.niche)
  const tier = useSliceViewStore((s) => s.lodTier)
  const auto = useSliceViewStore((s) => s.lodAuto)
  const stress = useSliceViewStore((s) => s.stress)
  const stats = useSliceViewStore((s) => s.stats)
  const setNiche = useSliceViewStore((s) => s.setNiche)
  const setLodTier = useSliceViewStore((s) => s.setLodTier)
  const setLodAuto = useSliceViewStore((s) => s.setLodAuto)

  const budget = SLICE_LOD[tier].bradyzoiteBudget
  const capped = stats.drawn < stats.total

  return (
    <div className="panel slice-panel">
      <h3>Cyst garden</h3>
      <p className="gem-blurb">
        A section of tissue, drawn to scale. Each cyst keeps its own plot as it grows; hover one for its stage,
        age and bradyzoite count.
      </p>

      <div className="status-label">Tissue (cosmetic)</div>
      <div className="niche-row">
        {NICHES.map((id) => (
          <button
            key={id}
            className={`niche-btn ${niche === id ? 'active' : ''}`}
            style={{ borderColor: niche === id ? NICHE_DEFS[id].color : undefined }}
            onClick={() => setNiche(id)}
            title={NICHE_DEFS[id].note}
          >
            <span className="swatch" style={{ background: SLICE_PALETTES[id].cell }} />
            {SLICE_PALETTES[id].name}
          </button>
        ))}
      </div>

      <div className="status-label">Level of detail</div>
      <div className="slice-tier-row">
        {LOD_TIERS.map((t) => (
          <button
            key={t}
            className={`niche-btn ${tier === t ? 'active' : ''}`}
            onClick={() => setLodTier(t)}
            title={`Up to ${SLICE_LOD[t].bradyzoiteBudget.toLocaleString()} bradyzoites drawn`}
          >
            {TIER_LABEL[t]}
          </button>
        ))}
      </div>
      <label className="toggle" title="Step the tier down when the frame rate stays low, and back up with headroom">
        <input type="checkbox" checked={auto} onChange={(e) => setLodAuto(e.target.checked)} />
        Adapt to frame rate
      </label>

      <div className="kv-grid">
        <span>Cysts shown</span>
        <b>{stats.cysts}</b>
        <span>Bradyzoites drawn</span>
        <b>
          {stats.drawn.toLocaleString()} <span className="muted">of {stats.total.toLocaleString()}</span>
        </b>
        <span>Tier budget</span>
        <b>{budget.toLocaleString()}</b>
      </div>
      {capped && (
        <div className="gem-note">
          The {TIER_LABEL[tier].toLowerCase()} tier draws a share of each cyst’s bradyzoites (and none in cysts under
          12 µm). The simulation’s counts are unchanged.
        </div>
      )}
      {stress > 0 && (
        <div className="gem-note tone-warn">
          Stress test: {stress} synthetic cysts (<code>?stress={stress}</code>), not from the simulation.
        </div>
      )}

      <div className="status-label">Drawn at true size</div>
      <div className="habit-list">
        <div className="habit-row">
          <span className="swatch" style={{ background: SLICE_PALETTES[niche].cell }} />
          <span className="habit-name">Host cell</span>
          <span className="habit-pct">{2 * CELL_RADIUS} µm</span>
        </div>
        <div className="habit-row">
          <span className="swatch" style={{ background: STAGE_DEFS.tissueCyst.color }} />
          <span className="habit-name">Young cyst</span>
          <span className="habit-pct">{CYST_MIN_DIAMETER} µm</span>
        </div>
        <div className="habit-row">
          <span className="swatch" style={{ background: STAGE_DEFS.tissueCyst.color }} />
          <span className="habit-name">Mature cyst (≥ {MATURE_CYST_BRADYZOITES})</span>
          <span className="habit-pct">→ {CYST_MAX_DIAMETER} µm</span>
        </div>
        <div className="habit-row">
          <span className="swatch" style={{ background: STAGE_DEFS.bradyzoite.color }} />
          <span className="habit-name">Bradyzoite</span>
          <span className="habit-pct">
            {STAGE_DEFS.bradyzoite.length} × {STAGE_DEFS.bradyzoite.width} µm
          </span>
        </div>
        <div className="habit-row">
          <span className="swatch" style={{ background: '#e9d8ff' }} />
          <span className="habit-name">Cyst wall</span>
          <span className="habit-pct">&lt; {CYST_WALL_MAX} µm</span>
        </div>
      </div>
    </div>
  )
}
