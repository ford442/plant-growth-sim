/**
 * The parasite world: one pure step function over agents, host cells,
 * vacuoles, cysts and oocysts.
 *
 * Nothing here imports Three.js — the viewer derives all geometry from this
 * state each frame, exactly as the plant and gem modes do. Positions are in
 * micrometres in a tissue-local frame.
 */

import {
  addV,
  clamp01,
  createRng,
  distV,
  fires,
  lengthV,
  nextFloat,
  nextRange,
  normalizeV,
  scaleV,
  subV,
  type Rng,
  type Vec3,
} from './math'
import {
  advanceClocks,
  BRADYZOITE_DIVISION_HOURS,
  cystDiameter,
  cystWallThickness,
  CYST_MAX_BRADYZOITES,
  ENDODYOGENY_HOURS,
  OOCYSTS_PER_SHED,
  OOCYST_AGEING,
  PV_CAPACITY,
  SPOROZOITES_PER_OOCYST,
  SPORULATION_MAX_HOURS,
  SPORULATION_MIN_HOURS,
  type AgentStage,
  type Clocks,
  type Compartment,
} from './stages'
import {
  activeEffectors,
  createAbilityStates,
  stepAbilities,
  type AbilityStates,
} from './abilities'
import {
  canReactivate,
  createBfdState,
  effectiveImmunity,
  isCommitted,
  stepBfd,
  type BfdState,
} from './bfdSwitch'
import {
  createGlideState,
  stepGlide,
  tractionForce,
  type GlideState,
} from './glideosome'
import {
  beginInvasion,
  invasionFailed,
  invasionSucceeded,
  stepInvasion,
  willAttempt,
  type MjState,
} from './invasion'
import {
  createEgressState,
  egressComplete,
  egressTrapped,
  shouldTriggerEgress,
  stepEgress,
  type EgressState,
} from './egress'
import {
  createHostState,
  DEFAULT_EFFECTORS,
  DEFAULT_STRESS,
  NICHE_DEFS,
  parasiteStress,
  pickNiche,
  stepHost,
  vacuolePressure,
  type EffectorFlags,
  type HostState,
  type NicheId,
  type StressLevers,
} from './hostImmunity'
import { nextTransition } from './lifeCycleGraph'
import { DEFAULT_TUNING, type GameTuning } from './tuning'
import {
  DEFAULT_MODIFIERS,
  PARASITE_SPECIES,
  resolveModifiers,
  type Modifiers,
  type ParasiteSpeciesId,
} from './modifiers'

// ---------------------------------------------------------------------------
// Scene constants
// ---------------------------------------------------------------------------

/** Radius of the simulated tissue volume, µm. */
export const TISSUE_RADIUS = 55
/** Host cell radius, µm (a fibroblast/myocyte-scale target). */
export const CELL_RADIUS = 7.5
/** Host cells kept in the scene. */
export const CELL_COUNT = 24
/** Extracellular parasites simulated individually; the rest are an aggregate. */
export const MAX_AGENTS = 56
/** Cysts drawn individually. */
export const MAX_CYSTS = 64
/** Oocysts drawn individually in the environment view. */
export const MAX_OOCYSTS = 48
/** Bradyzoites at which a cyst counts as mature for objectives. */
export const MATURE_CYST_BRADYZOITES = 256
/** Lesion hours before a lysed cell is replaced by regenerated tissue. */
const CELL_REGEN_HOURS = 30

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

export interface Agent {
  id: number
  stage: AgentStage
  glide: GlideState
  /** Non-null while a moving junction is being built. */
  mj: MjState | null
  ageHours: number
  stageHours: number
  bfd: BfdState
}

export interface Pv {
  /** Tachyzoites (or merozoites) in the rosette. */
  parasites: number
  /** Lesion hours accumulated toward the next endodyogeny. */
  divisionTimer: number
  bfd: BfdState
  egress: EgressState
  /** The BFD1 program is running: this vacuole is becoming a cyst. */
  converting: boolean
  /** Completed division rounds, for the rosette layout. */
  generations: number
}

export interface HostCell {
  id: number
  pos: Vec3
  radius: number
  niche: NicheId
  state: 'healthy' | 'invaded' | 'lysed'
  pv: Pv | null
  /** Immune pressure felt here, 0–1. */
  pressure: number
  /** Lesion hours since lysis, for regeneration. */
  lysedHours: number
}

export interface Cyst {
  id: number
  niche: NicheId
  pos: Vec3
  diameter: number
  wall: number
  bradyzoites: number
  ageHours: number
  bfd: BfdState
  divisionTimer: number
  intact: boolean
}

export interface Oocyst {
  id: number
  sporulated: boolean
  /** Lesion hours since entering the current stage (drives sporulation). */
  hoursInStage: number
  /**
   * Shelf-life hours experienced, on the compressed environmental gear
   * (`OOCYST_AGEING`). This — not the lesion clock — is the "how long has this
   * oocyst been lying in the soil" figure the endurance objective scores.
   */
  shelfHours: number
  /** 1 → 0 as the oocyst weathers. */
  viability: number
  /** Sporulation completes at this many lesion hours, drawn from 1–5 days. */
  sporulationTarget: number
  pos: Vec3
  spin: number
}

/**
 * Shelf-life hours an oocyst survives in ideal (cool, moist, shaded) soil —
 * the documented 18-month maximum.
 */
