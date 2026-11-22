import { describe, expect, it } from 'vitest'
import {
  COMMIT_THRESHOLD,
  canReactivate,
  createBfdState,
  isCommitted,
  stepBfd,
} from './bfdSwitch'
import {
  createEgressState,
  egressComplete,
  egressTrapped,
  PV_PH_PERMISSIVE,
  shouldTriggerEgress,
  stepEgress,
} from './egress'
import { createGlideState, glideAt, meanSpeed, PEAK_SPEED, stepGlide, tractionForce } from './glideosome'
import {
  beginInvasion,
  invasionFailed,
  invasionProgress,
  invasionSucceeded,
  MJ_PHASE_DEFS,
  stepInvasion,
} from './invasion'
import {
  createHostState,
  parasiteStress,
  stepHost,
  vacuolePressure,
  type NicheId,
} from './hostImmunity'
import { nextTransition } from './lifeCycleGraph'
import { createRng, distV, lengthV } from './math'
import { DEFAULT_MODIFIERS, PARASITE_SPECIES, resolveModifiers } from './modifiers'
import {
  evaluateObjective,
  isReservoirCyst,
  LATENT_TARGET,
  objectiveBlocked,
  reservoirCysts,
  RESERVOIR_NICHES,
  RUNAWAY_TARGET,
  WINTER_TARGET_DAYS,
} from './objectives'
import { DEFAULT_TUNING } from './tuning'
import {
  advanceClocks,
  cystDiameter,
  cystWallThickness,
  CYST_MAX_DIAMETER,
  CYST_MIN_DIAMETER,
  CYST_WALL_MAX,
  ENDODYOGENY_HOURS,
  SPORULATION_MIN_HOURS,
  STAGE_DEFS,
} from './stages'
import {
  availablePassage,
  createWorld,
  DEFAULT_CONFIG,
  enterFelidGut,
  parasiteExtinct,
  seedEnvironment,
  shedToEnvironment,
  stepWorld,
  TISSUE_RADIUS,
  type Cyst,
  type ParasiteConfig,
  type ParasiteWorld,
} from './world'

const cfg = (over: Partial<ParasiteConfig> = {}): ParasiteConfig => ({
  ...DEFAULT_CONFIG,
  ...over,
  modifiers: { ...DEFAULT_MODIFIERS, ...(over.modifiers ?? {}) },
  effectors: { ...DEFAULT_CONFIG.effectors, ...(over.effectors ?? {}) },
  stress: { ...DEFAULT_CONFIG.stress, ...(over.stress ?? {}) },
})

/** Run the world forward by `hours` of lesion time in fixed small steps. */
function run(world: ReturnType<typeof createWorld>, config: ParasiteConfig, hours: number) {
  let w = world
  const clocks = advanceClocks(1 / 60, 0.5)
  const steps = Math.ceil(hours / clocks.lesion)
  for (let i = 0; i < steps; i++) w = stepWorld(w, config, clocks)
  return w
}

// ---------------------------------------------------------------------------
describe('stage dimensions', () => {
  it('matches the research parameter table', () => {
    expect(STAGE_DEFS.tachyzoite.length).toBe(6)
    expect(STAGE_DEFS.tachyzoite.width).toBe(2)
    expect(STAGE_DEFS.bradyzoite.length).toBe(7)
    expect(STAGE_DEFS.bradyzoite.width).toBe(1.5)
    expect(STAGE_DEFS.sporulatedOocyst.length).toBe(13)
    expect(STAGE_DEFS.tachyzoite.speed).toBe(PEAK_SPEED)
  })

  it('grows a cyst from 5 µm / 2 bradyzoites to ~70 µm / 1000+', () => {
    expect(cystDiameter(2)).toBeCloseTo(CYST_MIN_DIAMETER, 5)
    expect(cystDiameter(1024)).toBeCloseTo(CYST_MAX_DIAMETER, 5)
    expect(cystDiameter(200)).toBeGreaterThan(cystDiameter(20))
    // the wall stays under the measured 0.5 µm at every size
    for (const n of [2, 16, 128, 1024, 5000]) {
      expect(cystWallThickness(n)).toBeLessThanOrEqual(CYST_WALL_MAX)
    }
  })
})

describe('time base', () => {
  it('scales both gears with the shared speed slider', () => {
    const a = advanceClocks(1, 0.5)
    const b = advanceClocks(1, 1)
    expect(b.lesion).toBeCloseTo(a.lesion * 2, 6)
    expect(b.action).toBeCloseTo(a.action * 2, 6)
  })

  it('puts one endodyogeny within ~8 real seconds at 1x', () => {
    const perSecond = advanceClocks(1, 0.5).lesion
    expect(ENDODYOGENY_HOURS / perSecond).toBeGreaterThan(4)
    expect(ENDODYOGENY_HOURS / perSecond).toBeLessThan(12)
  })
})

