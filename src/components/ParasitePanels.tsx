/**
 * Sidebar panels for parasite mode.
 *
 * Mirrors the plant `WeatherPanel` / gem `GeologyPanel` split: one panel for the
 * environment the player drives (host immunity and stress), one for the
 * objective, and one for reference material about what is on screen.
 */

import { useParasiteStore } from '../stores/parasiteStore'
import {
  leverToPh,
  NICHES,
  NICHE_DEFS,
  type EffectorFlags,
} from '../simulation/parasite/hostImmunity'
import { bfdPhase, effectiveImmunity } from '../simulation/parasite/bfdSwitch'
import { EGRESS_PHASE_LABEL } from '../simulation/parasite/egress'
import { MJ_PHASE_DEFS } from '../simulation/parasite/invasion'
import { MODIFIER_DEFS, PARASITE_SPECIES } from '../simulation/parasite/modifiers'
import { LIFE_CYCLE } from '../simulation/parasite/lifeCycleGraph'
import {
  OBJECTIVE_IDS,
  OBJECTIVES,
  objectiveBlocked,
  type ObjectiveId,
} from '../simulation/parasite/objectives'
import { COMPARTMENT_LABEL, STAGE_DEFS } from '../simulation/parasite/stages'
import { availablePassage, MATURE_CYST_BRADYZOITES } from '../simulation/parasite/world'
import { useSliceViewStore } from '../stores/sliceViewStore'
import type { ParasiteViewScale } from './ParasiteViewer'

const pct = (x: number) => `${Math.round(x * 100)}%`

const EFFECTOR_LABELS: { key: keyof EffectorFlags; name: string; detail: string }[] = [
  { key: 'rop16', name: 'ROP16', detail: 'Phosphorylates STAT3/6 → M2 macrophages, ↓IL-12, ↓NO, ↓ROS' },
  { key: 'rop18rop5', name: 'ROP18 + ROP5', detail: 'Blocks IRG oligomerisation on the vacuole membrane' },
  { key: 'tgist', name: 'TgIST', detail: 'Recruits Mi-2/NuRD in the host nucleus → represses STAT1/IFN-γ' },
]

// ---------------------------------------------------------------------------