export const OOCYST_IDEAL_SHELF_HOURS = 18 * 30 * 24

export type EventKind =
  | 'invasion'
  | 'egress'
  | 'conversion'
  | 'reactivation'
  | 'clearance'
  | 'sporulation'
  | 'passage'
  | 'host'

export interface SimEvent {
  id: number
  /** Lesion hours at which it happened. */
  hour: number
  kind: EventKind
  text: string
}

export interface Tally {
  extracellular: number
  /** Extracellular parasites beyond the individually simulated cap. */
  overflow: number
  intracellular: number
  bradyzoitesInCysts: number
  cysts: number
  matureCysts: number
  cystsByNiche: Record<NicheId, number>
  cellsLysed: number
  lyticCycles: number
  conversions: number
  reactivations: number
  failedInvasions: number
  clearances: number
  sporulatedOocysts: number
  oocystsShed: number
  peakLoad: number
}

export interface ParasiteWorld {
  rng: Rng
  compartment: Compartment
  /** Developmental clock, lesion hours. */
  lesionHours: number
  /** Biomechanical clock, action seconds. */
  actionSeconds: number
  host: HostState
  /** Cooldown/duration state of the player's secreted effectors. */
  abilities: AbilityStates
  agents: Agent[]
  cells: HostCell[]
  cysts: Cyst[]
  oocysts: Oocyst[]
  /** Extracellular parasites past MAX_AGENTS, tracked as a number. */
  overflow: number
  /** Rounds of schizogony completed in the felid gut. */
  gutCycles: number
  /** Oocysts produced by gametogony and waiting to be shed. */
  oocystsReady: number
  tally: Tally
  log: SimEvent[]
  nextId: number
  /** Set for one step when the compartment changed, so the view can reframe. */
  justPassaged: boolean
}

/** Everything the player can dial. Lives in the store, passed into each step. */
export interface ParasiteConfig {
  species: ParasiteSpeciesId
  modifiers: Modifiers
  effectors: EffectorFlags
  stress: StressLevers
  immunosuppression: number
  /** Niche the bradyzoite program prefers when seeding new cysts. */
  nicheFocus: NicheId
  /** Environment: soil temperature, °C. */
  temperature: number
  /** Environment: moisture, 0–1 — oxygen for sporulation, shelter from ageing. */
  moisture: number
  /** Player-forced egress of every vacuole. */
  forceEgress: boolean
  /** Win/lose thresholds for the objective layer (`tuning.ts`). */
  tuning: GameTuning
}

export const DEFAULT_CONFIG: ParasiteConfig = {
  species: 'tgondii',
  modifiers: { ...DEFAULT_MODIFIERS },
  effectors: { ...DEFAULT_EFFECTORS },
  stress: { ...DEFAULT_STRESS },
  immunosuppression: 0,
  nicheFocus: 'cnsCortex',
  temperature: 22,
  moisture: 0.6,
  forceEgress: false,
  tuning: { ...DEFAULT_TUNING },
}

function emptyTally(): Tally {
  return {
    extracellular: 0,
    overflow: 0,
    intracellular: 0,
    bradyzoitesInCysts: 0,
    cysts: 0,
    matureCysts: 0,
    cystsByNiche: { skeletalMuscle: 0, cardiacMuscle: 0, retina: 0, cnsCortex: 0, cnsAmygdala: 0 },
    cellsLysed: 0,
    lyticCycles: 0,
    conversions: 0,
    reactivations: 0,
    failedInvasions: 0,
    clearances: 0,
    sporulatedOocysts: 0,
    oocystsShed: 0,
    peakLoad: 0,
  }
}

// ---------------------------------------------------------------------------
// Construction
// ---------------------------------------------------------------------------

function makeCell(id: number, rng: Rng, niche: NicheId): HostCell {
  // rejection-free spread through the tissue sphere
  const r = TISSUE_RADIUS * 0.82 * Math.cbrt(nextFloat(rng))
  const z = nextRange(rng, -1, 1)
  const a = nextRange(rng, 0, Math.PI * 2)
  const s = Math.sqrt(Math.max(0, 1 - z * z))
  return {
    id,
    pos: { x: Math.cos(a) * s * r, y: Math.sin(a) * s * r, z: z * r },
    radius: CELL_RADIUS * nextRange(rng, 0.85, 1.2),
    niche,
    state: 'healthy',
    pv: null,
    pressure: 0,
    lysedHours: 0,
  }
}

function makeAgent(id: number, stage: AgentStage, pos: Vec3, rng: Rng): Agent {
  return {
    id,
    stage,
    glide: createGlideState(pos, rng),
    mj: null,
    ageHours: 0,
    stageHours: 0,
    bfd: createBfdState(),
  }
}

/**
 * A fresh run. `inoculum` seeds the tissue with sporozoites (as an oral oocyst
 * infection would); the environment compartment starts with shed oocysts.
 */