// ---------------------------------------------------------------------------
describe('BFD1/BFD2 switch', () => {
  it('stays repressed without stress', () => {
    let s = createBfdState()
    for (let i = 0; i < 400; i++) s = stepBfd(s, { stress: 0.1, dtHours: 1 })
    expect(isCommitted(s)).toBe(false)
    expect(s.locked).toBe(false)
  })

  it('commits and then latches under sustained stress', () => {
    let s = createBfdState()
    for (let i = 0; i < 60 && !s.locked; i++) s = stepBfd(s, { stress: 0.9, dtHours: 1 })
    expect(isCommitted(s)).toBe(true)
    expect(s.locked).toBe(true)
    expect(s.everLocked).toBe(true)
  })

  it('holds the latch after the stressor is withdrawn (positive feedback)', () => {
    let s = createBfdState()
    for (let i = 0; i < 60 && !s.locked; i++) s = stepBfd(s, { stress: 0.9, dtHours: 1 })
    expect(s.locked).toBe(true)
    for (let i = 0; i < 200; i++) s = stepBfd(s, { stress: 0, dtHours: 1, immunity: 1 })
    expect(s.locked).toBe(true)
    expect(s.bfd1).toBeGreaterThanOrEqual(COMMIT_THRESHOLD)
  })

  it('never converts in a ΔBFD1 background', () => {
    let s = createBfdState()
    for (let i = 0; i < 300; i++) s = stepBfd(s, { stress: 1, dtHours: 1, deltaBfd1: true })
    expect(s.bfd1).toBe(0)
    expect(isCommitted(s)).toBe(false)
  })

  it('reactivates only once immunity has collapsed', () => {
    let s = createBfdState()
    for (let i = 0; i < 60 && !s.locked; i++) s = stepBfd(s, { stress: 0.9, dtHours: 1 })
    // intact immunity: no release, however long we wait
    for (let i = 0; i < 300; i++) s = stepBfd(s, { stress: 0.2, dtHours: 1, immunity: 0.8 })
    expect(canReactivate(s, 0.8)).toBe(false)
    expect(s.locked).toBe(true)
    // immunity gone: the program winds down and the cyst can reactivate
    for (let i = 0; i < 80; i++) s = stepBfd(s, { stress: 0.2, dtHours: 1, immunity: 0 })
    expect(canReactivate(s, 0)).toBe(true)
  })

  it('never reactivates with terminal latency (Hammondia preset)', () => {
    let s = createBfdState()
    for (let i = 0; i < 60 && !s.locked; i++) s = stepBfd(s, { stress: 0.9, dtHours: 1, lockedLatency: true })
    for (let i = 0; i < 400; i++) s = stepBfd(s, { stress: 0, dtHours: 1, immunity: 0, lockedLatency: true })
    expect(canReactivate(s, 0, true)).toBe(false)
    expect(s.bfd1).toBeGreaterThanOrEqual(COMMIT_THRESHOLD)
  })
})

