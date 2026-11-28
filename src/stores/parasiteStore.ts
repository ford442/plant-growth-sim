import { create } from 'zustand'
import { activateAbility, type AbilityId } from '../simulation/parasite/abilities'
import { advanceFixed } from '../simulation/parasite/fixedStep'
import type { EffectorFlags, NicheId, StressLevers } from '../simulation/parasite/hostImmunity'
import {
  DEFAULT_MODIFIERS,
  PARASITE_SPECIES,
  type Modifiers,
  type ParasiteSpeciesId,
} from '../simulation/parasite/modifiers'
import {
  DEFAULT_OBJECTIVE,
  evaluateObjective,
  OBJECTIVES,
  type ObjectiveId,
  type ObjectiveProgress,
} from '../simulation/parasite/objectives'
import type { GameTuning } from '../simulation/parasite/tuning'
import {
  availablePassage,
  createWorld,
  DEFAULT_CONFIG,
  enterFelidGut,
  ingestOocysts,
  seedEnvironment,
  shedToEnvironment,
  type ParasiteConfig,
  type ParasiteWorld,
} from '../simulation/parasite/world'
import { useTimeStore } from './timeStore'

/**
 * Parasite-mode state. Deliberately a sibling of `simStore` rather than part of
 * it: the plant tick loop is untouched, and both stores read play/pause and
 * speed from the one shared `timeStore`.
 *
 * All simulation lives in `src/simulation/parasite/*` as pure functions; this
 * store only holds state, forwards the clock and evaluates the objective.
 */
export interface ParasiteState {
  world: ParasiteWorld
  config: ParasiteConfig
  objective: ObjectiveId
  progress: ObjectiveProgress
  /** Seed of the current run, so a run can be replayed exactly. */
  seed: number
  /**
   * Real time not yet spent, as a fraction of one fixed step (always in
   * [0, 1)). `tick` converts each frame's `dt` into whole fixed steps and keeps
   * the remainder here, so a run depends on the seed and the step count, never
   * on the frame rate. See `simulation/parasite/fixedStep.ts`.
   */
  accumulator: number

  tick: (dt: number) => void
  reset: () => void
  /** Restart with a fresh seed. */
  reroll: () => void

  setConfig: (partial: Partial<ParasiteConfig>) => void
  setStress: (partial: Partial<StressLevers>) => void
  setEffector: (key: keyof EffectorFlags, value: boolean) => void
  setModifier: (key: keyof Modifiers, value: boolean) => void
  setNicheFocus: (niche: NicheId) => void
  setSpecies: (species: ParasiteSpeciesId) => void
  setObjective: (objective: ObjectiveId) => void
  setForceEgress: (on: boolean) => void
  /** Retune the win/lose thresholds (the Leva debug panel). */
  setTuning: (partial: Partial<GameTuning>) => void
  /**
   * Fire a secreted effector. A no-op when it is knocked out, locked, already
   * running or still recharging — `activateAbility` returns the same state, and
   * the store leaves the world untouched so nothing re-renders.
   */
  fireAbility: (id: AbilityId) => void
  /** Take the transmission route the current state offers, if any. */
  passage: () => void
}

/** Build the starting world for an objective (its scenario decides where). */
function startWorld(objective: ObjectiveId, config: ParasiteConfig, seed: number): ParasiteWorld {
  const def = OBJECTIVES[objective]
  const base = createWorld(config, seed)
  return def.startCompartment === 'environment' ? seedEnvironment(base, 28) : base
}

function configFor(objective: ObjectiveId, previous: ParasiteConfig): ParasiteConfig {
  const def = OBJECTIVES[objective]
  return {
    ...previous,
    // scenario modifiers are forced on; the player keeps their other choices
    modifiers: { ...DEFAULT_MODIFIERS, ...def.modifiers },
  }
}

const INITIAL_SEED = 20260812

function freshRun(objective: ObjectiveId, config: ParasiteConfig, seed: number) {
  const world = startWorld(objective, config, seed)
  return { world, progress: evaluateObjective(objective, world, config), seed, accumulator: 0 }
}

const initialConfig = configFor(DEFAULT_OBJECTIVE, DEFAULT_CONFIG)