export function createWorld(cfg: ParasiteConfig = DEFAULT_CONFIG, seed = 20260812, inoculum = 4): ParasiteWorld {
  const rng = createRng(seed)
  const cells: HostCell[] = []
  for (let i = 0; i < CELL_COUNT; i++) {
    cells.push(makeCell(i, rng, pickNiche(nextFloat(rng), { [cfg.nicheFocus]: 0.45 })))
  }
  const agents: Agent[] = []
  for (let i = 0; i < inoculum; i++) {
    const dir = normalizeV({ x: nextRange(rng, -1, 1), y: nextRange(rng, -1, 1), z: nextRange(rng, -1, 1) })
    agents.push(makeAgent(CELL_COUNT + i, 'sporozoite', scaleV(dir, TISSUE_RADIUS * 0.6), rng))
  }
  return {
    rng,
    compartment: 'intermediateTissue',
    lesionHours: 0,
    actionSeconds: 0,
    host: createHostState(cfg.immunosuppression),
    abilities: createAbilityStates(),
    agents,
    cells,
    cysts: [],
    oocysts: [],
    overflow: 0,
    gutCycles: 0,
    oocystsReady: 0,
    tally: emptyTally(),
    log: [
      {
        id: 0,
        hour: 0,
        kind: 'passage',
        text: `${PARASITE_SPECIES[cfg.species].short}: ${inoculum} sporozoites excysted into host tissue.`,
      },
    ],
    nextId: CELL_COUNT + inoculum + 1,
    justPassaged: true,
  }
}

// ---------------------------------------------------------------------------
// Step
// ---------------------------------------------------------------------------

interface StepScratch {
  log: SimEvent[]
  nextId: number
  lysedThisStep: number
  tally: Tally
}

function logEvent(s: StepScratch, hour: number, kind: EventKind, text: string) {
  s.log.push({ id: s.nextId++, hour, kind, text })
  if (s.log.length > 48) s.log.splice(0, s.log.length - 48)
}

/**
 * The world's random generator, copied. `nextFloat` advances an `Rng` in place,
 * so a step that drew from `world.rng` directly would change the world it was
 * given and answer differently the second time it was called. Every function
 * that takes a world and returns one draws from its own fork and hands that
 * back, which leaves the draw sequence of a linear run exactly as it was.
 */
const forkRng = (world: ParasiteWorld): Rng => ({ ...world.rng })

/**
 * One simulation step. Pure: `world` is never modified, and the same
 * `(world, cfg, clocks)` always gives the same result. `clocks` comes from
 * `advanceClocks(dt, speed)`, so the caller owns the shared play/pause and speed.
 */
