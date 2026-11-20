import { useEffect, useState } from 'react'
import { useSimStore } from '../stores/simStore'
import {
  FILE_COUNT,
  SEASON_DAYS,
  seasonIndex,
  seasonPhase,
  stemMetrics,
  tissueSpecies,
  tissueStatus,
  type LimitingFactor,
  type StemMetrics,
  type TissueStatus,
  type TissueStatusId,
} from '../simulation/TissueGrowth'
import { HEX, TISSUE_INFO } from './cellular/palette'

interface Snapshot {
  metrics: StemMetrics
  status: TissueStatus
  season: number
  dayInSeason: number
  divisions: number
}

function read(): Snapshot {
  const { tissue, weather, waterStatus } = useSimStore.getState()
  const env = { temperature: weather.temperature, light: weather.light, water: waterStatus }
  return {
    metrics: stemMetrics(tissue),
    status: tissueStatus(tissue, env),
    season: seasonIndex(tissue.t),
    dayInSeason: seasonPhase(tissue.t) * SEASON_DAYS,
    divisions: tissue.divisions,
  }
}

/**
 * The tissue changes every tick but a person only needs a few readings a second,
 * so the panel samples the store on a timer instead of re-rendering per frame.
 */
function useTissueSnapshot(): Snapshot {
  const [snap, setSnap] = useState(read)
  useEffect(() => {
    const id = setInterval(() => setSnap(read()), 200)
    return () => clearInterval(id)
  }, [])
  return snap
}

const STATUS_LABEL: Record<TissueStatusId, string> = {
  active: 'Dividing freely',
  slowed: 'Slowed',
  arrested: 'Arrested',
  dormant: 'Dormant',
}

const STATUS_COLOR: Record<TissueStatusId, string> = {
  active: '#4ade80',
  slowed: '#fbbf24',
  arrested: '#f87171',
  dormant: '#7dd3fc',
}

/** Why the cambium is where it is, in a sentence a first-time viewer can act on. */
function explain(status: TissueStatus): string {
  const why: Record<LimitingFactor, string> = {
    none: 'Conditions are mixed, so the cambium is running below full speed.',
    water:
      status.id === 'arrested'
        ? 'Drought: without turgor pressure the cambial cells stop at the G2/M checkpoint and no cell divides. Add rain to restart them.'
        : 'Water-limited: cells divide slowly and cannot swell, so the ring comes out narrow with small cells.',
    cold:
      status.id === 'arrested'
        ? 'Too cold: the cambium is shut and cells wait at their checkpoints. Warm it up to resume.'
        : 'Cool: the cell cycle runs slowly and new cells harden late.',
    heat:
      status.id === 'arrested'
        ? 'Too hot: the cambium has shut down to protect itself.'
        : 'Hot: heat stress is slowing the cell cycle.',
    dark: 'Low light: less sugar from the leaves, so fewer new cells can be built.',
  }
  if (status.id === 'dormant') {
    return 'Season over: the cambium rests. Small, thick-walled latewood cells mark the ring boundary until the next season starts.'
  }
  if (status.id === 'active') {
    return 'Warm, wet and bright: cambial cells divide on schedule, laying wood inwards and bark outwards.'
  }
  return why[status.limiting]
}

const meterColor = (v: number) => (v > 0.6 ? '#4ade80' : v > 0.3 ? '#fbbf24' : '#f87171')

function Meter({ label, value, hint }: { label: string; value: number; hint: string }) {
  return (
    <div className="tissue-meter" title={hint}>
      <div className="tissue-meter-head">
        <span>{label}</span>
        <b>{Math.round(value * 100)}%</b>
      </div>
      <div className="bar-track">
        <div className="bar-fill" style={{ width: `${value * 100}%`, background: meterColor(value) }} />
      </div>
    </div>
  )
}

const CYCLE_SEGMENTS: { key: 'G1' | 'S' | 'G2' | 'M'; color: string; hint: string }[] = [
  { key: 'G1', color: HEX.nucleusG1, hint: 'Growth: the cell grows and the nucleus is small' },
  { key: 'S', color: HEX.nucleusS, hint: 'DNA is copied' },
  { key: 'G2', color: HEX.nucleusG2, hint: 'Checkpoint: the cell checks it has enough turgor and energy to divide' },
  { key: 'M', color: HEX.chromosome, hint: 'Mitosis: chromosomes line up, separate, and a new wall forms' },
]

