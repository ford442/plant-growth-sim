import { create } from 'zustand'
import { advanceClocks } from '../simulation/parasite/stages'
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
import {
  availablePassage,
  createWorld,
  DEFAULT_CONFIG,
  enterFelidGut,
  ingestOocysts,
  seedEnvironment,
  shedToEnvironment,
  stepWorld,
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
  return { world, progress: evaluateObjective(objective, world, config), seed }
}

const initialConfig = configFor(DEFAULT_OBJECTIVE, DEFAULT_CONFIG)

export const useParasiteStore = create<ParasiteState>((set, get) => ({
  config: initialConfig,
  objective: DEFAULT_OBJECTIVE,
  ...freshRun(DEFAULT_OBJECTIVE, initialConfig, INITIAL_SEED),

  tick: (dt) => {
    const { isPlaying, speed } = useTimeStore.getState()
    if (!isPlaying) return
    const { world, config, objective, progress } = get()
    // a resolved objective freezes the run until the player resets
    if (progress.status !== 'active') return

    const next = stepWorld(world, config, advanceClocks(dt, speed))
    const nextProgress = evaluateObjective(objective, next, config)
    // pause on the win/lose beat so the result is readable
    if (nextProgress.status !== 'active') useTimeStore.getState().pause()
    set({ world: next, progress: nextProgress })
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