export function stepWorld(world: ParasiteWorld, cfg: ParasiteConfig, clocks: Clocks): ParasiteWorld {
  const mods = resolveModifiers(cfg.species, cfg.modifiers)
  const dtA = clocks.action
  const dtH = clocks.lesion
  if (dtA <= 0 && dtH <= 0) return world

  /**
   * What the host feels this step: the strain's carried effector genes AND the
   * abilities that are actually secreting. Never `cfg.effectors` on its own —
   * that is the genotype, not the current secretion (`abilities.ts`).
   */
  const effectors = activeEffectors(cfg.effectors, world.abilities)
  // the abilities the *next* step sees; this step runs on what was active during it
  const abilities = stepAbilities(world.abilities, dtH)

  const rng = forkRng(world)
  const scratch: StepScratch = {
    log: world.log.slice(),
    nextId: world.nextId,
    lysedThisStep: 0,
    tally: { ...emptyTally(), ...pickCumulative(world.tally) },
  }

  const immunity = effectiveImmunity(world.host.fields.ifnGamma, world.host.fields.irg)
  /**
   * What the BFD switch is told about host control. Raw field levels are near
   * zero in a naive host, which is *not* the immune collapse that releases the
   * latch — so the floor stays above the reactivation threshold until the host
   * has genuinely lost control (`host.collapsed`).
   */
  const hostControl = world.host.collapsed ? 0 : Math.max(immunity, 0.2)
  const lesionHours = world.lesionHours + dtH

  // ---- environment compartment: oocysts only -----------------------------
  if (world.compartment === 'environment') {
    const oocysts = stepOocysts(world.oocysts, cfg, dtH, scratch, lesionHours)
    const sporulated = oocysts.filter((o) => o.sporulated).length
    const tally: Tally = {
      ...scratch.tally,
      extracellular: 0,
      intracellular: 0,
      overflow: 0,
      sporulatedOocysts: sporulated,
      cysts: world.cysts.length,
      bradyzoitesInCysts: world.cysts.reduce((n, c) => n + c.bradyzoites, 0),
      matureCysts: world.cysts.filter((c) => c.bradyzoites >= MATURE_CYST_BRADYZOITES).length,
      cystsByNiche: countByNiche(world.cysts),
    }
    return {
      ...world,
      rng,
      lesionHours,
      actionSeconds: world.actionSeconds + dtA,
      abilities,
      oocysts,
      tally,
      log: scratch.log,
      nextId: scratch.nextId,
      justPassaged: false,
    }
  }

  // ---- host compartments --------------------------------------------------
  const cells = world.cells.map((c) => ({ ...c, pv: c.pv ? { ...c.pv } : null }))
  const spawned: Agent[] = []
  const cysts = world.cysts.map((c) => ({ ...c }))
  let overflow = world.overflow
  let gutCycles = world.gutCycles
  let oocystsReady = world.oocystsReady

  // 1. host cells and their vacuoles
  for (const cell of cells) {
    cell.pressure = vacuolePressure(world.host, cell.niche, effectors)

    if (cell.state === 'lysed') {
      cell.lysedHours += dtH
      if (cell.lysedHours >= CELL_REGEN_HOURS) {
        cell.state = 'healthy'
        cell.lysedHours = 0
        cell.pv = null
      }
      continue
    }
    const pv = cell.pv
    if (!pv) continue

    const stress = parasiteStress(world.host, cell.niche, cfg.stress, effectors)

    // IRG-driven clearance of the vacuole — the shield is already folded into
    // `pressure` via ROP18/ROP5.
    if (cell.pressure > 0.25 && fires(rng, cell.pressure * 0.75, dtH)) {
      scratch.tally.clearances++
      logEvent(
        scratch,
        lesionHours,
        'clearance',
        `IRG stripped a vacuole in ${NICHE_DEFS[cell.niche].name.toLowerCase()} (${pv.parasites} lost).`,
      )
      cell.pv = null
      cell.state = 'healthy'
      continue
    }

    pv.bfd = stepBfd(pv.bfd, {
      stress,
      dtHours: dtH,
      deltaBfd1: mods.deltaBfd1,
      immunity: hostControl,
      lockedLatency: mods.lockedLatency,
    })

    // Encystment is an intermediate-host phenomenon. In the felid gut the
    // parasite runs schizogony and then the sexual cycle instead, so stress
    // there must not divert it into a tissue cyst.
    const canEncyst = world.compartment === 'intermediateTissue'
    const committing = canEncyst && isCommitted(pv.bfd)
    if (committing && !pv.converting) {
      pv.converting = true
      scratch.tally.conversions++
      logEvent(
        scratch,
        lesionHours,
        'conversion',
        `BFD1 translation opened under stress ${(stress * 100).toFixed(0)}% — vacuole converting to a cyst.`,
      )
    }

    // replication: endodyogeny in the vacuole, far slower once converting
    const period = pv.converting ? BRADYZOITE_DIVISION_HOURS : ENDODYOGENY_HOURS
    pv.divisionTimer += dtH
    while (pv.divisionTimer >= period && pv.parasites < PV_CAPACITY * 2) {
      pv.divisionTimer -= period
      pv.parasites = Math.min(PV_CAPACITY * 2, pv.parasites * 2)
      pv.generations++
    }

    // a converted vacuole becomes a tissue cyst and leaves the lytic cycle
    if (pv.converting && pv.bfd.locked && pv.parasites >= 2) {
      if (cysts.length < MAX_CYSTS) {
        cysts.push({
          id: scratch.nextId++,
          niche: cell.niche,
          pos: cell.pos,
          diameter: cystDiameter(pv.parasites),
          wall: cystWallThickness(pv.parasites),
          bradyzoites: pv.parasites,
          ageHours: 0,
          bfd: pv.bfd,
          divisionTimer: 0,
          intact: true,
        })
        logEvent(
          scratch,
          lesionHours,
          'conversion',
          `Tissue cyst walled off in ${NICHE_DEFS[cell.niche].name.toLowerCase()} (${pv.parasites} bradyzoites).`,
        )
      }
      cell.pv = null
      cell.state = 'healthy'
      continue
    }

    // egress cascade
    const triggered =
      cfg.forceEgress ||
      (!pv.converting &&
        shouldTriggerEgress(pv.parasites, PV_CAPACITY, cell.pressure, cfg.stress.starvation))
    pv.egress = stepEgress(pv.egress, {
      dtSeconds: dtA,
      triggered,
      deltaPlp1: mods.deltaPlp1,
      pressure: cell.pressure,
      rng,
    })

    if (egressComplete(pv.egress)) {
      const freed = pv.parasites

      // Felid gut: after a couple of rounds of schizogony the merozoites
      // differentiate into micro/macrogametes instead of reinvading. The
      // zygotes that follow are the oocysts the cat will shed.
      if (world.compartment === 'felidGut') {
        gutCycles++
        if (gutCycles >= 2) {
          oocystsReady += freed
          cell.state = 'lysed'
          cell.lysedHours = 0
          cell.pv = null
          scratch.lysedThisStep++
          scratch.tally.lyticCycles++
          logEvent(
            scratch,
            lesionHours,
            'passage',
            `Gametogony in the felid gut — ${freed} merozoites became gametes, then zygotes.`,
          )
          continue
        }
      }

      for (let i = 0; i < freed; i++) {
        if (world.agents.length + spawned.length < MAX_AGENTS) {
          const dir = normalizeV({
            x: nextRange(rng, -1, 1),
            y: nextRange(rng, -1, 1),
            z: nextRange(rng, -1, 1),
          })
          spawned.push(
            makeAgent(
              scratch.nextId++,
              world.compartment === 'felidGut' ? 'merozoite' : 'tachyzoite',
              addV(cell.pos, scaleV(dir, cell.radius + 1)),
              rng,
            ),
          )
        } else {
          overflow++
        }
      }
      cell.state = 'lysed'
      cell.lysedHours = 0
      cell.pv = null
      scratch.lysedThisStep++
      scratch.tally.lyticCycles++
      logEvent(scratch, lesionHours, 'egress', `TgPLP1 pores breached a vacuole — ${freed} parasites egressed.`)
      continue
    }

    if (egressTrapped(pv.egress) && pv.egress.inflammation >= 1) {
      // Δplp1: the host destroys the cell and the parasites with it, and gets
      // an earlier protective response for its trouble (research §10).
      cell.state = 'lysed'
      cell.lysedHours = 0
      cell.pv = null
      scratch.lysedThisStep++
      logEvent(
        scratch,
        lesionHours,
        'clearance',
        'Δplp1 vacuole destroyed by host inflammation — no parasites escaped.',
      )
    }
  }

  // 2. extracellular agents
  const agents: Agent[] = []
  for (const prev of world.agents) {
    const agent: Agent = { ...prev, glide: prev.glide, bfd: prev.bfd }
    agent.ageHours += dtH
    agent.stageHours += dtH

    // extracellular parasites are the most exposed: ROS/NO kill them outright
    const exposure = clamp01(world.host.fields.ros * 0.6 + world.host.fields.no * 0.5)
    if (agent.mj === null && exposure > 0.1 && fires(rng, exposure * 1.4, dtH)) {
      continue
    }

    if (agent.mj) {
      const traction = tractionForce(agent.glide)
      const targetCell = cells.find((c) => c.id === agent.mj!.cellId)
      agent.mj = stepInvasion(agent.mj, {
        dtSeconds: dtA,
        traction,
        pressure: targetCell?.pressure ?? 0,
        rng,
        deltaMic2: mods.deltaMic2,
      })
      if (invasionSucceeded(agent.mj)) {
        const cell = targetCell
        if (cell && cell.state === 'healthy') {
          cell.state = 'invaded'
          cell.pv = {
            parasites: 1,
            divisionTimer: 0,
            bfd: agent.bfd,
            egress: createEgressState(),
            converting: false,
            generations: 0,
          }
          logEvent(
            scratch,
            lesionHours,
            'invasion',
            `Moving junction completed — PV formed in ${NICHE_DEFS[cell.niche].name.toLowerCase()}.`,
          )
          continue // the agent is now the vacuole
        }
        agent.mj = null
      } else if (invasionFailed(agent.mj)) {
        scratch.tally.failedInvasions++
        const why = agent.mj.failure
        if (why === 'hostResisted') continue // killed during the attempt
        agent.mj = null
      }
      agents.push(agent)
      continue
    }

    // free gliding: seek the nearest invadable cell
    const target = nearestTarget(cells, agent.glide.pos)
    const toTarget = target ? subV(target.pos, agent.glide.pos) : null
    const substrate = target ? clamp01(1 - (lengthV(toTarget!) - target.radius) / 25) * 0.9 + 0.1 : 0.35

    agent.glide = stepGlide(agent.glide, {
      dtSeconds: dtA,
      substrate,
      adhesin: !mods.deltaMic2,
      rng,
      bias: toTarget ?? undefined,
      biasStrength: mods.deltaMic2 ? 0.05 : 0.55,
    })

    // keep the parasite inside the tissue volume
    const r = lengthV(agent.glide.pos)
    if (r > TISSUE_RADIUS) {
      const inward = scaleV(normalizeV(agent.glide.pos), -1)
      agent.glide = {
        ...agent.glide,
        pos: scaleV(normalizeV(agent.glide.pos), TISSUE_RADIUS),
        heading: inward,
      }
    }

    // contact → commit to a junction
    if (target) {
      const gap = distV(agent.glide.pos, target.pos) - target.radius
      if (gap < 1.2 && willAttempt(rng, substrate, !mods.deltaMic2)) {
        agent.mj = beginInvasion(target.id)
      }
    }

    // stage transitions for free parasites (sporozoite → tachyzoite needs a PV,
    // so free sporozoites just persist until they invade)
    const t = nextTransition({
      stage: agent.stage,
      compartment: world.compartment,
      hoursInStage: agent.stageHours,
      bfd: agent.bfd,
      immunity,
      modifiers: mods,
      inVacuole: false,
      bile: world.compartment === 'felidGut' ? 0.8 : 0.1,
    })
    if (t?.id === 'gametogony') {
      // leaves the agent pool entirely: gametes → zygote → oocyst
      oocystsReady++
      logEvent(scratch, lesionHours, 'passage', 'A merozoite completed gametogony — one more oocyst.')
      continue
    }
    if (t && (t.to === 'tachyzoite' || t.to === 'bradyzoite' || t.to === 'merozoite' || t.to === 'sporozoite')) {
      agent.stage = t.to as AgentStage
      agent.stageHours = 0
    }

    agents.push(agent)
  }

  // Refill the scene from the overflow pool as slots free up. The pool is a
  // fractional aggregate (immunity eats a fraction of it per step), so a whole
  // parasite has to be there to draw — `> 0` would hand a slot to a 0.3 of a
  // parasite and leave the pool negative.
  while (overflow >= 1 && agents.length + spawned.length < MAX_AGENTS) {
    const dir = normalizeV({ x: nextRange(rng, -1, 1), y: nextRange(rng, -1, 1), z: nextRange(rng, -1, 1) })
    spawned.push(
      makeAgent(scratch.nextId++, 'tachyzoite', scaleV(dir, TISSUE_RADIUS * 0.7), rng),
    )
    overflow--
  }
  // overflow is still cleared by immunity, just not drawn
  if (overflow > 0) {
    const kill = overflow * clamp01(immunity * 0.35) * clamp01(dtH * 0.2)
    overflow = Math.max(0, overflow - kill)
  }
  agents.push(...spawned)

  // 3. cysts
  for (const cyst of cysts) {
    cyst.ageHours += dtH
    const stress = parasiteStress(world.host, cyst.niche, cfg.stress, effectors)
    cyst.bfd = stepBfd(cyst.bfd, {
      stress,
      dtHours: dtH,
      immunity: hostControl,
      lockedLatency: mods.lockedLatency,
      deltaBfd1: mods.deltaBfd1,
    })

    // bradyzoites keep dividing slowly, logistically approaching the cap
    if (cyst.intact && cyst.bradyzoites < CYST_MAX_BRADYZOITES) {
      const fill = cyst.bradyzoites / CYST_MAX_BRADYZOITES
      cyst.divisionTimer += dtH * (1 - fill * 0.85)
      while (cyst.divisionTimer >= BRADYZOITE_DIVISION_HOURS && cyst.bradyzoites < CYST_MAX_BRADYZOITES) {
        cyst.divisionTimer -= BRADYZOITE_DIVISION_HOURS
        cyst.bradyzoites = Math.min(CYST_MAX_BRADYZOITES, Math.round(cyst.bradyzoites * 1.6))
      }
      cyst.diameter = cystDiameter(cyst.bradyzoites)
      cyst.wall = cystWallThickness(cyst.bradyzoites)
    }

    // reactivation: only once immunity has collapsed
    if (cyst.intact && canReactivate(cyst.bfd, hostControl, mods.lockedLatency)) {
      cyst.intact = false
      scratch.tally.reactivations++
      const released = Math.min(12, Math.max(2, Math.round(cyst.bradyzoites * 0.05)))
      for (let i = 0; i < released; i++) {
        if (agents.length < MAX_AGENTS) {
          const dir = normalizeV({
            x: nextRange(rng, -1, 1),
            y: nextRange(rng, -1, 1),
            z: nextRange(rng, -1, 1),
          })
          agents.push(
            makeAgent(scratch.nextId++, 'tachyzoite', addV(cyst.pos, scaleV(dir, cyst.diameter * 0.6)), rng),
          )
        } else overflow++
      }
      logEvent(
        scratch,
        lesionHours,
        'reactivation',
        `Immunity collapsed — cyst ruptured in ${NICHE_DEFS[cyst.niche].name.toLowerCase()}, ${released} recrudescent tachyzoites.`,
      )
    }
  }
  const liveCysts = cysts.filter((c) => c.intact)

  // 4. host response
  const intracellular = cells.reduce((n, c) => n + (c.pv?.parasites ?? 0), 0)
  const extracellular = agents.length
  const load = extracellular + overflow + intracellular
  const host = stepHost(
    { ...world.host, immunosuppression: cfg.immunosuppression },
    {
      load,
      lysedThisStep: scratch.lysedThisStep,
      effectors,
      dtHours: dtH,
    },
  )
  if (host.health <= 0 && world.host.health > 0) {
    logEvent(scratch, lesionHours, 'host', 'Host died — acute toxoplasmosis.')
  }
  if (host.collapsed && !world.host.collapsed) {
    logEvent(scratch, lesionHours, 'host', 'Adaptive immunity has collapsed. Cysts can reactivate.')
  }

  const tally: Tally = {
    ...scratch.tally,
    extracellular,
    overflow: Math.round(overflow),
    intracellular,
    cysts: liveCysts.length,
    matureCysts: liveCysts.filter((c) => c.bradyzoites >= MATURE_CYST_BRADYZOITES).length,
    bradyzoitesInCysts: liveCysts.reduce((n, c) => n + c.bradyzoites, 0),
    cystsByNiche: countByNiche(liveCysts),
    cellsLysed: host.cellsLysed,
    sporulatedOocysts: world.oocysts.filter((o) => o.sporulated).length,
    peakLoad: Math.max(scratch.tally.peakLoad, load),
  }

  return {
    rng,
    compartment: world.compartment,
    lesionHours,
    actionSeconds: world.actionSeconds + dtA,
    host,
    abilities,
    agents,
    cells,
    cysts,
    oocysts: world.oocysts,
    overflow,
    gutCycles,
    oocystsReady,
    tally,
    log: scratch.log,
    nextId: scratch.nextId,
    justPassaged: false,
  }
}

