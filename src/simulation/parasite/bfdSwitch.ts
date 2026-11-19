/**
 * BFD1 / BFD2 — the bradyzoite master switch.
 *
 * Research §9 and §12.3. The biology the model has to reproduce:
 *
 *  - BFD1 mRNA is *already present* in tachyzoites but its translation is
 *    repressed, so conversion is a post-transcriptional gate, not a
 *    transcriptional one. Stress (alkaline pH 8.0–8.2, starvation, heat, NO,
 *    IFN-γ) opens that gate via eIF1.2.
 *  - BFD2 is a CCCH zinc-finger RBP that stabilises/promotes BFD1 translation,
 *    and BFD1 drives BFD2 transcription. That loop is positive feedback, so
 *    past a threshold the state latches without further stress.
 *  - BFD1 is necessary *and* sufficient: ΔBFD1 parasites never encyst and kill
 *    the host with uncontrolled tachyzoite growth.
 *  - The latch only releases when host immunity has effectively collapsed.
 */

import { clamp01 } from './math'

export interface BfdState {
  /** BFD1 protein level, 0–1. */
  bfd1: number
  /** BFD2 RBP level, 0–1. */
  bfd2: number
  /** Positive feedback has latched: conversion is irrevocable. */
  locked: boolean
  /**
   * The loop latched at some point in this cell's history. Stays true while the
   * latch unwinds, which is how reactivation is told apart from a cell that was
   * simply never committed.
   */
  everLocked: boolean
  /** Lesion hours spent above the commitment threshold. */
  committedHours: number
}

/** Stress below this leaves BFD1 translation repressed (eIF1.2 gate closed). */
export const STRESS_GATE = 0.3

/** BFD1 level at which the cell is running the bradyzoite program. */
export const COMMIT_THRESHOLD = 0.5

/** BFD1 level at which the BFD1↔BFD2 loop latches. */
export const LOCK_THRESHOLD = 0.8

/** Effective host immunity below which a locked cyst can reactivate (§9). */
export const REACTIVATION_IMMUNITY = 0.05

const BFD1_SYNTHESIS = 0.09
const BFD1_DECAY = 0.05
const BFD2_GAIN = 2.6
const BFD2_SYNTHESIS = 0.07
const BFD2_DECAY = 0.03

export function createBfdState(): BfdState {
  return { bfd1: 0, bfd2: 0, locked: false, everLocked: false, committedHours: 0 }
}

export interface BfdInputs {
  /** Total stress on the parasite, 0–1 (see `parasiteStress`). */
  stress: number
  /** Lesion hours for this step. */
  dtHours: number
  /** ΔBFD1 knockout: the switch is absent, so no cyst can ever form. */
  deltaBfd1?: boolean
  /**
   * Effective host immunity, 0–1. Only a collapse (≈0) releases the latch —
   * which is what makes reactivation a late-game event rather than a toggle.
   */
  immunity?: number
  /**
   * *Hammondia*-style terminal latency: the latch never releases, so the cyst
   * is a dead end no matter what the host does.
   */
  lockedLatency?: boolean
}

/**
 * One step of the switch. Pure: returns a new state, never mutates.
 */
export function stepBfd(state: BfdState, input: BfdInputs): BfdState {
  const dt = Math.max(0, input.dtHours)
  if (input.deltaBfd1) {
    // no BFD1 locus at all: the program cannot run (research §9, ΔBFD1 row)
    return { bfd1: 0, bfd2: 0, locked: false, everLocked: false, committedHours: 0 }
  }
  if (dt === 0) return state

  const immunity = clamp01(input.immunity ?? 1)
  const collapsed = immunity <= REACTIVATION_IMMUNITY

  // A latched cyst only unwinds when immunity is gone — and never for the
  // terminal-latency preset.
  if (state.locked && collapsed && !input.lockedLatency) {
    const bfd1 = Math.max(0, state.bfd1 - 0.22 * dt)
    const bfd2 = Math.max(0, state.bfd2 - 0.18 * dt)
    const stillLocked = bfd1 > COMMIT_THRESHOLD
    return {
      bfd1,
      bfd2,
      locked: stillLocked,
      everLocked: true,
      committedHours: stillLocked ? state.committedHours + dt : 0,
    }
  }

  // eIF1.2 gate: smooth ramp above the stress threshold
  const gate = smoothGate(clamp01(input.stress))
  // the latch keeps translating even if the stressor is withdrawn
  const drive = state.locked ? Math.max(gate, 0.75) : gate

  const synthesis = BFD1_SYNTHESIS * drive * (1 + BFD2_GAIN * state.bfd2)
  const bfd1 = clamp01(state.bfd1 + (synthesis - BFD1_DECAY * state.bfd1 * (1 - drive)) * dt)
  // BFD1 drives BFD2 transcription; the square makes the loop snap rather than creep
  const bfd2 = clamp01(state.bfd2 + (BFD2_SYNTHESIS * bfd1 * bfd1 - BFD2_DECAY * state.bfd2) * dt)

  const locked = state.locked || bfd1 >= LOCK_THRESHOLD
  const committedHours = bfd1 >= COMMIT_THRESHOLD ? state.committedHours + dt : 0

  return { bfd1, bfd2, locked, everLocked: state.everLocked || locked, committedHours }
}

/** Is the bradyzoite differentiation program running? */
export const isCommitted = (state: BfdState) => state.bfd1 >= COMMIT_THRESHOLD

/** Has the positive-feedback loop latched? */
export const isLocked = (state: BfdState) => state.locked

/**
 * Would this cyst reactivate right now? Research rule: the program reverses only
 * if host immunity has collapsed to ≈0. The latch has to have engaged at some
 * point (`everLocked`) and then wound back below the commitment threshold — a
 * cell that was never committed is not "reactivating", it simply never encysted.
 */
export function canReactivate(state: BfdState, immunity: number, lockedLatency = false): boolean {
  if (lockedLatency) return false
  if (!state.everLocked) return false
  return clamp01(immunity) <= REACTIVATION_IMMUNITY && state.bfd1 < COMMIT_THRESHOLD
}

/** Effective host immunity as the switch sees it. */
export function effectiveImmunity(ifnGamma: number, irg: number): number {
  return clamp01(ifnGamma * 0.6 + irg * 0.4)
}

/** Smooth 0→1 ramp over the stress gate, saturating well before stress = 1. */
function smoothGate(stress: number): number {
  const t = clamp01((stress - STRESS_GATE) / (1 - STRESS_GATE))
  return t * t * (3 - 2 * t)
}

/** UI label for the current switch position. */
export function bfdPhase(state: BfdState): 'repressed' | 'translating' | 'committed' | 'locked' {
  if (state.locked) return 'locked'
  if (state.bfd1 >= COMMIT_THRESHOLD) return 'committed'
  if (state.bfd1 > 0.05) return 'translating'
  return 'repressed'
}