// ---------------------------------------------------------------------------
describe('glideosome', () => {
  it('moves in periodic bursts, not at a constant speed', () => {
    const rng = createRng(7)
    let g = createGlideState({ x: 0, y: 0, z: 0 }, rng)
    const speeds: number[] = []
    for (let i = 0; i < 240; i++) {
      g = stepGlide(g, { dtSeconds: 1 / 60, substrate: 1, adhesin: true, rng })
      speeds.push(g.speed)
    }
    const max = Math.max(...speeds)
    const min = Math.min(...speeds)
    expect(max).toBeGreaterThan(1.5)
    expect(max).toBeLessThanOrEqual(PEAK_SPEED + 1e-6)
    // there are moments of near-zero speed between power strokes
    expect(min).toBeLessThan(0.2)
    expect(g.cycles).toBeGreaterThan(0)
  })

  it('follows a helical path rather than a straight line', () => {
    const rng = createRng(11)
    let g = glideAt({ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 1 })
    const start = g.pos
    for (let i = 0; i < 600; i++) {
      g = stepGlide(g, { dtSeconds: 1 / 60, substrate: 1, adhesin: true, rng })
    }
    const straight = distV(start, g.pos)
    // path length clearly exceeds the straight-line displacement: it curves
    expect(g.distance).toBeGreaterThan(5)
    expect(straight).toBeLessThan(g.distance * 0.95)
    // and the heading has turned away from its initial direction
    expect(g.heading.z).toBeLessThan(0.999)
  })

  it('slips without adhesin (ΔMIC2): traction makes almost no headway', () => {
    const wt = createRng(3)
    const ko = createRng(3)
    let a = glideAt({ x: 0, y: 0, z: 0 })
    let b = glideAt({ x: 0, y: 0, z: 0 })
    for (let i = 0; i < 600; i++) {
      a = stepGlide(a, { dtSeconds: 1 / 60, substrate: 1, adhesin: true, rng: wt })
      b = stepGlide(b, { dtSeconds: 1 / 60, substrate: 1, adhesin: false, rng: ko })
    }
    expect(b.slipping).toBe(true)
    expect(lengthV(b.pos)).toBeLessThan(lengthV(a.pos) * 0.2)
  })

  it('reports inward traction that peaks mid-stroke and vanishes between strokes', () => {
    const rng = createRng(5)
    let g = glideAt({ x: 0, y: 0, z: 0 })
    const forces: number[] = []
    for (let i = 0; i < 120; i++) {
      g = stepGlide(g, { dtSeconds: 1 / 120, substrate: 1, adhesin: true, rng })
      forces.push(tractionForce(g))
    }
    expect(Math.max(...forces)).toBeGreaterThan(0.5)
    expect(Math.min(...forces)).toBe(0)
  })

  it('has a mean speed well below the 3 µm/s peak', () => {
    expect(meanSpeed(1)).toBeLessThan(PEAK_SPEED)
    expect(meanSpeed(1)).toBeGreaterThan(0.5)
    expect(meanSpeed(0)).toBe(0)
  })
})

// ---------------------------------------------------------------------------
describe('moving junction', () => {
  const stepTo = (traction: number, seed = 1, deltaMic2 = false) => {
    const rng = createRng(seed)
    let mj = beginInvasion(0)
    for (let i = 0; i < 4000 && !invasionSucceeded(mj) && !invasionFailed(mj); i++) {
      mj = stepInvasion(mj, { dtSeconds: 0.05, traction, pressure: 0, rng, deltaMic2 })
    }
    return mj
  }

  it('runs the phases in order and seals a vacuole with good traction', () => {
    const mj = stepTo(1)
    expect(invasionSucceeded(mj)).toBe(true)
    expect(mj.phase).toBe('vacuoleSealed')
    expect(invasionProgress(mj)).toBe(1)
  })

  it('fails in the junction when AMA1 is shed before the ring closes', () => {
    // no traction: reorientation drags on, ROM4/5 strip free AMA1 meanwhile
    const mj = stepTo(0)
    expect(invasionFailed(mj)).toBe(true)
    expect(mj.failure === 'ama1Shed' || mj.failure === 'noTraction').toBe(true)
  })

  it('cannot cross the ring at all in a ΔMIC2 background', () => {
    const mj = stepTo(1, 2, true)
    expect(invasionSucceeded(mj)).toBe(false)
    expect(invasionFailed(mj)).toBe(true)
  })

  it('aborts under heavy host pressure, and never without it', () => {
    const attempt = (pressure: number, seed: number) => {
      const rng = createRng(seed)
      let mj = beginInvasion(0)
      for (let i = 0; i < 4000 && !invasionSucceeded(mj) && !invasionFailed(mj); i++) {
        mj = stepInvasion(mj, { dtSeconds: 0.05, traction: 1, pressure, rng })
      }
      return mj
    }
    const seeds = Array.from({ length: 40 }, (_, i) => i + 1)
    // Clearance is a hazard rate, so it is a probability, not a certainty: at
    // full pressure a clear majority of attempts should be aborted.
    const resisted = seeds.filter((s) => attempt(1, s).failure === 'hostResisted').length
    expect(resisted).toBeGreaterThan(seeds.length * 0.3)
    // and with a quiet host, none of them are
    expect(seeds.every((s) => invasionSucceeded(attempt(0, s)))).toBe(true)
  })

  it('spends most of its time actually crossing the junction', () => {
    const total = Object.values(MJ_PHASE_DEFS).reduce((n, d) => n + d.duration, 0)
    expect(MJ_PHASE_DEFS.penetrating.duration / total).toBeGreaterThan(0.4)
  })
})