function pickCumulative(t: Tally) {
  return {
    lyticCycles: t.lyticCycles,
    conversions: t.conversions,
    reactivations: t.reactivations,
    failedInvasions: t.failedInvasions,
    clearances: t.clearances,
    oocystsShed: t.oocystsShed,
    peakLoad: t.peakLoad,
    cellsLysed: t.cellsLysed,
  }
}

function countByNiche(cysts: Cyst[]): Record<NicheId, number> {
  const out = { skeletalMuscle: 0, cardiacMuscle: 0, retina: 0, cnsCortex: 0, cnsAmygdala: 0 }
  for (const c of cysts) if (c.intact) out[c.niche]++
  return out
}

function nearestTarget(cells: HostCell[], pos: Vec3): HostCell | null {
  let best: HostCell | null = null
  let bestD = Infinity
  for (const c of cells) {
    if (c.state !== 'healthy') continue
    const d = distV(c.pos, pos)
    if (d < bestD) {
      bestD = d
      best = c
    }
  }
  return best
}

// ---------------------------------------------------------------------------
// Oocysts (environment)
// ---------------------------------------------------------------------------

function stepOocysts(
  list: Oocyst[],
  cfg: ParasiteConfig,
  dtH: number,
  scratch: StepScratch,
  hour: number,
): Oocyst[] {
  const oxygen = clamp01(cfg.moisture * 0.6 + 0.4)
  const dryness = 1 - clamp01(cfg.moisture)
  const heat = clamp01((cfg.temperature - 25) / 30)
  /**
   * Weathering multiplier on the ideal shelf life. Desiccation and heat are
   * what actually kill oocysts, and the terms are squared so that mild
   * deviations cost little while a hot dry summer cuts 18 months to weeks:
   * cool and moist ≈ 1× (540 days), hot and dry ≈ 14× (under 6 weeks).
   */
  const weathering = 1 + 4 * dryness * dryness + 20 * heat * heat
  const out: Oocyst[] = []

  for (const prev of list) {
    const o = { ...prev }
    o.hoursInStage += dtH
    o.spin += dtH * 0.02

    // Oocysts are metabolically idle and simply weather, sporulated or not —
    // in hot dry soil a cohort can die before it ever matures. The shelf clock
    // runs on the compressed environmental gear so 18 months of viability fits
    // inside a session.
    o.shelfHours += dtH * OOCYST_AGEING
    o.viability = clamp01(
      // a sporont that has not finished its wall is the more fragile of the two
      o.viability - ((weathering * (o.sporulated ? 1 : 1.3)) / OOCYST_IDEAL_SHELF_HOURS) * dtH * OOCYST_AGEING,
    )

    if (!o.sporulated) {
      const t = nextTransition({
        stage: 'unsporulatedOocyst',
        compartment: 'environment',
        hoursInStage: o.hoursInStage,
        bfd: createBfdState(),
        immunity: 0,
        modifiers: cfg.modifiers,
        oxygen,
        temperature: cfg.temperature,
      })
      // Each oocyst draws its own target inside the documented 1–5 day window
      // at creation; poor aeration stretches it.
      if (t && o.hoursInStage >= o.sporulationTarget / Math.max(0.25, oxygen)) {
        o.sporulated = true
        o.hoursInStage = 0
        logEvent(scratch, hour, 'sporulation', 'An oocyst sporulated: 2 sporocysts × 4 sporozoites, now infectious.')
      }
    }
    if (o.viability > 0) out.push(o)
  }
  return out
}

