import { useEffect, useState } from 'react'
import { useSimStore } from '../stores/simStore'
import { useModeStore } from '../stores/modeStore'
import {
  largestGeode,
  noduleLabel,
  rootSystem,
  soilMetrics,
  SOIL_PROFILE_IDS,
  SOIL_PROFILES,
  type SoilMetrics,
  type SoilNodule,
} from '../simulation/SoilField'
import { OVERLAYS, overlayGradient, SOIL_OVERLAY_IDS, MINERAL_HEX, type SoilOverlay } from './soil/palette'

interface Snapshot {
  metrics: SoilMetrics
  rootDepth: number
  blockedAt: number | null
  supply: number
  nutrient: number
  pco2: number
  demand: number
  uptake: number
  evaporation: number
  drainage: number
  geode: SoilNodule | null
  temperature: number
}

function read(): Snapshot {
  const { soil, weather, waterStatus } = useSimStore.getState()
  const activity = Math.max(0, 1 - Math.abs(weather.temperature - 22) / 25) * waterStatus
  return {
    metrics: soilMetrics(soil, activity),
    rootDepth: soil.rootDepth,
    blockedAt: soil.blockedAt,
    supply: soil.supply,
    nutrient: soil.nutrient,
    pco2: soil.pco2,
    demand: soil.demand,
    uptake: soil.uptake,
    evaporation: soil.evaporation,
    drainage: soil.drainage,
    geode: largestGeode(soil),
    temperature: soil.temperature,
  }
}

/** The soil changes every tick; a person needs a few readings a second. */
function useSoilSnapshot(): Snapshot {
  const [snap, setSnap] = useState(read)
  useEffect(() => {
    const id = setInterval(() => setSnap(read()), 200)
    return () => clearInterval(id)
  }, [])
  return snap
}

const pct = (v: number) => `${Math.round(v * 100)}%`

/** What the soil is doing to the plant right now, and what to try. */
function explain(s: Snapshot, profileName: string): string {
  const m = s.metrics
  if (s.blockedAt !== null)
    return `A cemented hardpan at ${s.blockedAt.toFixed(2)} m stops the main root, so the plant can only draw on the water above it and dries out sooner.`
  if (s.nutrient < 0.8)
    return 'Calcium is short in the root zone: heavy rain has leached it below the roots faster than weathering and the clay exchange pool can resupply it. Growth slows until it recovers.'
  if (s.supply < 0.7)
    return 'The roots cannot pull water fast enough from the drying soil. They take water but leave the minerals behind, so the rhizosphere is concentrating.'
  if (m.silicaS > 1.03 || m.calciteS > 1.03)
    return `The root zone is supersaturated (S > 1): minerals are precipitating as cement and as nodules nucleating on the roots. ${m.calciteS > 1.03 ? 'Root CO₂ falls as the plant slows, which drops calcite out on the roots.' : ''}`
  if (m.rootZoneMoisture > 0.7)
    return 'Wet soil: water percolates down through the root zone, dissolving minerals and carrying them deeper. Stop the rain and let the plant dry it to start precipitation.'
  return `${profileName}: minerals are dissolving from the parent material into the pore water. Dry spells concentrate them around the roots.`
}

function Meter({ label, value, hint }: { label: string; value: number; hint: string }) {
  const c = value > 0.6 ? '#4ade80' : value > 0.3 ? '#fbbf24' : '#f87171'
  return (
    <div className="tissue-meter" title={hint}>
      <div className="tissue-meter-head">
        <span>{label}</span>
        <b>{pct(value)}</b>
      </div>
      <div className="bar-track">
        <div className="bar-fill" style={{ width: `${value * 100}%`, background: c }} />
      </div>
    </div>
  )
}

interface Props {
  overlay: SoilOverlay
  onOverlay: (o: SoilOverlay) => void
  /** Animated water particles (soil → root → stem) on or off. */
  flow: boolean
  onFlow: (on: boolean) => void
}