// ---------------------------------------------------------------------------
describe('egress', () => {
  it('acidifies, spikes calcium, perforates, then ruptures — in that order', () => {
    const rng = createRng(4)
    let e = createEgressState()
    const seen: string[] = []
    for (let i = 0; i < 2000 && !egressComplete(e); i++) {
      e = stepEgress(e, { dtSeconds: 0.02, triggered: true, rng })
      if (seen[seen.length - 1] !== e.phase) seen.push(e.phase)
    }
    expect(egressComplete(e)).toBe(true)
    expect(seen).toContain('acidifying')
    expect(seen).toContain('perforating')
    expect(seen[seen.length - 1]).toBe('ruptured')
    expect(seen.indexOf('acidifying')).toBeLessThan(seen.indexOf('perforating'))
    expect(e.ph).toBeCloseTo(PV_PH_PERMISSIVE, 5)
  })

  it('traps a Δplp1 vacuole with no pores', () => {
    const rng = createRng(4)
    let e = createEgressState()
    for (let i = 0; i < 2000 && !egressTrapped(e); i++) {
      e = stepEgress(e, { dtSeconds: 0.02, triggered: true, deltaPlp1: true, rng })
    }
    expect(egressTrapped(e)).toBe(true)
    expect(e.pores).toBe(0)
    expect(egressComplete(e)).toBe(false)
    // the lesion still resolves, but by host inflammation
    for (let i = 0; i < 4000 && e.inflammation < 1; i++) {
      e = stepEgress(e, { dtSeconds: 0.05, triggered: true, deltaPlp1: true, pressure: 1, rng })
    }
    expect(e.inflammation).toBeCloseTo(1, 5)
  })

  it('relaxes back to resting pH if the trigger is withdrawn', () => {
    const rng = createRng(4)
    let e = createEgressState()
    for (let i = 0; i < 20; i++) e = stepEgress(e, { dtSeconds: 0.05, triggered: true, rng })
    expect(e.ph).toBeLessThan(7.2)
    for (let i = 0; i < 400; i++) e = stepEgress(e, { dtSeconds: 0.05, triggered: false, rng })
    expect(e.phase).toBe('quiescent')
    expect(e.ph).toBeCloseTo(7.2, 5)
  })

  it('triggers on a full vacuole', () => {
    expect(shouldTriggerEgress(64, 64, 0, 0)).toBe(true)
    expect(shouldTriggerEgress(4, 64, 0, 0)).toBe(false)
    expect(shouldTriggerEgress(32, 64, 0.9, 0)).toBe(true)
  })
})

// ---------------------------------------------------------------------------
describe('life-cycle graph', () => {
  const base = {
    compartment: 'environment' as const,
    bfd: createBfdState(),
    immunity: 1,
    modifiers: DEFAULT_MODIFIERS,
  }

  it('sporulates only after the documented window, with oxygen', () => {
    const early = nextTransition({ ...base, stage: 'unsporulatedOocyst', hoursInStage: 10, oxygen: 1, temperature: 22 })
    expect(early).toBeNull()
    const ok = nextTransition({
      ...base,
      stage: 'unsporulatedOocyst',
      hoursInStage: SPORULATION_MIN_HOURS + 1,
      oxygen: 1,
      temperature: 22,
    })
    expect(ok?.to).toBe('sporulatedOocyst')
    const anoxic = nextTransition({
      ...base,
      stage: 'unsporulatedOocyst',
      hoursInStage: 200,
      oxygen: 0,
      temperature: 22,
    })
    expect(anoxic).toBeNull()
  })

  it('excysts sporozoites under bile and trypsin', () => {
    const gut = nextTransition({ ...base, compartment: 'felidGut', stage: 'sporulatedOocyst', hoursInStage: 1, bile: 0.8 })
    expect(gut?.to).toBe('sporozoite')
    const noBile = nextTransition({ ...base, compartment: 'felidGut', stage: 'sporulatedOocyst', hoursInStage: 1, bile: 0 })
    expect(noBile).toBeNull()
  })

  it('converts tachyzoite → bradyzoite only when BFD1 is committed', () => {
    let bfd = createBfdState()
    const ctx = { ...base, compartment: 'intermediateTissue' as const, stage: 'tachyzoite' as const, hoursInStage: 20 }
    expect(nextTransition({ ...ctx, bfd })).toBeNull()
    for (let i = 0; i < 60 && !bfd.locked; i++) bfd = stepBfd(bfd, { stress: 0.9, dtHours: 1 })
    expect(nextTransition({ ...ctx, bfd })?.to).toBe('bradyzoite')
  })

  it('keeps sporulation out of the gut and excystation out of the soil', () => {
    expect(
      nextTransition({ ...base, compartment: 'felidGut', stage: 'unsporulatedOocyst', hoursInStage: 500, oxygen: 1 }),
    ).toBeNull()
    expect(
      nextTransition({ ...base, compartment: 'environment', stage: 'sporulatedOocyst', hoursInStage: 5, bile: 1 }),
    ).toBeNull()
  })
})