// ---------------------------------------------------------------------------
// Passage actions — the transmission routes that close the life cycle
// ---------------------------------------------------------------------------

/** Lysed-cell count at which a host is considered to have a transmissible load. */
export const CARNIVORY_MIN_CYSTS = 1

/**
 * A felid eats the infected intermediate host. Bradyzoites from the cysts
 * enter enterocytes, where the sexual cycle can run.
 */
export function enterFelidGut(world: ParasiteWorld, cfg: ParasiteConfig): ParasiteWorld {
  const inoculum = Math.min(8, Math.max(1, world.cysts.filter((c) => c.intact).length))
  const rng = forkRng(world)
  const cells: HostCell[] = []
  for (let i = 0; i < CELL_COUNT; i++) cells.push(makeCell(i, rng, 'skeletalMuscle'))
  const agents: Agent[] = []
  for (let i = 0; i < inoculum; i++) {
    const dir = normalizeV({ x: nextRange(rng, -1, 1), y: nextRange(rng, -1, 1), z: nextRange(rng, -1, 1) })
    const a = makeAgent(world.nextId + i, 'bradyzoite', scaleV(dir, TISSUE_RADIUS * 0.5), rng)
    agents.push(a)
  }
  return {
    ...world,
    rng,
    compartment: 'felidGut',
    host: createHostState(cfg.immunosuppression),
    cells,
    agents,
    overflow: 0,
    gutCycles: 0,
    oocystsReady: 0,
    nextId: world.nextId + inoculum + 1,
    log: appendLog(world, 'passage', `A cat ate the host. ${inoculum} cysts opened in the felid gut.`),
    justPassaged: true,
  }
}

