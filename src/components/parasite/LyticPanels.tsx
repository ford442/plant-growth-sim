/**
 * UI for the lytic sandbox: a timeline strip over the viewport and a sidebar
 * panel with the challenge flags. Both sample the store at ~5 Hz instead of
 * re-rendering on every fixed step.
 */

import { useEffect, useState } from 'react'
import { useLyticStore } from '../../stores/lyticStore'
import { EGRESS_PHASE_LABEL } from '../../simulation/parasite/egress'
import { MJ_PHASE_DEFS, MJ_FAILURE_LABEL } from '../../simulation/parasite/invasion'
import {
  LYTIC_ORDER,
  LYTIC_PHASE_DEFS,
  lyticProgress,
  SANDBOX_CAPACITY,
  SANDBOX_ROUNDS,
  type LyticPhase,
  type LyticState,
} from '../../simulation/parasite/lytic/sandbox'

function useLyticSnapshot(): LyticState {
  const [snap, setSnap] = useState(() => useLyticStore.getState().lytic)
  useEffect(() => {
    const id = setInterval(() => setSnap(useLyticStore.getState().lytic), 200)
    return () => clearInterval(id)
  }, [])
  return snap
}

/** One line on what is happening inside the current phase. */
function phaseDetail(s: LyticState): string {
  switch (s.phase) {
    case 'glide':
      if (!s.zoite.contact) return 'Sedimenting onto the dish — no traction in free fluid'
      if (!s.zoite.conoid) return 'On the dish but immotile — the conoid has detached (RNG2 loss)'
      return `Gliding ${s.zoite.speed.toFixed(1)} µm/s · ${s.zoite.distance.toFixed(1)} µm travelled`
    case 'attach':
    case 'invade':
      return s.mj ? `${MJ_PHASE_DEFS[s.mj.phase].name} — ${MJ_PHASE_DEFS[s.mj.phase].note}` : ''
    case 'vacuole':
      return 'PV sealed — dense granules remodelling the vacuole'
    case 'replicate':
      return s.pv
        ? `Round ${s.pv.round + 1} of ${SANDBOX_ROUNDS} · ${s.pv.parasites} → ${s.pv.parasites * 2} · ${Math.round(s.pv.division * 100)}%`
        : ''
    case 'egress':
      return s.pv ? `${EGRESS_PHASE_LABEL[s.pv.egress.phase]} · pH ${s.pv.egress.ph.toFixed(2)} · ${Math.floor(s.pv.egress.pores)} pores` : ''
    case 'lysed':
      return `${s.released.length} daughters released`
    case 'trapped':
      return `pH ${s.pv?.egress.ph.toFixed(2)} · Ca²⁺ primed · 0 pores — the host never lyses`
    case 'stalled':
      return 'Conoid detached from the apical polar ring — no motility'
    case 'aborted':
      return s.mj?.failure ? MJ_FAILURE_LABEL[s.mj.failure] : 'Junction failed'
  }
}

const FAILURE_SLOT: Partial<Record<LyticPhase, LyticPhase>> = {
  // where on the timeline each dead end happens
  stalled: 'glide',
  aborted: 'invade',
  trapped: 'egress',
}

/** Timeline strip along the foot of the viewport. */
export function LyticTimeline() {
  const s = useLyticSnapshot()
  const failedAt = FAILURE_SLOT[s.phase]
  const current = failedAt ?? s.phase
  const idx = LYTIC_ORDER.indexOf(current)
  const failed = !!failedAt

  return (
    <div className="lytic-hud">
      <div className="lytic-steps">
        {LYTIC_ORDER.map((p, i) => {
          const state = i < idx ? 'done' : i === idx ? (failed ? 'failed' : 'active') : ''
          return (
            <div key={p} className={`lytic-step ${state}`} title={LYTIC_PHASE_DEFS[p].note}>
              {i === idx && failed ? LYTIC_PHASE_DEFS[s.phase].name : LYTIC_PHASE_DEFS[p].name}
            </div>
          )
        })}
      </div>
      <div className="lytic-bar">
        <div className={`lytic-bar-fill ${failed ? 'failed' : ''}`} style={{ width: `${lyticProgress(s) * 100}%` }} />
      </div>
      <div className="lytic-detail">
        <span>{phaseDetail(s)}</span>
        <span className="muted">
          {s.actionSeconds.toFixed(0)} action s · {s.lesionHours.toFixed(1)} lesion h
        </span>
      </div>
    </div>
  )
}

/** Sidebar: flags, replay, and what the current phase means. */
export function LyticPanel() {
  const s = useLyticSnapshot()
  const flags = useLyticStore((st) => st.flags)
  const seed = useLyticStore((st) => st.seed)
  const setFlag = useLyticStore((st) => st.setFlag)
  const replay = useLyticStore((st) => st.replay)
  const reroll = useLyticStore((st) => st.reroll)

  return (
    <div className="panel parasite-info">
      <h3>
        Lytic sandbox <span className="muted">seed {seed}</span>
      </h3>
      <p className="gem-blurb">
        One tachyzoite, one host cell, one full lytic cycle with no input: glide, attach, invade through the moving
        junction, replicate by endodyogeny to a {SANDBOX_CAPACITY}-parasite rosette, then egress.
      </p>

      <div className="btn-row">
        <button className="btn" onClick={replay} title="Replay this seed — the run is identical">
          ↺ Replay
        </button>
        <button className="btn" onClick={reroll} title="New seed: new start point and path">
          🎲 New seed
        </button>
      </div>

      <div className="status-label">Now: {LYTIC_PHASE_DEFS[s.phase].name}</div>
      <p className="gem-note">{LYTIC_PHASE_DEFS[s.phase].note}</p>

      <div className="kv-grid">
        <span>Glide path</span>
        <b>{s.zoite.distance.toFixed(1)} µm</b>
        <span>Adhesion</span>
        <b>{Math.round(s.zoite.adhesion * 100)}%</b>
        <span>Conoid</span>
        <b>{s.zoite.conoid ? 'Tethered (RNG2)' : 'Detached'}</b>
        {s.mj && (
          <>
            <span>AMA1 / RON2</span>
            <b>
              {Math.round(s.mj.ama1 * 100)}% / {Math.round(s.mj.ron2 * 100)}%
            </b>
          </>
        )}
        {s.pv && (
          <>
            <span>Parasites</span>
            <b>
              {s.pv.parasites} <span className="muted">round {s.pv.round}</span>
            </b>
            <span>Vacuolar pH</span>
            <b>{s.pv.egress.ph.toFixed(2)}</b>
            <span>TgPLP1 pores</span>
            <b>{Math.floor(s.pv.egress.pores)}</b>
          </>
        )}
      </div>

      <div className="status-label">Challenge flags</div>
      <div className="toggle-column">
        <label className="toggle" title="TgPLP1 (MACPF perforin) — egress blocked; the vacuole is trapped">
          <input type="checkbox" checked={flags.deltaPlp1} onChange={(e) => setFlag('deltaPlp1', e.target.checked)} />
          ΔPLP1 <span className="muted">egress blocked</span>
        </label>
        <label className="toggle" title="RNG2 tethers the conoid to the apical polar ring; without it the parasite is immotile">
          <input type="checkbox" checked={flags.rng2Loss} onChange={(e) => setFlag('rng2Loss', e.target.checked)} />
          RNG2 loss <span className="muted">immotile</span>
        </label>
      </div>
      <p className="gem-note">Changing a flag restarts the run on the same seed, so the two are directly comparable.</p>
    </div>
  )
}