// ---------------------------------------------------------------------------
describe('host immunity', () => {
  it('ramps IFN-γ and IRG with sustained load, then damages the host', () => {
    let host = createHostState()
    for (let i = 0; i < 400; i++) {
      host = stepHost(host, { load: 60, lysedThisStep: 0.3, effectors: { rop16: false, rop18rop5: false, tgist: false }, dtHours: 1 })
    }
    expect(host.fields.ifnGamma).toBeGreaterThan(0.3)
    expect(host.fields.irg).toBeGreaterThan(0.2)
    expect(host.health).toBeLessThan(1)
  })

  it('ROP16 blunts IL-12, NO and ROS via M2 polarisation', () => {
    const inputs = { load: 50, lysedThisStep: 0.2, dtHours: 1 }
    let plain = createHostState()
    let m2 = createHostState()
    for (let i = 0; i < 300; i++) {
      plain = stepHost(plain, { ...inputs, effectors: { rop16: false, rop18rop5: false, tgist: false } })
      m2 = stepHost(m2, { ...inputs, effectors: { rop16: true, rop18rop5: false, tgist: false } })
    }
    expect(m2.m2).toBeGreaterThan(0.4)
    expect(m2.fields.no).toBeLessThan(plain.fields.no)
    expect(m2.fields.ros).toBeLessThan(plain.fields.ros)
    expect(m2.fields.il12).toBeLessThan(plain.fields.il12)
  })

  it('ROP18/ROP5 shields a vacuole from IRG pressure', () => {
    let host = createHostState()
    for (let i = 0; i < 300; i++) {
      host = stepHost(host, { load: 60, lysedThisStep: 0.3, effectors: { rop16: false, rop18rop5: false, tgist: false }, dtHours: 1 })
    }
    const bare = vacuolePressure(host, 'skeletalMuscle', { rop16: false, rop18rop5: false, tgist: false })
    const shielded = vacuolePressure(host, 'skeletalMuscle', { rop16: false, rop18rop5: true, tgist: false })
    expect(shielded).toBeLessThan(bare)
  })

  it('shelters immune-privileged niches', () => {
    let host = createHostState()
    for (let i = 0; i < 300; i++) {
      host = stepHost(host, { load: 60, lysedThisStep: 0.3, effectors: { rop16: false, rop18rop5: false, tgist: false }, dtHours: 1 })
    }
    const eff = { rop16: false, rop18rop5: false, tgist: false }
    expect(vacuolePressure(host, 'cnsAmygdala', eff)).toBeLessThan(vacuolePressure(host, 'skeletalMuscle', eff))
  })

  it('counts player stressors toward the BFD1 gate', () => {
    const host = createHostState()
    const quiet = parasiteStress(host, 'cnsCortex', { alkaline: 0, starvation: 0, heatShock: 0 }, host0Effectors)
    const alkaline = parasiteStress(host, 'cnsCortex', { alkaline: 1, starvation: 0, heatShock: 0 }, host0Effectors)
    expect(alkaline).toBeGreaterThan(quiet)
    expect(alkaline).toBeGreaterThan(0.3)
  })
})

const host0Effectors = { rop16: false, rop18rop5: false, tgist: false }