/**
 * Move to the environment compartment with a cohort of freshly deposited
 * (unsporulated) oocysts. Used both by felid shedding and by scenarios that
 * start in soil.
 */
export function seedEnvironment(world: ParasiteWorld, count = 24): ParasiteWorld {
  const rng = forkRng(world)
  const oocysts: Oocyst[] = []
  const n = Math.min(MAX_OOCYSTS, count)
  for (let i = 0; i < n; i++) {
    oocysts.push({
      id: world.nextId + i,
      sporulated: false,
      hoursInStage: 0,
      shelfHours: 0,
      viability: 1,
      sporulationTarget: nextRange(rng, SPORULATION_MIN_HOURS, SPORULATION_MAX_HOURS),
      pos: {
        x: nextRange(rng, -1, 1) * 40,
        y: nextRange(rng, -0.2, 0.2) * 6,
        z: nextRange(rng, -1, 1) * 40,
      },
      spin: nextFloat(rng) * Math.PI * 2,
    })
  }
  return {
    ...world,
    rng,
    compartment: 'environment',
    oocysts,
    agents: [],
    overflow: 0,
    nextId: world.nextId + n + 1,
    // a run that begins in soil has no host history to carry over
    log: [
      ...(world.lesionHours === 0 ? [] : world.log),
      {
        id: world.nextId + n,
        hour: world.lesionHours,
        kind: 'passage' as const,
        text: `${n} oocysts deposited in soil — unsporulated, and not yet infectious.`,
      },
    ],
    justPassaged: true,
  }
}