/** Host immunity, tissue niche and the stressors that drive the BFD1 switch. */
export function HostPanel() {
  const config = useParasiteStore((s) => s.config)
  const host = useParasiteStore((s) => s.world.host)
  const compartment = useParasiteStore((s) => s.world.compartment)
  const setConfig = useParasiteStore((s) => s.setConfig)
  const setStress = useParasiteStore((s) => s.setStress)
  const setEffector = useParasiteStore((s) => s.setEffector)
  const setNicheFocus = useParasiteStore((s) => s.setNicheFocus)

  const immunity = effectiveImmunity(host.fields.ifnGamma, host.fields.irg)
  const inEnvironment = compartment === 'environment'

  return (
    <div className="panel host-panel">
      <h3>{inEnvironment ? 'Soil & water' : 'Host & immunity'}</h3>

      {inEnvironment ? (
        <>
          <p className="gem-blurb">
            No host, no metabolism — only weathering. Cool, moist soil is what keeps oocysts infectious
            for months.
          </p>
          <div className="control">
            <label>
              Temperature
              <span className="val">{config.temperature.toFixed(0)} °C</span>
            </label>
            <input
              type="range"
              min={-5}
              max={45}
              step={1}
              value={config.temperature}
              onChange={(e) => setConfig({ temperature: +e.target.value })}
            />
          </div>
          <div className="control">
            <label>
              Moisture
              <span className="val">
                {pct(config.moisture)} <span className="muted">O₂ for sporulation</span>
              </span>
            </label>
            <input
              type="range"
              min={0}
              max={1}
              step={0.01}
              value={config.moisture}
              onChange={(e) => setConfig({ moisture: +e.target.value })}
            />
          </div>
        </>
      ) : (
        <>
          <div className="status-bar">
            <div className="status-label">Host health</div>
            <div className="bar-track">
              <div
                className="bar-fill"
                style={{
                  width: `${host.health * 100}%`,
                  background: host.health > 0.6 ? '#4ade80' : host.health > 0.25 ? '#fbbf24' : '#f87171',
                }}
              />
            </div>
          </div>

          <div className="field-grid">
            <FieldBar label="IL-12" value={host.fields.il12} color="#60a5fa" />
            <FieldBar label="IFN-γ" value={host.fields.ifnGamma} color="#fbbf24" />
            <FieldBar label="IRG" value={host.fields.irg} color="#f87171" />
            <FieldBar label="NO" value={host.fields.no} color="#a78bfa" />
            <FieldBar label="ROS" value={host.fields.ros} color="#fb923c" />
            <FieldBar label="M2" value={host.m2} color="#34d399" />
          </div>
          <div className={`gem-status ${host.collapsed ? 'tone-bad' : immunity > 0.3 ? 'tone-good' : 'tone-warn'}`}>
            {host.collapsed
              ? 'Immunity collapsed — cysts can reactivate'
              : `Effective immunity ${pct(immunity)}`}
          </div>

          <div className="control">
            <label title="Drugs, co-infection, HIV — the real reactivation trigger">
              Immunosuppression
              <span className="val">{pct(config.immunosuppression)}</span>
            </label>
            <input
              type="range"
              min={0}
              max={1}
              step={0.01}
              value={config.immunosuppression}
              onChange={(e) => setConfig({ immunosuppression: +e.target.value })}
            />
          </div>

          <div className="status-label">Stressors → BFD1 translation</div>
          <div className="control">
            <label>
              Alkaline shift
              <span className="val">pH {leverToPh(config.stress.alkaline).toFixed(1)}</span>
            </label>
            <input
              type="range"
              min={0}
              max={1}
              step={0.01}
              value={config.stress.alkaline}
              onChange={(e) => setStress({ alkaline: +e.target.value })}
            />
          </div>
          <div className="control">
            <label>
              Nutrient deprivation
              <span className="val">{pct(config.stress.starvation)}</span>
            </label>
            <input
              type="range"
              min={0}
              max={1}
              step={0.01}
              value={config.stress.starvation}
              onChange={(e) => setStress({ starvation: +e.target.value })}
            />
          </div>
          <div className="control">
            <label>
              Heat shock
              <span className="val">{(37 + config.stress.heatShock * 6).toFixed(1)} °C</span>
            </label>
            <input
              type="range"
              min={0}
              max={1}
              step={0.01}
              value={config.stress.heatShock}
              onChange={(e) => setStress({ heatShock: +e.target.value })}
            />
          </div>

          <div className="status-label">Secreted effectors</div>
          <div className="toggle-column">
            {EFFECTOR_LABELS.map((e) => (
              <label className="toggle" key={e.key} title={e.detail}>
                <input
                  type="checkbox"
                  checked={config.effectors[e.key]}
                  onChange={(ev) => setEffector(e.key, ev.target.checked)}
                />
                {e.name}
              </label>
            ))}
          </div>

          <div className="status-label">Niche focus</div>
          <div className="niche-row">
            {NICHES.map((id) => (
              <button
                key={id}
                className={`niche-btn ${config.nicheFocus === id ? 'active' : ''}`}
                style={{ borderColor: config.nicheFocus === id ? NICHE_DEFS[id].color : undefined }}
                onClick={() => setNicheFocus(id)}
                title={NICHE_DEFS[id].note}
              >
                <span className="swatch" style={{ background: NICHE_DEFS[id].color }} />
                {NICHE_DEFS[id].name}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  )
}

function FieldBar({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div className="field">
      <span className="field-label">{label}</span>
      <span className="field-bar">
        <span style={{ width: `${Math.min(1, value) * 100}%`, background: color }} />
      </span>
    </div>
  )
}

// ---------------------------------------------------------------------------

/** Objective picker, progress, transmission route and the event log. */
export function ObjectivePanel() {
  const objective = useParasiteStore((s) => s.objective)
  const progress = useParasiteStore((s) => s.progress)
  const config = useParasiteStore((s) => s.config)
  const world = useParasiteStore((s) => s.world)
  const setObjective = useParasiteStore((s) => s.setObjective)
  const passage = useParasiteStore((s) => s.passage)
  const reset = useParasiteStore((s) => s.reset)

  const def = OBJECTIVES[objective]
  const blocked = objectiveBlocked(objective, config.modifiers)
  const route = availablePassage(world, config)
  const log = world.log.slice(-7).reverse()

  return (
    <div className="panel objective-panel">
      <h3>Objective</h3>

      <select
        className="objective-select"
        value={objective}
        onChange={(e) => setObjective(e.target.value as ObjectiveId)}
      >
        {OBJECTIVE_IDS.map((id) => (
          <option key={id} value={id}>
            {OBJECTIVES[id].name}
          </option>
        ))}
      </select>

      <p className="gem-blurb">{def.brief}</p>
      <p className="objective-how">{def.how}</p>

      <div className="status-bar">
        <div className="bar-track">
          <div
            className="bar-fill"
            style={{
              width: `${progress.progress * 100}%`,
              background:
                progress.status === 'won' ? '#4ade80' : progress.status === 'lost' ? '#f87171' : '#5eead4',
            }}
          />
        </div>
        <div className="objective-metric">{progress.metric}</div>
      </div>

      {progress.status !== 'active' && (
        <div className={`objective-result ${progress.status}`}>
          <strong>{progress.status === 'won' ? 'Objective complete' : 'Run over'}</strong>
          <span>{progress.reason}</span>
          <button className="btn primary" onClick={reset}>
            ↺ Run it again
          </button>
        </div>
      )}

      {blocked && <div className="gem-note tone-warn">{blocked}</div>}

      <ul className="objective-detail">
        {progress.detail.map((d) => (
          <li key={d}>{d}</li>
        ))}
      </ul>

      {route && (
        <button className="btn passage-btn" onClick={passage} title={route.detail}>
          {route.label}
          <span className="passage-detail">{route.detail}</span>
        </button>
      )}

      <div className="status-label">Event log</div>
      <ul className="event-log">
        {log.map((e) => (
          <li key={e.id} className={`event ${e.kind}`}>
            <span className="event-hour">{formatHours(e.hour)}</span>
            {e.text}
          </li>
        ))}
        {log.length === 0 && <li className="event muted">Nothing has happened yet.</li>}
      </ul>
    </div>
  )
}

function formatHours(h: number): string {
  if (h < 24) return `${h.toFixed(0)} h`
  if (h < 24 * 90) return `${(h / 24).toFixed(1)} d`
  return `${(h / (24 * 30)).toFixed(1)} mo`
}

// ---------------------------------------------------------------------------

/** Reference panel: what is on screen, the challenge modifiers, the FSM. */
export function ParasiteInfoPanel({ scale }: { scale: ParasiteViewScale }) {
  const config = useParasiteStore((s) => s.config)
  const world = useParasiteStore((s) => s.world)
  const setModifier = useParasiteStore((s) => s.setModifier)
  const setForceEgress = useParasiteStore((s) => s.setForceEgress)

  const species = PARASITE_SPECIES[config.species]
  const infected = world.cells.filter((c) => c.pv)
  const focus = infected.reduce<(typeof infected)[number] | null>(
    (best, c) => (!best || (c.pv?.parasites ?? 0) > (best.pv?.parasites ?? 0) ? c : best),
    null,
  )
  const invading = world.agents.find((a) => a.mj)
  const locked = species.modifiers.lockedLatency

  return (
    <div className="panel parasite-info">
      <h3>
        {species.short} <span className="muted">{COMPARTMENT_LABEL[world.compartment]}</span>
      </h3>
      <p className="gem-blurb">{species.mechanic}</p>

      <div className="kv-grid">
        <span>Definitive host</span>
        <b>{species.definitiveHost}</b>
        <span>Intermediate</span>
        <b>{species.intermediateHost}</b>
        <span>Vertical</span>
        <b>{species.vertical}</b>
      </div>

      {scale === 'cell' && focus?.pv && (
        <>
          <div className="status-label">This vacuole</div>
          <div className="kv-grid">
            <span>Niche</span>
            <b>{NICHE_DEFS[focus.niche].name}</b>
            <span>Parasites</span>
            <b>
              {focus.pv.parasites} <span className="muted">gen {focus.pv.generations}</span>
            </b>
            <span>BFD1 switch</span>
            <b>
              {bfdPhase(focus.pv.bfd)} <span className="muted">{pct(focus.pv.bfd.bfd1)}</span>
            </b>
            <span>Vacuolar pH</span>
            <b>{focus.pv.egress.ph.toFixed(2)}</b>
            <span>Egress</span>
            <b>{EGRESS_PHASE_LABEL[focus.pv.egress.phase]}</b>
            <span>TgPLP1 pores</span>
            <b>{Math.floor(focus.pv.egress.pores)}</b>
          </div>
        </>
      )}

      {invading?.mj && (
        <>
          <div className="status-label">Moving junction</div>
          <div className="mj-steps">
            {Object.values(MJ_PHASE_DEFS)
              .filter((p) => p.duration > 0)
              .map((p) => (
                <div
                  key={p.id}
                  className={`mj-step ${invading.mj!.phase === p.id ? 'active' : ''}`}
                  title={p.note}
                >
                  {p.name}
                </div>
              ))}
          </div>
          {invading.mj.failure && <div className="gem-note tone-bad">{invading.mj.failure}</div>}
        </>
      )}

      {(scale === 'tissue' || scale === 'slice') && (
        <>
          <div className="status-label">Cysts by niche</div>
          <div className="habit-list">
            {NICHES.map((id) => (
              <div key={id} className="habit-row">
                <span className="swatch" style={{ background: NICHE_DEFS[id].color }} />
                <span className="habit-name">{NICHE_DEFS[id].name}</span>
                <span className="habit-pct">{world.tally.cystsByNiche[id]}</span>
              </div>
            ))}
          </div>
          <div className="gem-note">
            Mature at ≥ {MATURE_CYST_BRADYZOITES} bradyzoites · wall under 0.5 µm
          </div>
        </>
      )}

      {scale === 'environment' && (
        <div className="kv-grid">
          <span>Oocysts tracked</span>
          <b>{world.oocysts.length}</b>
          <span>Sporulated</span>
          <b>{world.tally.sporulatedOocysts}</b>
          <span>Oldest shelf age</span>
          <b>
            {(
              Math.max(0, ...world.oocysts.filter((o) => o.sporulated).map((o) => o.shelfHours)) / 24
            ).toFixed(0)}{' '}
            d
          </b>
          <span>Shed this run</span>
          <b>{world.tally.oocystsShed.toLocaleString()}</b>
        </div>
      )}

      {scale === 'organelle' && (
        <div className="kv-grid">
          <span>Subpellicular MTs</span>
          <b>22 from the apical polar ring</b>
          <span>Conoid</span>
          <b>14 fibres · 400 × 250 nm</b>
          <span>Apicoplast</span>
          <b>35 kb genome · maternal only</b>
          <span>Dense granules</span>
          <b>~244 nm</b>
        </div>
      )}

      <div className="status-label">Challenge modifiers</div>
      <div className="toggle-column">
        {MODIFIER_DEFS.map((m) => {
          const forced = m.id === 'lockedLatency' && locked
          return (
            <label className="toggle" key={m.id} title={`${m.gene} — ${m.effect}`}>
              <input
                type="checkbox"
                checked={config.modifiers[m.id] || forced}
                disabled={forced}
                onChange={(e) => setModifier(m.id, e.target.checked)}
              />
              {m.name}
              {forced && <span className="muted"> (species)</span>}
            </label>
          )
        })}
        <label className="toggle" title="Force every vacuole into the egress cascade now">
          <input
            type="checkbox"
            checked={config.forceEgress}
            onChange={(e) => setForceEgress(e.target.checked)}
          />
          Force egress
        </label>
      </div>

      <div className="status-label">Stage reference</div>
      <div className="habit-list">
        {(['tachyzoite', 'bradyzoite', 'tissueCyst', 'sporulatedOocyst', 'sporozoite'] as const).map((id) => {
          const s = STAGE_DEFS[id]
          return (
            <div key={id} className="habit-row" title={s.note}>
              <span className="swatch" style={{ background: s.color }} />
              <span className="habit-name">{s.name}</span>
              <span className="habit-pct">
                {s.length === s.width ? `${s.length} µm` : `${s.length} × ${s.width} µm`}
              </span>
            </div>
          )
        })}
      </div>

      <details className="fsm-details">
        <summary>Life-cycle transitions</summary>
        <ul className="fsm-list">
          {LIFE_CYCLE.map((t) => (
            <li key={t.id}>
              <b>{t.name}</b>
              <span>{t.note}</span>
            </li>
          ))}
        </ul>
      </details>
    </div>
  )
}

/**
 * In-viewport hint for views that are legitimately empty — the soil before any
 * oocyst has been shed, tissue views during the environmental phase, the
 * cell view before a vacuole exists. Without it an empty scene reads as a bug.
 */
export function ParasiteViewportHint({ scale }: { scale: ParasiteViewScale }) {
  const compartment = useParasiteStore((s) => s.world.compartment)
  const oocysts = useParasiteStore((s) => s.world.oocysts.length)
  const infected = useParasiteStore((s) => s.world.cells.filter((c) => c.pv).length)
  const free = useParasiteStore((s) => s.world.agents.length)
  const cysts = useParasiteStore((s) => s.world.tally.cysts)
  // a stress-test garden is drawn without any cysts in the sim
  const stress = useSliceViewStore((s) => s.stress)

  let hint: string | null = null
  if (scale === 'environment' && oocysts === 0) {
    hint =
      compartment === 'environment'
        ? 'Every oocyst in this cohort has weathered away.'
        : 'No oocysts in the soil yet. They appear here once a felid completes the sexual cycle and sheds.'
  } else if ((scale === 'tissue' || scale === 'slice' || scale === 'cell') && compartment === 'environment') {
    hint = 'This is the environmental phase — there is no host. Infect a new one from the objective panel.'
  } else if (scale === 'slice' && cysts === 0 && stress === 0) {
    hint =
      'No tissue cysts yet. Stress a vacuole — alkaline shift, nutrient deprivation or heat shock — and it converts and walls itself off; the cyst appears here and grows.'
  } else if (scale === 'cell' && infected === 0) {
    hint =
      free > 0
        ? 'No vacuole yet. A parasite has to finish a moving junction before there is anything to see here.'
        : 'Nothing is infecting anything right now.'
  }

  if (!hint) return null
  return (
    <div className="viewport-hint">
      <p>{hint}</p>
    </div>
  )
}