// ---------------------------------------------------------------------------
describe('world', () => {
  it('is deterministic for a given seed', () => {
    const c = cfg()
    const a = run(createWorld(c, 123), c, 200)
    const b = run(createWorld(c, 123), c, 200)
    expect(a.tally).toEqual(b.tally)
    expect(a.lesionHours).toBeCloseTo(b.lesionHours, 6)
    expect(a.host.health).toBeCloseTo(b.host.health, 10)
  })

  it('completes the lytic cycle: invade → PV → replicate → egress', () => {
    const c = cfg()
    const w = run(createWorld(c, 42), c, 400)
    expect(w.tally.lyticCycles).toBeGreaterThan(0)
    expect(w.host.cellsLysed).toBeGreaterThan(0)
    expect(w.log.some((e) => e.kind === 'invasion')).toBe(true)
    expect(w.log.some((e) => e.kind === 'egress')).toBe(true)
  })

  it('keeps every parasite inside the tissue volume', () => {
    const c = cfg()
    const w = run(createWorld(c, 8), c, 150)
    for (const a of w.agents) {
      expect(lengthV(a.glide.pos)).toBeLessThanOrEqual(TISSUE_RADIUS + 1e-6)
    }
  })

  it('reaches latency when the player pushes stress', () => {
    const c = cfg({ stress: { alkaline: 1, starvation: 0.6, heatShock: 0 } })
    const w = run(createWorld(c, 42), c, 900)
    expect(w.tally.conversions).toBeGreaterThan(0)
    expect(w.tally.cysts).toBeGreaterThan(0)
    expect(w.tally.bradyzoitesInCysts).toBeGreaterThan(1)
  })

  it('never forms a cyst in a ΔBFD1 run', () => {
    const c = cfg({ modifiers: { ...DEFAULT_MODIFIERS, deltaBfd1: true }, stress: { alkaline: 1, starvation: 1, heatShock: 1 } })
    const w = run(createWorld(c, 42), c, 900)
    expect(w.tally.cysts).toBe(0)
    expect(w.tally.conversions).toBe(0)
  })

  it('makes ΔMIC2 parasites fail to establish', () => {
    const wt = cfg()
    const ko = cfg({ modifiers: { ...DEFAULT_MODIFIERS, deltaMic2: true } })
    const a = run(createWorld(wt, 77), wt, 300)
    const b = run(createWorld(ko, 77), ko, 300)
    expect(b.tally.lyticCycles).toBeLessThan(a.tally.lyticCycles)
    expect(b.cells.filter((c) => c.pv).length).toBeLessThanOrEqual(a.cells.filter((c) => c.pv).length)
  })

  it('sporulates oocysts inside the documented 1–5 day window', () => {
    const cool = cfg({ temperature: 12, moisture: 0.95 })
    const early = run(seedEnvironment(createWorld(cool, 5), 20), cool, 20)
    expect(early.tally.sporulatedOocysts).toBe(0) // nothing before 1 day
    const later = run(seedEnvironment(createWorld(cool, 5), 20), cool, 130)
    expect(later.tally.sporulatedOocysts).toBeGreaterThan(0) // all within 5 days
    expect(later.log.some((e) => e.kind === 'sporulation')).toBe(true)
  })

  it('weathers oocysts away far faster when hot and dry', () => {
    const cool = cfg({ temperature: 12, moisture: 0.95 })
    const hot = cfg({ temperature: 44, moisture: 0.02 })
    const viable = (w: ReturnType<typeof createWorld>) =>
      w.oocysts.filter((o) => o.sporulated && o.viability > 0).length
    const a = run(seedEnvironment(createWorld(cool, 5), 20), cool, 130)
    const b = run(seedEnvironment(createWorld(hot, 5), 20), hot, 130)
    expect(viable(a)).toBeGreaterThan(viable(b))
    // given long enough, the hot dry cohort is simply gone
    expect(run(seedEnvironment(createWorld(hot, 5), 20), hot, 1500).oocysts.length).toBe(0)
  })

  it('lets an ideally stored oocyst outlast the endurance objective', () => {
    const ideal = cfg({ temperature: 15, moisture: 1 })
    const w = run(seedEnvironment(createWorld(ideal, 5), 12), ideal, 130)
    const shelfDays = Math.max(
      0,
      ...w.oocysts.filter((o) => o.sporulated && o.viability > 0).map((o) => o.shelfHours / 24),
    )
    expect(shelfDays).toBeGreaterThan(WINTER_TARGET_DAYS)
  })

  it('runs the felid passage through gametogony and back to soil', () => {
    const c = cfg({ stress: { alkaline: 1, starvation: 0.5, heatShock: 0 } })
    let w = run(createWorld(c, 42), c, 700)
    expect(w.cysts.filter((x) => x.intact).length).toBeGreaterThan(0)
    expect(availablePassage(w, c)?.id).toBe('felid')

    w = enterFelidGut(w, c)
    expect(w.compartment).toBe('felidGut')
    expect(w.agents.length).toBeGreaterThan(0)
    expect(w.agents.every((a) => a.stage === 'bradyzoite')).toBe(true)
    // nothing to shed until the sexual cycle has actually run
    expect(availablePassage(w, c)).toBeNull()

    w = run(w, c, 600)
    expect(w.oocystsReady).toBeGreaterThan(0)
    expect(availablePassage(w, c)?.id).toBe('shed')

    const ready = w.oocystsReady
    w = shedToEnvironment(w, 12)
    expect(w.compartment).toBe('environment')
    expect(w.oocysts.length).toBe(Math.min(12, ready))
    expect(w.oocystsReady).toBe(0)
    expect(w.tally.oocystsShed).toBeGreaterThan(0)
  })

  it('does not step while both clocks are zero', () => {
    const c = cfg()
    const w = createWorld(c, 1)
    expect(stepWorld(w, c, { action: 0, lesion: 0 })).toBe(w)
  })
})

