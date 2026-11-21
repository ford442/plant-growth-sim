import { describe, expect, it } from 'vitest'
import { COMMIT_THRESHOLD, createBfdState, REACTIVATION_IMMUNITY, type BfdState } from './bfdSwitch'
import {
  LIFE_CYCLE,
  nextStage,
  nextTransition,
  replicates,
  TRANSITIONS_FROM,
  type TransitionContext,
  type TransitionId,
} from './lifeCycleGraph'
import { DEFAULT_MODIFIERS } from './modifiers'
import { SPORULATION_MIN_HOURS, type Compartment, type LifeStage } from './stages'

/**
 * Every transition in the life-cycle graph (research §12.1), guard by guard.
 *
 * For each transition: one context where it must fire, then a list of single
 * changes that must each stop it. Flipping one condition at a time is what
 * proves that *every* clause of a guard matters, rather than that some
 * combination happens to be false. The table is keyed by `TransitionId`, so
 * adding a transition without covering it is a compile error here, and the
 * "covers the whole graph" test below catches it at run time too.
 */

type Patch = Partial<TransitionContext>
interface Case {
  from: LifeStage
  to: LifeStage
  /** A context in which the transition is allowed. */
  allowed: TransitionContext
  /** Each patch, applied to `allowed`, must block it. */
  blockedBy: Array<[label: string, patch: Patch]>
  /** Each patch, applied to `allowed`, must leave it allowed (boundaries, optional inputs). */
  stillAllowedBy?: Array<[label: string, patch: Patch]>
  /** Compartments in which it must never fire, whatever else is true. */
  forbiddenIn: Compartment[]
}

const base = {
  bfd: createBfdState(),
  immunity: 1,
  modifiers: DEFAULT_MODIFIERS,
  hoursInStage: 0,
}
const ctx = (over: Partial<TransitionContext> & Pick<TransitionContext, 'stage' | 'compartment'>): TransitionContext => ({
  ...base,
  ...over,
})

/** BFD state past the commitment threshold, and one with the loop latched. */
const committed: BfdState = { ...createBfdState(), bfd1: COMMIT_THRESHOLD }
const latched: BfdState = { ...createBfdState(), bfd1: 0.9, bfd2: 0.9, locked: true, everLocked: true }

