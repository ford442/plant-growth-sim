/**
 * Player abilities — the secreted ROP/GRA effectors as timed, cooling-down
 * actions (epic #3, issue #5/#7).
 *
 * The *mechanisms* are research §7 and are modelled in `hostImmunity.ts`:
 * ROP16 phosphorylates STAT3/6 and skews macrophages to M2 (↓IL-12, ↓NO,
 * ↓ROS), ROP18+ROP5 sit on the cytosolic face of the PVM and block IRG
 * oligomerisation, and TgIST recruits Mi-2/NuRD in the host nucleus to repress
 * the STAT1/IFN-γ program.
 *
 * What is *game-only* is the economy around them. A real tachyzoite injects its
 * rhoptry bulb at every invasion and secretes GRAs continuously; there is no
 * published "cooldown". Making them bursts is what turns an always-on genotype
 * into a decision the player makes at a moment in the lesion's history — so
 * every duration and cooldown here is marked `// TUNING` and lives on the
 * lesion clock, in the same units as the immune fields they fight.
 *
 * Two kinds of switch, kept deliberately separate:
 *
 *  - **Carried** (`EffectorFlags` in the config): does this strain have the
 *    gene at all? Turning one off is a knockout, and knockouts are a sidebar
 *    decision for the whole run.
 *  - **Active** (the states here): is the effector being secreted *now*? That
 *    is the HUD button, and it is what the host actually feels.
 *
 * `activeEffectors()` folds the two together, and that product — never the
 * carried flags on their own — is what `stepWorld` hands to the host model.
 */

import type { EffectorFlags } from './hostImmunity'

export type AbilityId = 'rop16' | 'rop18rop5' | 'tgist'

export const ABILITY_IDS: AbilityId[] = ['rop16', 'rop18rop5', 'tgist']

export interface AbilityDef {
  id: AbilityId
  /** Button label — the molecule, never "debuff II". */
  name: string
  /** Gene/protein for the tooltip. */
  gene: string
  /** What it does to the host, in one line. */
  effect: string
  /** Why a player reaches for it. */
  use: string
  /** Lesion hours the effector keeps acting after one burst. TUNING. */
  durationHours: number
  /** Lesion hours of lockout once it wears off. TUNING. */
  cooldownHours: number
  /**
   * `null` → available from the first hour. Otherwise the ability is locked
   * until the run has recorded this many BFD1 conversions, so the optional
   * third tool arrives only once the player has shown they can encyst at all.
   */
  unlockAfterConversions: number | null
  color: string
}

/**
 * Durations and cooldowns are TUNING, chosen against the clocks they compete
 * with rather than pulled from literature:
 *
 *  - The host's adaptive arm needs ~24 h of antigen before IFN-γ ramps and
 *    saturates over the next ~72 h (`stepHost`), and the primary objective runs
 *    30 lesion days. So an ability has to matter on a scale of hours, not
 *    minutes, and recharge several times inside one immune ramp.
 *  - ROP18/ROP5 is the *tactical* one — it protects vacuoles that already
 *    exist — so it is the shortest and cheapest, and gets fired repeatedly
 *    around an IRG peak.
 *  - ROP16 is *strategic*: M2 polarisation itself eases in and out over ~10 h
 *    in `stepHost`, so a burst shorter than that would never be felt. Long
 *    duration, long cooldown.
 *  - TgIST is the strongest (it throttles IFN-γ signalling at the source) and
 *    so pays the longest lockout, and has to be unlocked.
 */
export const ABILITY_DEFS: Record<AbilityId, AbilityDef> = {
  rop16: {
    id: 'rop16',
    name: 'ROP16',
    gene: 'ROP16 kinase (rhoptry bulb)',
    effect: 'Phosphorylates STAT3/6 → M2 macrophages: ↓IL-12, ↓NO, ↓ROS',
    use: 'Buys quiet time for load to build. Also drops the NO that opens BFD1.',
    durationHours: 20,
    cooldownHours: 34,
    unlockAfterConversions: null,
    color: '#34d399',
  },
  rop18rop5: {
    id: 'rop18rop5',
    name: 'ROP18 + ROP5',
    gene: 'ROP18 kinase + ROP5 pseudokinase',
    effect: 'Coats the vacuole membrane and blocks IRG oligomerisation',
    use: 'Keeps existing vacuoles from being stripped. Fire it into an IRG peak.',
    durationHours: 12,
    cooldownHours: 20,
    unlockAfterConversions: null,
    color: '#60a5fa',
  },
  tgist: {
    id: 'tgist',
    name: 'TgIST',
    gene: 'TgIST (dense granule, nuclear)',
    effect: 'Recruits Mi-2/NuRD on STAT1 → represses the IFN-γ program',
    use: 'The blunt instrument: cuts IFN-γ at the source, at a long lockout.',
    durationHours: 24,
    cooldownHours: 80,
    unlockAfterConversions: 1,
    color: '#a78bfa',
  },
}