/**
 * Glanceable status card over the viewport: what the cambium is doing right now,
 * why, and how fast. The sidebar `TissuePanel` carries the reference material.
 */
export function TissueHud() {
  const { metrics, status } = useTissueSnapshot()
  const r = status.response
  const counts = {
    G1: metrics.phaseCounts.G1,
    S: metrics.phaseCounts.S,
    G2: metrics.phaseCounts.G2,
    M: metrics.mitotic,
  }

  return (
    <div className="tissue-hud">
      <div className="tissue-status" style={{ borderColor: STATUS_COLOR[status.id] }}>
        <span className="tissue-dot" style={{ background: STATUS_COLOR[status.id] }} />
        <div>
          <b style={{ color: STATUS_COLOR[status.id] }}>Cambium: {STATUS_LABEL[status.id].toLowerCase()}</b>
          <p>{explain(status)}</p>
        </div>
      </div>

      <div className="tissue-hud-col">
        <Meter
          label="Cell division"
          value={status.id === 'dormant' ? 0 : r.activity}
          hint="Cambial cell-cycle speed: warmth × sugar supply × turgor"
        />
        <Meter
          label="Cell enlargement"
          value={r.expansion}
          hint="Turgor-driven swelling of new cells. The first thing to go in drought."
        />
      </div>

      <div className="tissue-hud-col">
        <div className="tissue-meter-head">
          <span>Cambial cells by cycle stage</span>
          <b>{FILE_COUNT} files</b>
        </div>
        <div className="tissue-cycle-bar">
          {CYCLE_SEGMENTS.map((s) =>
            counts[s.key] > 0 ? (
              <span
                key={s.key}
                title={s.hint}
                style={{ flexGrow: counts[s.key], background: s.color, color: s.key === 'M' ? '#2a2000' : '#e8fbff' }}
              >
                {s.key}
              </span>
            ) : null,
          )}
        </div>
        <div className="tissue-cycle-key">G1 grow · S copy DNA · G2 checkpoint · M divide</div>
      </div>
    </div>
  )
}

export function TissuePanel() {
  const species = useSimStore((s) => s.species)
  const { metrics, season, dayInSeason, divisions } = useTissueSnapshot()
  const sp = tissueSpecies(species)

  return (
    <div className="panel tissue-panel">
      <h3>
        Stem tissue <span className="muted">cross-section</span>
      </h3>

      <div className="tissue-kv">
        <span>Season</span>
        <b>
          Ring {season + 1} · day {Math.floor(dayInSeason)}/{SEASON_DAYS}
        </b>
        <span>Stem diameter</span>
        <b>{((metrics.stemRadius * 2) / 1000).toFixed(2)} mm</b>
        <span>Completed rings</span>
        <b>{metrics.ringsComplete}</b>
        <span>Last ring width</span>
        <b>{metrics.ringsComplete > 0 ? `${metrics.lastRingWidth.toFixed(0)} µm` : '—'}</b>
        <span>Cell divisions</span>
        <b>{divisions.toLocaleString()}</b>
      </div>

      <div className="tissue-legend">
        {(['xylem', 'cambium', 'phloem', 'cortex', 'epidermis', 'pith'] as const).map((k) => (
          <div key={k} className="tissue-legend-row">
            <span className="swatch" style={{ background: TISSUE_INFO[k].color }} />
            <span>
              <b>{TISSUE_INFO[k].label}</b> — {TISSUE_INFO[k].role}
            </span>
          </div>
        ))}
        <div className="tissue-legend-row">
          <span className="swatch round" style={{ background: HEX.water }} />
          <span>
            <b>Vessel</b> — open pipe; blue when full of water, white when drought lets air in
          </span>
        </div>
        <div className="tissue-legend-row">
          <span className="swatch" style={{ background: HEX.chromosome }} />
          <span>
            <b>Mitosis</b> — chromosomes line up, split to the two faces, and a white cell plate grows between them
          </span>
        </div>
        <div className="tissue-legend-row">
          <span className="swatch" style={{ background: HEX.boundary }} />
          <span>
            <b>Growth ring</b> — pale line where one season&apos;s wood ends and the next begins
          </span>
        </div>
      </div>

      <p className="tissue-note">{sp.note}</p>
    </div>
  )
}