const CASES: Record<TransitionId, Case> = {
  sporulation: {
    from: 'unsporulatedOocyst',
    to: 'sporulatedOocyst',
    allowed: ctx({
      stage: 'unsporulatedOocyst',
      compartment: 'environment',
      hoursInStage: SPORULATION_MIN_HOURS,
      oxygen: 1,
      temperature: 22,
    }),
    blockedBy: [
      ['one hour short of the 1-day minimum', { hoursInStage: SPORULATION_MIN_HOURS - 0.01 }],
      ['no oxygen', { oxygen: 0 }],
      ['oxygen exactly at the 0.2 floor (guard is strict)', { oxygen: 0.2 }],
      ['freezing', { temperature: 4 }],
      ['too hot', { temperature: 45 }],
    ],
    stillAllowedBy: [
      ['just above the oxygen floor', { oxygen: 0.21 }],
      ['just above freezing', { temperature: 4.1 }],
      ['just below the heat limit', { temperature: 44.9 }],
      ['oxygen and temperature unreported (defaults: aerated, 22 °C)', { oxygen: undefined, temperature: undefined }],
    ],
    forbiddenIn: ['intermediateTissue', 'felidGut'],
  },

  excystation: {
    from: 'sporulatedOocyst',
    to: 'sporozoite',
    allowed: ctx({ stage: 'sporulatedOocyst', compartment: 'felidGut', bile: 0.8 }),
    blockedBy: [
      ['no bile salts', { bile: 0 }],
      ['bile exactly at the 0.35 threshold (guard is strict)', { bile: 0.35 }],
      ['bile unreported', { bile: undefined }],
    ],
    stillAllowedBy: [
      ['just above the bile threshold', { bile: 0.36 }],
      ['in an intermediate host gut', { compartment: 'intermediateTissue' }],
    ],
    forbiddenIn: ['environment'],
  },

  sporozoiteToTachyzoite: {
    from: 'sporozoite',
    to: 'tachyzoite',
    allowed: ctx({ stage: 'sporozoite', compartment: 'intermediateTissue', hoursInStage: 6, inVacuole: true }),
    blockedBy: [
      ['not yet in a vacuole', { inVacuole: false }],
      ['vacuole state unknown', { inVacuole: undefined }],
      ['only just invaded (under 6 h)', { hoursInStage: 5.99 }],
    ],
    stillAllowedBy: [['in the felid gut instead', { compartment: 'felidGut' }]],
    forbiddenIn: ['environment'],
  },

  tachyzoiteToBradyzoite: {
    from: 'tachyzoite',
    to: 'bradyzoite',
    allowed: ctx({ stage: 'tachyzoite', compartment: 'intermediateTissue', hoursInStage: 20, bfd: committed }),
    blockedBy: [
      ['BFD1 below the commitment threshold', { bfd: { ...committed, bfd1: COMMIT_THRESHOLD - 0.01 } }],
      ['switch never turned on', { bfd: createBfdState() }],
      ['ΔBFD1 knockout, even with a committed-looking state', { modifiers: { ...DEFAULT_MODIFIERS, deltaBfd1: true } }],
    ],
    stillAllowedBy: [['latched loop, stress since withdrawn', { bfd: latched }]],
    // encystment is gated to the intermediate host (design doc §5.1)
    forbiddenIn: ['felidGut', 'environment'],
  },

  bradyzoiteReactivation: {
    from: 'bradyzoite',
    to: 'tachyzoite',
    allowed: ctx({
      stage: 'bradyzoite',
      compartment: 'intermediateTissue',
      immunity: REACTIVATION_IMMUNITY,
      bfd: latched,
      cystRuptured: true,
    }),
    blockedBy: [
      ['immunity just above the collapse threshold', { immunity: REACTIVATION_IMMUNITY + 0.01 }],
      ['a healthy host', { immunity: 1 }],
      ['terminal latency (Hammondia): the cyst is a dead end', { modifiers: { ...DEFAULT_MODIFIERS, lockedLatency: true } }],
      ['latch held and the wall intact, even with no immunity at all', { immunity: 0, cystRuptured: false }],
      ['latch held and wall state unknown', { immunity: 0, cystRuptured: undefined }],
    ],
    stillAllowedBy: [
      ['latch already unwound, wall not ruptured', { bfd: createBfdState(), cystRuptured: undefined }],
      ['no immunity at all', { immunity: 0 }],
    ],
    forbiddenIn: ['felidGut', 'environment'],
  },

  bradyzoiteToMerozoite: {
    from: 'bradyzoite',
    to: 'merozoite',
    allowed: ctx({ stage: 'bradyzoite', compartment: 'felidGut', hoursInStage: 4 }),
    blockedBy: [['not yet through the first 4 h', { hoursInStage: 3.99 }]],
    stillAllowedBy: [['whatever the host immunity', { immunity: 0 }]],
    forbiddenIn: ['intermediateTissue', 'environment'],
  },

  gametogony: {
    from: 'merozoite',
    to: 'unsporulatedOocyst',
    allowed: ctx({ stage: 'merozoite', compartment: 'felidGut', hoursInStage: 36 }),
    blockedBy: [['schizogony still running (under 36 h)', { hoursInStage: 35.99 }]],
    forbiddenIn: ['intermediateTissue', 'environment'],
  },
}

const COMPARTMENT_LIST: Compartment[] = ['environment', 'intermediateTissue', 'felidGut']
const byId = (id: TransitionId) => {
  const t = LIFE_CYCLE.find((x) => x.id === id)
  if (!t) throw new Error(`no transition ${id}`)
  return t
}

describe('life-cycle guards', () => {
  it('has a case for every transition in the graph, and no stray ones', () => {
    expect(Object.keys(CASES).sort()).toEqual(LIFE_CYCLE.map((t) => t.id).sort())
  })

  for (const id of Object.keys(CASES) as TransitionId[]) {
    const c = CASES[id]

    describe(id, () => {
      it(`goes ${c.from} → ${c.to}`, () => {
        const t = byId(id)
        expect(t.from).toBe(c.from)
        expect(t.to).toBe(c.to)
      })

      it('fires when every condition holds', () => {
        expect(byId(id).test(c.allowed)).toBe(true)
        expect(nextTransition(c.allowed)?.id).toBe(id)
        expect(nextStage(c.allowed)).toBe(c.to)
      })

      for (const [label, patch] of c.blockedBy) {
        it(`is blocked by: ${label}`, () => {
          const blocked = { ...c.allowed, ...patch }
          expect(byId(id).test(blocked)).toBe(false)
          // and the graph as a whole agrees: it stays in the same stage
          expect(nextTransition(blocked)).toBeNull()
          expect(nextStage(blocked)).toBe(c.from)
        })
      }

      for (const [label, patch] of c.stillAllowedBy ?? []) {
        it(`still fires with: ${label}`, () => {
          expect(nextTransition({ ...c.allowed, ...patch })?.id).toBe(id)
        })
      }

      for (const compartment of c.forbiddenIn) {
        it(`never fires in ${compartment}, however ready the parasite is`, () => {
          const elsewhere = { ...c.allowed, compartment }
          expect(nextTransition(elsewhere)).toBeNull()
          expect(nextStage(elsewhere)).toBe(c.from)
        })
      }

      it('declares exactly the compartments it is allowed in', () => {
        const t = byId(id)
        const open = COMPARTMENT_LIST.filter((k) => !c.forbiddenIn.includes(k))
        expect([...t.compartments].sort()).toEqual([...open].sort())
      })
    })
  }
})