export const useParasiteStore = create<ParasiteState>((set, get) => ({
  config: initialConfig,
  objective: DEFAULT_OBJECTIVE,
  ...freshRun(DEFAULT_OBJECTIVE, initialConfig, INITIAL_SEED),

  tick: (dt) => {
    const { isPlaying, speed } = useTimeStore.getState()
    if (!isPlaying) return
    const { world, config, objective, progress, accumulator } = get()
    // a resolved objective freezes the run until the player resets
    if (progress.status !== 'active') return

    // Spend this frame's real time as whole fixed steps. The objective is
    // judged after *every* step, so a win or a loss lands on the same step
    // whatever the frame rate, and no step runs past it.
    let latest = progress
    const result = advanceFixed(world, config, accumulator, dt, speed, (w) => {
      latest = evaluateObjective(objective, w, config)
      return latest.status !== 'active'
    })
    if (result.steps === 0) {
      // nothing owed yet (low speed or a short frame): bank the time, leave
      // the world alone so nothing re-renders
      if (result.accumulator !== accumulator) set({ accumulator: result.accumulator })
      return
    }
    // pause on the win/lose beat so the result is readable
    if (latest.status !== 'active') useTimeStore.getState().pause()
    set({ world: result.world, progress: latest, accumulator: result.accumulator })
  },

  reset: () => {
    useTimeStore.getState().play()
    const { objective, config, seed } = get()
    set(freshRun(objective, config, seed))
  },

  reroll: () => {
    useTimeStore.getState().play()
    const { objective, config } = get()
    set(freshRun(objective, config, (Math.random() * 2 ** 31) >>> 0 || 1))
  },

  setConfig: (partial) =>
    set((s) => {
      const config = { ...s.config, ...partial }
      return { config, progress: evaluateObjective(s.objective, s.world, config) }
    }),

  setStress: (partial) =>
    set((s) => ({ config: { ...s.config, stress: { ...s.config.stress, ...partial } } })),

  setEffector: (key, value) =>
    set((s) => ({ config: { ...s.config, effectors: { ...s.config.effectors, [key]: value } } })),

  setModifier: (key, value) =>
    set((s) => ({ config: { ...s.config, modifiers: { ...s.config.modifiers, [key]: value } } })),

  setNicheFocus: (nicheFocus) => set((s) => ({ config: { ...s.config, nicheFocus } })),

  setSpecies: (species) => {
    useTimeStore.getState().play()
    const { objective } = get()
    set((s) => {
      // a species without a feline cycle cannot run the full-loop objective
      const nextObjective =
        objective === 'completeCycle' && !PARASITE_SPECIES[species].felidCycle ? 'latentPassage' : objective
      const config = { ...configFor(nextObjective, s.config), species }
      return { ...freshRun(nextObjective, config, s.seed), config, objective: nextObjective }
    })
  },

  setObjective: (objective) => {
    useTimeStore.getState().play()
    set((s) => {
      const config = configFor(objective, s.config)
      return { ...freshRun(objective, config, s.seed), config, objective }
    })
  },

  setForceEgress: (forceEgress) => set((s) => ({ config: { ...s.config, forceEgress } })),

  setTuning: (partial) =>
    set((s) => {
      const config = { ...s.config, tuning: { ...s.config.tuning, ...partial } }
      // the thresholds decide the run, so a retune is judged immediately — and
      // if it decides it, the clock stops on the result, exactly as `tick` does
      const progress = evaluateObjective(s.objective, s.world, config)
      if (progress.status !== 'active') useTimeStore.getState().pause()
      return { config, progress }
    }),

  fireAbility: (id) => {
    const { world, config } = get()
    const abilities = activateAbility(world.abilities, id, config.effectors, world.tally.conversions)
    if (abilities === world.abilities) return
    set({ world: { ...world, abilities } })
  },

  passage: () => {
    const { world, config, objective } = get()
    const route = availablePassage(world, config)
    if (!route) return
    const next =
      route.id === 'felid'
        ? enterFelidGut(world, config)
        : route.id === 'shed'
          ? shedToEnvironment(world, 28)
          : ingestOocysts(world, config)
    set({ world: next, progress: evaluateObjective(objective, next, config) })
  },
}))