// ---------------------------------------------------------------------------
describe('objectives', () => {
  /** A world holding `n` cysts of `diameter` µm in `niche`, at day `day`. */
  function withCysts(
    base: ParasiteWorld,
    n: number,
    opts: { diameter?: number; niche?: NicheId; day?: number; health?: number } = {},
  ): ParasiteWorld {
    const diameter = opts.diameter ?? DEFAULT_TUNING.matureDiameterUm
    const niche = opts.niche ?? 'cnsCortex'
    const cysts: Cyst[] = Array.from({ length: n }, (_, i) => ({
      id: 1000 + i,
      niche,
      pos: { x: 0, y: 0, z: 0 },
      diameter,
      wall: 0.4,
      bradyzoites: 512,
      ageHours: 500,
      bfd: { bfd1: 1, bfd2: 1, locked: true, everLocked: true, committedHours: 400 },
      divisionTimer: 0,
      intact: true,
    }))
    return {
      ...base,
      lesionHours: (opts.day ?? 0) * 24,
      host: { ...base.host, health: opts.health ?? 0.8 },
      cysts,
      tally: { ...base.tally, cysts: n, matureCysts: n },
    }
  }

  it('starts active and reports progress toward the latency target', () => {
    const c = cfg()
    const w = createWorld(c, 1)
    const p = evaluateObjective('latentPassage', w, c)
    expect(p.status).toBe('active')
    expect(p.progress).toBe(0)
    expect(p.metric).toContain(String(LATENT_TARGET))
  })

  it('loses the latency objective when the host dies', () => {
    const c = cfg()
    const w = createWorld(c, 1)
    const dead = { ...w, host: { ...w.host, health: 0 } }
    const p = evaluateObjective('latentPassage', dead, c)
    expect(p.status).toBe('lost')
    expect(p.reason).toMatch(/died/i)
  })

  it('loses the latency objective when the host is merely dying, not yet dead', () => {
    const c = cfg()
    const w = createWorld(c, 1)
    const sick = { ...w, host: { ...w.host, health: c.tuning.hostFloor } }
    const p = evaluateObjective('latentPassage', sick, c)
    expect(p.status).toBe('lost')
    expect(p.reason).toMatch(/floor/i)
  })

  it('only counts intact, well-grown cysts in CNS or muscle as reservoir', () => {
    const tuning = DEFAULT_TUNING
    const base: Cyst = {
      id: 1,
      niche: 'cnsCortex',
      pos: { x: 0, y: 0, z: 0 },
      diameter: tuning.matureDiameterUm,
      wall: 0.4,
      bradyzoites: 512,
      ageHours: 1,
      bfd: { bfd1: 1, bfd2: 1, locked: true, everLocked: true, committedHours: 1 },
      divisionTimer: 0,
      intact: true,
    }
    expect(isReservoirCyst(base, tuning)).toBe(true)
    // one short of the diameter, ruptured, or in the retina: none of them count
    expect(isReservoirCyst({ ...base, diameter: tuning.matureDiameterUm - 0.1 }, tuning)).toBe(false)
    expect(isReservoirCyst({ ...base, intact: false }, tuning)).toBe(false)
    expect(isReservoirCyst({ ...base, niche: 'retina' }, tuning)).toBe(false)
    for (const niche of RESERVOIR_NICHES) {
      expect(isReservoirCyst({ ...base, niche }, tuning)).toBe(true)
    }
  })

  it('does not win before the window closes, however many cysts are banked', () => {
    const c = cfg()
    const w = withCysts(createWorld(c, 1), c.tuning.latentTarget * 2, { day: c.tuning.holdDays - 1 })
    const p = evaluateObjective('latentPassage', w, c)
    expect(reservoirCysts(w, c.tuning)).toBeGreaterThan(c.tuning.latentTarget)
    expect(p.status).toBe('active')
    // the cyst half of the bar is full, the time half is not
    expect(p.progress).toBeGreaterThan(0.9)
    expect(p.progress).toBeLessThan(1)
  })

  it('wins at the deadline on enough reservoir cysts with a live host', () => {
    const c = cfg()
    const w = withCysts(createWorld(c, 1), c.tuning.latentTarget, { day: c.tuning.holdDays })
    const p = evaluateObjective('latentPassage', w, c)
    expect(p.status).toBe('won')
    expect(p.progress).toBe(1)
    expect(p.reason).toMatch(/latency established/i)
  })

  it('loses at the deadline when the reservoir is one cyst short', () => {
    const c = cfg()
    const w = withCysts(createWorld(c, 1), c.tuning.latentTarget - 1, { day: c.tuning.holdDays })
    const p = evaluateObjective('latentPassage', w, c)
    expect(p.status).toBe('lost')
    expect(p.reason).toMatch(/window/i)
  })

  it('does not count retinal cysts toward the win, and says so', () => {
    const c = cfg()
    const w = withCysts(createWorld(c, 1), c.tuning.latentTarget, { day: c.tuning.holdDays, niche: 'retina' })
    const p = evaluateObjective('latentPassage', w, c)
    expect(p.status).toBe('lost')
    expect(p.detail.join(' ')).toMatch(/retinal/i)
  })

  it('loses the latency objective the moment the host clears the lineage', () => {
    const c = cfg()
    const w = createWorld(c, 1)
    const cleared: ParasiteWorld = {
      ...w,
      lesionHours: 24 * 5,
      agents: [],
      overflow: 0,
      cells: w.cells.map((cell) => ({ ...cell, pv: null })),
      cysts: [],
      oocysts: [],
      oocystsReady: 0,
    }
    expect(parasiteExtinct(cleared)).toBe(true)
    const p = evaluateObjective('latentPassage', cleared, c)
    expect(p.status).toBe('lost')
    expect(p.reason).toMatch(/cleared/i)
  })

  it('does not call a lineage extinct while a cyst or a fraction of the pool survives', () => {
    const c = cfg()
    const w = createWorld(c, 1)
    const bare: ParasiteWorld = {
      ...w,
      agents: [],
      overflow: 0,
      cells: w.cells.map((cell) => ({ ...cell, pv: null })),
      cysts: [],
      oocysts: [],
      oocystsReady: 0,
    }
    // one intact cyst *is* latency, which is what the objective wants
    expect(parasiteExtinct(withCysts(bare, 1))).toBe(false)
    // a whole parasite still in the aggregate pool counts; a fraction does not
    expect(parasiteExtinct({ ...bare, overflow: 1 })).toBe(false)
    expect(parasiteExtinct({ ...bare, overflow: 0.4 })).toBe(true)
  })

  it('reads its thresholds from the config, so the debug panel can retune a live run', () => {
    const w = withCysts(createWorld(cfg(), 1), 3, { day: 10 })
    const strict = cfg({ tuning: { ...DEFAULT_TUNING, latentTarget: 8, holdDays: 30 } })
    const lenient = cfg({ tuning: { ...DEFAULT_TUNING, latentTarget: 3, holdDays: 10 } })
    expect(evaluateObjective('latentPassage', w, strict).status).toBe('active')
    expect(evaluateObjective('latentPassage', w, lenient).status).toBe('won')
  })

  it('wins the runaway objective on lytic cycles, loses it on host death', () => {
    const c = cfg({ modifiers: { ...DEFAULT_MODIFIERS, deltaBfd1: true } })
    const w = createWorld(c, 1)
    const won = { ...w, tally: { ...w.tally, lyticCycles: RUNAWAY_TARGET } }
    expect(evaluateObjective('runaway', won, c).status).toBe('won')
    const lost = { ...w, host: { ...w.host, health: 0 } }
    expect(evaluateObjective('runaway', lost, c).status).toBe('lost')
  })

  it('flags objectives that a modifier makes impossible', () => {
    expect(objectiveBlocked('latentPassage', { ...DEFAULT_MODIFIERS, deltaBfd1: true })).toBeTruthy()
    expect(objectiveBlocked('runaway', { ...DEFAULT_MODIFIERS, deltaBfd1: true })).toBeNull()
    expect(objectiveBlocked('latentPassage', DEFAULT_MODIFIERS)).toBeNull()
  })
})

// ---------------------------------------------------------------------------
describe('comparative species', () => {
  it('forces terminal latency for H. hammondi', () => {
    const mods = resolveModifiers('hhammondi', DEFAULT_MODIFIERS)
    expect(mods.lockedLatency).toBe(true)
    expect(PARASITE_SPECIES.hhammondi.felidCycle).toBe(true)
  })

  it('has no feline sexual cycle for N. caninum or B. besnoiti', () => {
    expect(PARASITE_SPECIES.ncaninum.felidCycle).toBe(false)
    expect(PARASITE_SPECIES.bbesnoiti.felidCycle).toBe(false)
  })
})
