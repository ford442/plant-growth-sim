/**
 * The game layer over the parasite viewport (epic #3, issue #5/#7).
 *
 * Three things the player needs while a run is going, and nothing else: how the
 * host is doing, what the objective wants, and which effectors they can fire
 * right now. Everything reference-shaped stays in the sidebar panels.
 *
 * Like `TissueHud`, this samples the store on a timer rather than subscribing
 * to per-tick values: host fields and cooldowns change on every one of the 60
 * fixed steps a second, and a person needs a few readings a second. The one
 * exception is the win/lose modal, which subscribes to `progress.status` — a
 * primitive that changes once per run, so it lands on the frame it happens.
 */

import { useEffect, useState } from 'react'
import {
  ABILITY_DEFS,
  ABILITY_IDS,
  abilityAvailability,
  type AbilityId,
} from '../../simulation/parasite/abilities'
import { effectiveImmunity } from '../../simulation/parasite/bfdSwitch'
import { reservoirCysts } from '../../simulation/parasite/objectives'
import { DEFAULT_TUNING } from '../../simulation/parasite/tuning'
import { useParasiteStore } from '../../stores/parasiteStore'

interface Snap {
  inHost: boolean
  health: number
  immunity: number
  ifn: number
  no: number
  banked: number
  target: number
  day: number
  holdDays: number
  hostFloor: number
  abilities: {
    id: AbilityId
    label: string
    title: string
    state: 'ready' | 'active' | 'cooling' | 'blocked'
    /** 0–1 fill of the button's own bar: time left, or readiness. */
    fill: number
    note: string
  }[]
}

function read(): Snap {
  const { world, config } = useParasiteStore.getState()
  const tuning = config.tuning ?? DEFAULT_TUNING
  const abilities = ABILITY_IDS.map((id) => {
    const def = ABILITY_DEFS[id]
    const s = world.abilities[id]
    const avail = abilityAvailability(id, world.abilities, config.effectors, world.tally.conversions)
    const state = avail.active ? 'active' : avail.ready ? 'ready' : s.cooldownHours > 0 ? 'cooling' : 'blocked'
    return {
      id,
      label: def.name,
      title: `${def.gene}\n${def.effect}\n\n${def.use}\n\n${def.durationHours} h of secretion, then ${def.cooldownHours} h to recharge.${avail.blocked ? `\n\n${avail.blocked}` : ''}`,
      state: state as Snap['abilities'][number]['state'],
      fill:
        state === 'active'
          ? s.activeHours / def.durationHours
          : state === 'cooling'
            ? 1 - s.cooldownHours / def.cooldownHours
            : state === 'ready'
              ? 1
              : 0,
      note:
        state === 'active'
          ? `${s.activeHours.toFixed(1)} h left`
          : state === 'cooling'
            ? `${s.cooldownHours.toFixed(1)} h`
            : state === 'ready'
              ? `ready${s.uses > 0 ? ` · ${s.uses}×` : ''}`
              : avail.carried
                ? 'locked'
                : 'knocked out',
    }
  })
  return {
    inHost: world.compartment !== 'environment',
    health: world.host.health,
    immunity: effectiveImmunity(world.host.fields.ifnGamma, world.host.fields.irg),
    ifn: world.host.fields.ifnGamma,
    no: world.host.fields.no,
    banked: reservoirCysts(world, tuning),
    target: tuning.latentTarget,
    day: world.lesionHours / 24,
    holdDays: tuning.holdDays,
    hostFloor: tuning.hostFloor,
    abilities,
  }
}

function useSnapshot(): Snap {
  const [snap, setSnap] = useState(read)
  useEffect(() => {
    const id = setInterval(() => setSnap(read()), 200)
    return () => clearInterval(id)
  }, [])
  return snap
}

const healthColor = (h: number, floor: number) =>
  h <= floor ? '#f87171' : h < floor + 0.25 ? '#fbbf24' : '#4ade80'