export interface AbilityState {
  /** Lesion hours of secretion left; 0 = not acting. */
  activeHours: number
  /** Lesion hours of lockout left; 0 = ready. */
  cooldownHours: number
  /** Times fired this run, for the scoreboard. */
  uses: number
}

export type AbilityStates = Record<AbilityId, AbilityState>

const idle = (): AbilityState => ({ activeHours: 0, cooldownHours: 0, uses: 0 })

export function createAbilityStates(): AbilityStates {
  return { rop16: idle(), rop18rop5: idle(), tgist: idle() }
}

/** Is this effector being secreted right now? */
export const abilityActive = (states: AbilityStates, id: AbilityId): boolean =>
  states[id].activeHours > 0

/**
 * Has the run met this ability's unlock condition? Pure in the one tally value
 * it reads, so the UI and the sim cannot disagree about it.
 */
export function abilityUnlocked(id: AbilityId, conversions: number): boolean {
  const need = ABILITY_DEFS[id].unlockAfterConversions
  return need === null || conversions >= need
}

export interface AbilityAvailability {
  /** Unlocked, carried, not already running and off cooldown. */
  ready: boolean
  active: boolean
  unlocked: boolean
  carried: boolean
  /** Why it cannot be fired, for the button's tooltip. */
  blocked: string | null
}

/**
 * Everything a button needs to render itself: whether it can fire, and if not,
 * the one reason it cannot.
 */
export function abilityAvailability(
  id: AbilityId,
  states: AbilityStates,
  carried: EffectorFlags,
  conversions: number,
): AbilityAvailability {
  const s = states[id]
  const def = ABILITY_DEFS[id]
  const isCarried = carried[id]
  const unlocked = abilityUnlocked(id, conversions)
  const active = s.activeHours > 0
  const blocked = !isCarried
    ? `${def.name} is knocked out in this strain.`
    : !unlocked
      ? `Locked until the first BFD1 conversion of the run.`
      : active
        ? `Already secreting — ${s.activeHours.toFixed(1)} h left.`
        : s.cooldownHours > 0
          ? `Recharging — ${s.cooldownHours.toFixed(1)} h left.`
          : null
  return { ready: blocked === null, active, unlocked, carried: isCarried, blocked }
}

/**
 * Fire an ability. Returns the same object when it cannot be fired, so a caller
 * can use identity to tell a no-op from a real activation (and React skips the
 * re-render).
 */
export function activateAbility(
  states: AbilityStates,
  id: AbilityId,
  carried: EffectorFlags,
  conversions: number,
): AbilityStates {
  if (!abilityAvailability(id, states, carried, conversions).ready) return states
  const s = states[id]
  return {
    ...states,
    [id]: { activeHours: ABILITY_DEFS[id].durationHours, cooldownHours: 0, uses: s.uses + 1 },
  }
}

/**
 * Advance every ability by `dtHours` of lesion time. Pure: returns a new
 * record and never touches the one it was given.
 *
 * The cooldown starts the instant secretion ends, and the overshoot of the step
 * that ended it is charged against the cooldown — so a fixed-step run and a
 * single long step reach the same place, which is what lets the golden tests
 * script an ability rotation.
 */
export function stepAbilities(states: AbilityStates, dtHours: number): AbilityStates {
  const dt = Math.max(0, dtHours)
  if (dt === 0) return states
  const out = {} as AbilityStates
  let changed = false
  for (const id of ABILITY_IDS) {
    const s = states[id]
    const next = stepOne(s, ABILITY_DEFS[id], dt)
    if (next !== s) changed = true
    out[id] = next
  }
  return changed ? out : states
}

function stepOne(s: AbilityState, def: AbilityDef, dt: number): AbilityState {
  if (s.activeHours > 0) {
    const left = s.activeHours - dt
    if (left > 0) return { ...s, activeHours: left }
    // secretion ended inside this step: the leftover time is already cooldown
    return { ...s, activeHours: 0, cooldownHours: Math.max(0, def.cooldownHours + left) }
  }
  if (s.cooldownHours > 0) return { ...s, cooldownHours: Math.max(0, s.cooldownHours - dt) }
  return s
}

/**
 * The effectors the host actually feels: carried **and** currently secreted.
 * This is the only flag set `stepWorld` passes on, so an idle ability is
 * indistinguishable from a knockout as far as the immune model is concerned —
 * which is the point of the mechanic.
 */
export function activeEffectors(carried: EffectorFlags, states: AbilityStates): EffectorFlags {
  return {
    rop16: carried.rop16 && states.rop16.activeHours > 0,
    rop18rop5: carried.rop18rop5 && states.rop18rop5.activeHours > 0,
    tgist: carried.tgist && states.tgist.activeHours > 0,
  }
}
