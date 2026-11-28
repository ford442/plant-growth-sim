import { describe, expect, it } from 'vitest'
import {
  ABILITY_DEFS,
  ABILITY_IDS,
  abilityActive,
  abilityAvailability,
  abilityUnlocked,
  activateAbility,
  activeEffectors,
  createAbilityStates,
  stepAbilities,
  type AbilityStates,
} from './abilities'
import { DEFAULT_EFFECTORS, type EffectorFlags } from './hostImmunity'
import { FIXED_STEP_CLOCKS } from './fixedStep'

const wild: EffectorFlags = { ...DEFAULT_EFFECTORS }
/** Conversions high enough that nothing is locked. */
const UNLOCKED = 99

const fire = (states: AbilityStates, id: Parameters<typeof activateAbility>[1], conversions = UNLOCKED) =>
  activateAbility(states, id, wild, conversions)

describe('abilities: the cooldown economy', () => {
  it('starts every ability idle and ready', () => {
    const s = createAbilityStates()
    for (const id of ABILITY_IDS) {
      expect(s[id]).toEqual({ activeHours: 0, cooldownHours: 0, uses: 0 })
      expect(abilityActive(s, id)).toBe(false)
    }
    // ...but TgIST is locked until the run has converted something
    expect(abilityAvailability('rop16', s, wild, 0).ready).toBe(true)
    expect(abilityAvailability('tgist', s, wild, 0).ready).toBe(false)
    expect(abilityAvailability('tgist', s, wild, 1).ready).toBe(true)
  })

  it('secretes for its duration, then locks out for its cooldown', () => {
    const def = ABILITY_DEFS.rop18rop5
    let s = fire(createAbilityStates(), 'rop18rop5')
    expect(s.rop18rop5.activeHours).toBe(def.durationHours)
    expect(s.rop18rop5.uses).toBe(1)

    // half-way through secretion it is still acting, and cannot be re-fired
    s = stepAbilities(s, def.durationHours / 2)
    expect(abilityActive(s, 'rop18rop5')).toBe(true)
    expect(fire(s, 'rop18rop5')).toBe(s) // no-op, identity preserved

    // past the duration: silent, and recharging
    s = stepAbilities(s, def.durationHours / 2 + 1)
    expect(abilityActive(s, 'rop18rop5')).toBe(false)
    expect(s.rop18rop5.cooldownHours).toBeCloseTo(def.cooldownHours - 1, 9)
    expect(abilityAvailability('rop18rop5', s, wild, UNLOCKED).blocked).toMatch(/recharg/i)

    // and ready again once it has run down
    s = stepAbilities(s, def.cooldownHours)
    expect(s.rop18rop5).toEqual({ activeHours: 0, cooldownHours: 0, uses: 1 })
    expect(fire(s, 'rop18rop5')).not.toBe(s)
  })

  it('charges the step that ends secretion against the cooldown, so step size does not matter', () => {
    const def = ABILITY_DEFS.rop16
    // a whole number of fixed steps, landing part-way into the cooldown
    const n = Math.round((def.durationHours + def.cooldownHours * 0.5) / FIXED_STEP_CLOCKS.lesion)
    const span = n * FIXED_STEP_CLOCKS.lesion
    expect(span).toBeGreaterThan(def.durationHours)
    expect(span).toBeLessThan(def.durationHours + def.cooldownHours)

    // one long step
    const once = stepAbilities(fire(createAbilityStates(), 'rop16'), span)

    // the same span as fixed steps, as the store runs it
    let many = fire(createAbilityStates(), 'rop16')
    for (let i = 0; i < n; i++) many = stepAbilities(many, FIXED_STEP_CLOCKS.lesion)

    expect(many.rop16.activeHours).toBe(0)
    expect(once.rop16.activeHours).toBe(0)
    expect(many.rop16.cooldownHours).toBeCloseTo(once.rop16.cooldownHours, 6)
  })

  it('is pure: stepping and firing never touch the state they were given', () => {
    const s = Object.freeze({
      rop16: Object.freeze({ activeHours: 4, cooldownHours: 0, uses: 2 }),
      rop18rop5: Object.freeze({ activeHours: 0, cooldownHours: 3, uses: 1 }),
      tgist: Object.freeze({ activeHours: 0, cooldownHours: 0, uses: 0 }),
    }) as AbilityStates
    expect(() => stepAbilities(s, 1)).not.toThrow()
    expect(() => fire(s, 'tgist')).not.toThrow()
    expect(s.rop16.activeHours).toBe(4)
    expect(s.rop18rop5.cooldownHours).toBe(3)
  })

  it('returns the same object when nothing can change, so idle frames re-render nothing', () => {
    const idle = createAbilityStates()
    expect(stepAbilities(idle, 5)).toBe(idle)
    expect(stepAbilities(idle, 0)).toBe(idle)
    const running = fire(idle, 'rop16')
    expect(stepAbilities(running, 0)).toBe(running)
    expect(stepAbilities(running, 1)).not.toBe(running)
  })

  it('refuses to fire a knocked-out gene', () => {
    const noShield: EffectorFlags = { ...wild, rop18rop5: false }
    const s = createAbilityStates()
    const after = activateAbility(s, 'rop18rop5', noShield, UNLOCKED)
    expect(after).toBe(s)
    expect(abilityAvailability('rop18rop5', s, noShield, UNLOCKED).blocked).toMatch(/knocked out/i)
  })

  it('refuses to fire a locked ability, and says why', () => {
    const s = createAbilityStates()
    expect(abilityUnlocked('tgist', 0)).toBe(false)
    expect(activateAbility(s, 'tgist', wild, 0)).toBe(s)
    expect(abilityAvailability('tgist', s, wild, 0).blocked).toMatch(/locked/i)
    expect(activateAbility(s, 'tgist', wild, 1)).not.toBe(s)
  })

  it('tells the host only about effectors that are carried *and* secreting', () => {
    const idle = createAbilityStates()
    // a wild-type strain with nothing fired looks exactly like a triple knockout
    expect(activeEffectors(wild, idle)).toEqual({ rop16: false, rop18rop5: false, tgist: false })

    const firing = fire(idle, 'rop16')
    expect(activeEffectors(wild, firing)).toEqual({ rop16: true, rop18rop5: false, tgist: false })

    // a knockout cannot secrete even if its state somehow says active
    const forced: AbilityStates = { ...idle, rop16: { activeHours: 5, cooldownHours: 0, uses: 1 } }
    expect(activeEffectors({ ...wild, rop16: false }, forced).rop16).toBe(false)
  })

  it('counts uses across a rotation', () => {
    let s = createAbilityStates()
    for (let i = 0; i < 3; i++) {
      s = fire(s, 'rop18rop5')
      s = stepAbilities(s, ABILITY_DEFS.rop18rop5.durationHours + ABILITY_DEFS.rop18rop5.cooldownHours)
    }
    expect(s.rop18rop5.uses).toBe(3)
  })
})