describe('life-cycle graph structure', () => {
  it('lets no two guards compete for the same stage in the same compartment', () => {
    // `nextTransition` takes the first allowed transition, so if two could be
    // open at once the order of LIFE_CYCLE would silently decide the biology
    for (const [stage, outgoing] of Object.entries(TRANSITIONS_FROM)) {
      for (let i = 0; i < outgoing.length; i++) {
        for (let j = i + 1; j < outgoing.length; j++) {
          const shared = outgoing[i].compartments.filter((k) => outgoing[j].compartments.includes(k))
          expect(shared, `${stage}: ${outgoing[i].id} vs ${outgoing[j].id}`).toEqual([])
        }
      }
    }
  })

  it('indexes every transition by its source stage', () => {
    const indexed = Object.values(TRANSITIONS_FROM).flat()
    expect(indexed.map((t) => t.id).sort()).toEqual(LIFE_CYCLE.map((t) => t.id).sort())
    for (const [stage, list] of Object.entries(TRANSITIONS_FROM)) {
      expect(list.every((t) => t.from === stage)).toBe(true)
    }
  })

  it('closes the heteroxenous loop: a sporozoite can reach every stage and come back', () => {
    const reach = (start: LifeStage) => {
      const seen = new Set<LifeStage>()
      const queue: LifeStage[] = [start]
      while (queue.length) {
        const s = queue.shift()!
        for (const t of TRANSITIONS_FROM[s] ?? []) {
          if (!seen.has(t.to)) {
            seen.add(t.to)
            queue.push(t.to)
          }
        }
      }
      return seen
    }
    const fromSporozoite = reach('sporozoite')
    expect([...fromSporozoite].sort()).toEqual(
      ['bradyzoite', 'merozoite', 'sporozoite', 'sporulatedOocyst', 'tachyzoite', 'unsporulatedOocyst'].sort(),
    )
    // sporozoite is in its own reach set, i.e. the cycle really is a cycle
    expect(fromSporozoite.has('sporozoite')).toBe(true)
  })

  it('has no way out of a tissue cyst: it is a structure, not a cell', () => {
    expect(TRANSITIONS_FROM.tissueCyst).toBeUndefined()
    for (const compartment of COMPARTMENT_LIST) {
      expect(nextTransition(ctx({ stage: 'tissueCyst', compartment, hoursInStage: 1e6, bile: 1, oxygen: 1 }))).toBeNull()
    }
  })

  it('walks the full cycle when each guard is satisfied in turn', () => {
    // sporulated oocyst → sporozoite → tachyzoite → bradyzoite → merozoite → oocyst
    const steps: TransitionId[] = [
      'excystation',
      'sporozoiteToTachyzoite',
      'tachyzoiteToBradyzoite',
      'bradyzoiteToMerozoite',
      'gametogony',
      'sporulation',
    ]
    let stage: LifeStage = 'sporulatedOocyst'
    for (const id of steps) {
      const c = CASES[id]
      expect(stage).toBe(c.from)
      stage = nextStage(c.allowed)
      expect(stage).toBe(c.to)
    }
    expect(stage).toBe('sporulatedOocyst')
  })
})

describe('which stages replicate', () => {
  it('replicates a tachyzoite only inside a vacuole', () => {
    expect(replicates('tachyzoite', true)).toBe(true)
    expect(replicates('tachyzoite', false)).toBe(false)
  })

  it('replicates bradyzoites and merozoites regardless of vacuole', () => {
    for (const inVacuole of [true, false]) {
      expect(replicates('bradyzoite', inVacuole)).toBe(true)
      expect(replicates('merozoite', inVacuole)).toBe(true)
    }
  })

  it('never replicates sessile or non-dividing stages', () => {
    for (const stage of ['sporozoite', 'tissueCyst', 'unsporulatedOocyst', 'sporulatedOocyst'] as const) {
      expect(replicates(stage, true)).toBe(false)
      expect(replicates(stage, false)).toBe(false)
    }
  })
})