export function SoilPanel({ overlay, onOverlay, flow, onFlow }: Props) {
  const profileId = useSimStore((s) => s.soilProfile)
  const setProfile = useSimStore((s) => s.setSoilProfile)
  const species = useSimStore((s) => s.species)
  const setGemstone = useSimStore((s) => s.setGemstone)
  const setMode = useModeStore((s) => s.setMode)
  const snap = useSoilSnapshot()
  const profile = SOIL_PROFILES[profileId]
  const roots = rootSystem(species)
  const m = snap.metrics
  const ov = OVERLAYS[overlay]

  const openGeode = () => {
    setGemstone('amethyst')
    setMode('gem')
  }

  return (
    <div className="panel soil-panel">
      <h3>
        Soil &amp; minerals <span className="muted">root zone</span>
      </h3>

      <div className="soil-profiles" role="radiogroup" aria-label="Soil parent material">
        {SOIL_PROFILE_IDS.map((id) => (
          <button
            key={id}
            role="radio"
            aria-checked={id === profileId}
            className={`soil-chip ${id === profileId ? 'active' : ''}`}
            onClick={() => setProfile(id)}
            title={SOIL_PROFILES[id].parent}
          >
            {SOIL_PROFILES[id].name}
          </button>
        ))}
      </div>
      <p className="tissue-note">{profile.blurb}</p>

      <div className="tissue-status soil-status">
        <span className="tissue-dot" style={{ background: snap.supply > 0.7 && snap.nutrient > 0.8 ? '#4ade80' : '#fbbf24' }} />
        <p>{explain(snap, profile.name)}</p>
      </div>

      <Meter label="Water supply to the plant" value={snap.supply} hint="Root water uptake ÷ transpiration demand. Drives the plant's water status." />
      <Meter label="Calcium nutrition" value={snap.nutrient} hint="Root-zone dissolved calcium vs what the plant needs. Scales growth." />

      <div className="tissue-kv">
        <span>Root front</span>
        <b>
          {snap.rootDepth.toFixed(2)} m <span className="muted">/ {roots.maxDepth} m {roots.kind}</span>
        </b>
        <span>Root-zone water</span>
        <b>{pct(m.rootZoneMoisture)}</b>
        <span>Silica S · calcite S</span>
        <b>
          {m.silicaS.toFixed(2)} · {m.calciteS.toFixed(2)}
        </b>
        <span>Root CO₂ (vs bare soil)</span>
        <b>×{snap.pco2.toFixed(1)}</b>
        <span>Cement (max)</span>
        <b>
          {pct(m.maxCement)}
          {m.cementDepth !== null && <span className="muted"> from {m.cementDepth.toFixed(2)} m</span>}
        </b>
        <span>Nodules</span>
        <b>
          <span style={{ color: MINERAL_HEX.silica }}>{m.nodules.silica} silica</span> ·{' '}
          <span style={{ color: MINERAL_HEX.calcite }}>{m.nodules.calcite} calcite</span>
        </b>
        <span>Largest</span>
        <b>{m.largest ? `${noduleLabel(m.largest)}, ${(m.largest.radius * 2).toFixed(0)} mm` : '—'}</b>
        <span>Transpiration · uptake</span>
        <b>
          {snap.demand.toFixed(1)} · {snap.uptake.toFixed(1)} <span className="muted">mm/d</span>
        </b>
        <span>Evaporation · drainage</span>
        <b>
          {snap.evaporation.toFixed(1)} · {snap.drainage.toFixed(1)} <span className="muted">mm/d</span>
        </b>
        <span>Soil temperature</span>
        <b>{snap.temperature.toFixed(1)}°C</b>
      </div>

      <div className="soil-overlay">
        <div className="soil-chips">
          {SOIL_OVERLAY_IDS.map((id) => (
            <button key={id} className={`soil-chip small ${id === overlay ? 'active' : ''}`} onClick={() => onOverlay(id)}>
              {OVERLAYS[id].label}
            </button>
          ))}
        </div>
        <div className="soil-ramp" style={{ background: overlayGradient(overlay) }} />
        <div className="soil-ramp-ticks">
          {ov.ticks.map((t, i) => (
            <span key={i}>{t}</span>
          ))}
        </div>
        <p className="tissue-note">{ov.hint}</p>
        <label className="soil-toggle">
          <input type="checkbox" checked={flow} onChange={(e) => onFlow(e.target.checked)} />
          <span>Show water flow</span>
        </label>
        {flow && (
          <div className="tissue-legend-row">
            <span className="swatch round soil-water-dot" />
            <span>
              <b>Water</b> — each dot is water a root is drawing right now: it leaves the soil where the uptake is, runs up the roots
              (laterals merge into the main root) and rises up the stem to the canopy. A thicker stream means a higher flux — it thins
              out as the soil dries, in the dark, or behind a hardpan.
            </span>
          </div>
        )}
        <div className="tissue-legend-row">
          <span className="swatch round" style={{ background: MINERAL_HEX.silica }} />
          <span>
            <b>Silica nodule</b> — chert; one that nucleated on a root and grew past 2 cm is a hollow, quartz-lined root-channel geode
          </span>
        </div>
        <div className="tissue-legend-row">
          <span className="swatch round" style={{ background: MINERAL_HEX.calcite }} />
          <span>
            <b>Calcite</b> — rhizoliths (calcified root sheaths) on roots, nodules in open soil
          </span>
        </div>
      </div>

      <button className="btn soil-geode-btn" disabled={!snap.geode} onClick={openGeode}>
        {snap.geode ? 'Grow its quartz lining in Gem mode →' : 'No geode yet — dry the ash soil around the roots'}
      </button>
      <p className="tissue-note">
        Mineral time is compressed like the gem sim: real calcretes and geodes take centuries. Gem mode grows the amethyst
        that lines a geode cavity at lab-synthesis rates.
      </p>
    </div>
  )
}