/**
 * Gametogony completed: the felid sheds oocysts into soil and water. Returns a
 * world in the environment compartment with individual oocysts to watch.
 */
export function shedToEnvironment(world: ParasiteWorld, count = 24): ParasiteWorld {
  const seeded = seedEnvironment(world, Math.min(count, Math.max(1, world.oocystsReady)))
  return {
    ...seeded,
    oocystsReady: 0,
    gutCycles: 0,
    tally: { ...seeded.tally, oocystsShed: seeded.tally.oocystsShed + OOCYSTS_PER_SHED },
    log: appendLog(
      world,
      'passage',
      `Oocysts shed into soil — ${OOCYSTS_PER_SHED.toLocaleString()} per cycle in reality; ${seeded.oocysts.length} tracked here.`,
    ),
  }
}

/** A new intermediate host ingests sporulated oocysts from the environment. */
export function ingestOocysts(world: ParasiteWorld, cfg: ParasiteConfig): ParasiteWorld {
  const viable = world.oocysts.filter((o) => o.sporulated && o.viability > 0)
  const inoculum = Math.min(8, Math.max(1, viable.length * SPOROZOITES_PER_OOCYST))
  const rng = forkRng(world)
  const cells: HostCell[] = []
  for (let i = 0; i < CELL_COUNT; i++) {
    cells.push(makeCell(i, rng, pickNiche(nextFloat(rng), { [cfg.nicheFocus]: 0.45 })))
  }
  const agents: Agent[] = []
  for (let i = 0; i < inoculum; i++) {
    const dir = normalizeV({ x: nextRange(rng, -1, 1), y: nextRange(rng, -1, 1), z: nextRange(rng, -1, 1) })
    agents.push(makeAgent(world.nextId + i, 'sporozoite', scaleV(dir, TISSUE_RADIUS * 0.6), rng))
  }
  return {
    ...world,
    rng,
    compartment: 'intermediateTissue',
    host: createHostState(cfg.immunosuppression),
    cells,
    agents,
    cysts: [],
    overflow: 0,
    oocysts: world.oocysts.filter((o) => !o.sporulated),
    nextId: world.nextId + inoculum + 1,
    log: appendLog(
      world,
      'passage',
      `A new intermediate host swallowed ${viable.length} sporulated oocysts — ${inoculum} sporozoites excysted.`,
    ),
    justPassaged: true,
  }
}

function appendLog(world: ParasiteWorld, kind: EventKind, text: string): SimEvent[] {
  const log = world.log.slice()
  log.push({ id: world.nextId, hour: world.lesionHours, kind, text })
  if (log.length > 48) log.splice(0, log.length - 48)
  return log
}

/**
 * Is there no parasite left anywhere in this world? The "too passive" loss: the
 * host cleared the acute infection and no cyst was banked before it did.
 *
 * An intact cyst counts as alive even with every tachyzoite gone — that *is*
 * latency, and it is the state the primary objective is trying to reach. Only
 * when the vacuoles, the free parasites, the overflow aggregate, the cysts, the
 * gut's waiting zygotes and the soil's viable oocysts are all empty has the
 * lineage actually ended.
 */
export function parasiteExtinct(world: ParasiteWorld): boolean {
  if (world.agents.length > 0) return false
  // the aggregate is fractional; less than one parasite is none
  if (world.overflow >= 1) return false
  if (world.cells.some((c) => c.pv !== null)) return false
  if (world.cysts.some((c) => c.intact)) return false
  if (world.oocystsReady > 0) return false
  return !world.oocysts.some((o) => o.viability > 0)
}

/** Which passage is available from the current state, if any. */
export function availablePassage(
  world: ParasiteWorld,
  cfg: ParasiteConfig,
): { id: 'felid' | 'shed' | 'ingest'; label: string; detail: string } | null {
  if (world.compartment === 'intermediateTissue') {
    const cysts = world.cysts.filter((c) => c.intact).length
    if (cysts < CARNIVORY_MIN_CYSTS) return null
    if (!PARASITE_SPECIES[cfg.species].felidCycle) return null
    return {
      id: 'felid',
      label: '🐈 Be eaten by a cat',
      detail: `${cysts} tissue cyst${cysts === 1 ? '' : 's'} ready for the definitive host.`,
    }
  }
  if (world.compartment === 'felidGut') {
    return world.oocystsReady > 0
      ? {
          id: 'shed',
          label: '🌱 Shed oocysts',
          detail: `${world.oocystsReady} zygote${world.oocystsReady === 1 ? '' : 's'} ready to pass into soil.`,
        }
      : null
  }
  const viable = world.oocysts.filter((o) => o.sporulated && o.viability > 0).length
  return viable > 0
    ? { id: 'ingest', label: '🐁 Infect a new host', detail: `${viable} sporulated oocyst${viable === 1 ? '' : 's'} viable.` }
    : null
}

/** Convenience for callers that only have a real dt and the shared speed. */
export function stepWorldRealtime(
  world: ParasiteWorld,
  cfg: ParasiteConfig,
  dtSeconds: number,
  speed: number,
): ParasiteWorld {
  return stepWorld(world, cfg, advanceClocks(dtSeconds, speed))
}