/** Host bars, objective tracker and the ability buttons. */
export function GameHud() {
  const snap = useSnapshot()
  const objective = useParasiteStore((s) => s.objective)
  const fireAbility = useParasiteStore((s) => s.fireAbility)

  // the ability economy and the host bars are meaningless in soil
  if (!snap.inHost) return null

  const primary = objective === 'latentPassage'

  return (
    <div className="game-hud">
      <div className="game-bars">
        <Meter
          label="Host"
          value={snap.health}
          color={healthColor(snap.health, snap.hostFloor)}
          text={`${Math.round(snap.health * 100)}%`}
          marker={snap.hostFloor}
          title={`Host health. Below ${Math.round(snap.hostFloor * 100)}% the run is lost: that is acute disease, not latency.`}
        />
        <Meter
          label="Immunity"
          value={snap.immunity}
          color="#fbbf24"
          text={`${Math.round(snap.immunity * 100)}%`}
          title={`Effective immunity — IFN-γ ${Math.round(snap.ifn * 100)}%, and the IRG that strips vacuoles. It is also the cheapest stress you have: NO is at ${Math.round(snap.no * 100)}%.`}
        />
        {primary && (
          <Meter
            label="Reservoir"
            value={snap.target > 0 ? snap.banked / snap.target : 0}
            color="#5eead4"
            text={`${snap.banked} / ${snap.target}`}
            title={`Intact cysts of ${DEFAULT_TUNING.matureDiameterUm} µm or more in CNS and muscle.`}
          />
        )}
        {primary && (
          <Meter
            label="Day"
            value={snap.holdDays > 0 ? snap.day / snap.holdDays : 0}
            color="#60a5fa"
            text={`${snap.day.toFixed(1)} / ${snap.holdDays}`}
            title="Lesion clock. The objective is judged when it reaches the end of the window."
          />
        )}
      </div>

      <div className="ability-row">
        {snap.abilities.map((a) => (
          <button
            key={a.id}
            className={`ability ${a.state}`}
            style={{ '--ability-color': ABILITY_DEFS[a.id].color } as React.CSSProperties}
            disabled={a.state !== 'ready'}
            onClick={() => fireAbility(a.id)}
            title={a.title}
          >
            <span className="ability-name">{a.label}</span>
            <span className="ability-note">{a.note}</span>
            <span className="ability-fill" style={{ width: `${Math.max(0, Math.min(1, a.fill)) * 100}%` }} />
          </button>
        ))}
      </div>
    </div>
  )
}

function Meter({
  label,
  value,
  color,
  text,
  title,
  marker,
}: {
  label: string
  value: number
  color: string
  text: string
  title: string
  /** Optional 0–1 threshold line drawn across the track. */
  marker?: number
}) {
  return (
    <div className="game-meter" title={title}>
      <span className="game-meter-label">{label}</span>
      <span className="game-meter-track">
        <span
          className="game-meter-fill"
          style={{ width: `${Math.max(0, Math.min(1, value)) * 100}%`, background: color }}
        />
        {marker !== undefined && marker > 0 && (
          <span className="game-meter-mark" style={{ left: `${Math.min(1, marker) * 100}%` }} />
        )}
      </span>
      <span className="game-meter-value">{text}</span>
    </div>
  )
}

/**
 * Win/lose modal. The store pauses the shared clock on the deciding step, so
 * this is the end of the run until the player restarts it.
 */
export function ObjectiveModal() {
  const status = useParasiteStore((s) => s.progress.status)
  const reason = useParasiteStore((s) => s.progress.reason)
  const metric = useParasiteStore((s) => s.progress.metric)
  const name = useParasiteStore((s) => s.objective)
  const reset = useParasiteStore((s) => s.reset)
  const reroll = useParasiteStore((s) => s.reroll)
  const [dismissed, setDismissed] = useState(false)

  useEffect(() => {
    if (status === 'active') setDismissed(false)
  }, [status])

  if (status === 'active' || dismissed) return null

  return (
    <div className={`objective-modal ${status}`} role="dialog" aria-label="Run result">
      <h4>{status === 'won' ? 'Objective complete' : 'Run over'}</h4>
      <p className="objective-modal-metric">{metric}</p>
      <p className="objective-modal-reason">{reason}</p>
      <div className="objective-modal-actions">
        <button className="btn primary" onClick={reset}>
          ↺ Same seed
        </button>
        <button className="btn" onClick={reroll}>
          ⟳ New seed
        </button>
        <button className="btn ghost" onClick={() => setDismissed(true)} title={`Close and inspect the ${name} run`}>
          Inspect
        </button>
      </div>
    </div>
  )
}
