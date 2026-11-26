import { describe, expect, it } from 'vitest'
import {
  SPECIES_LSYSTEMS,
  architectureCap,
  architectureStats,
  generateLSystem,
  interpretLSystem,
} from './LSystem'
import { MAX_ITERATIONS, createMorphBuilder } from './LSystemMorph'
import type { SpeciesId } from './species'

const SPECIES = Object.keys(SPECIES_LSYSTEMS) as SpeciesId[]

/** FNV-1a over the float32 bytes of the first and last segment endpoints. */
function checksum(species: SpeciesId, n: number): string {
  const { segments } = interpretLSystem(generateLSystem(SPECIES_LSYSTEMS[species].axiom, SPECIES_LSYSTEMS[species].rules, n), SPECIES_LSYSTEMS[species])
  const a = segments[0]
  const b = segments[segments.length - 1]
  const f = new Float32Array([...a.start, ...a.end, ...b.start, ...b.end])
  let h = 0x811c9dc5
  for (const byte of new Uint8Array(f.buffer)) h = Math.imul(h ^ byte, 0x01000193)
  return (h >>> 0).toString(16)
}

describe('architecture budget', () => {
  it('keeps every species within its segment budget at the oldest age', () => {
    for (const s of SPECIES) {
      const stats = architectureStats(SPECIES_LSYSTEMS[s], MAX_ITERATIONS, MAX_ITERATIONS)
      expect(stats.segments, s).toBeLessThanOrEqual(8000)
    }
  })

  it('pins the capped iteration and counts per species', () => {
    const table = Object.fromEntries(
      SPECIES.map((s) => [s, architectureStats(SPECIES_LSYSTEMS[s], MAX_ITERATIONS, MAX_ITERATIONS)]),
    )
    expect(table).toMatchSnapshot()
  })

  it('counts match the real interpreter', () => {
    for (const s of SPECIES) {
      const def = SPECIES_LSYSTEMS[s]
      const n = architectureCap(def, MAX_ITERATIONS)
      const str = generateLSystem(def.axiom, def.rules, n)
      const { segments, leaves } = interpretLSystem(str, def)
      const stats = architectureStats(def, n, MAX_ITERATIONS)
      expect(stats.symbols, s).toBe(str.length)
      expect(stats.segments, s).toBe(segments.length)
      expect(stats.leaves, s).toBe(leaves.length)
      expect(stats.simplified).toBe(false)
    }
  })

  it('flags bamboo, rose and fern as simplified past their cap', () => {
    for (const s of ['bamboo', 'rose', 'fern'] as const) {
      expect(architectureStats(SPECIES_LSYSTEMS[s], MAX_ITERATIONS, MAX_ITERATIONS).simplified, s).toBe(true)
    }
  })

  it('stops the morph at the cap', () => {
    const def = SPECIES_LSYSTEMS.bamboo
    const cap = architectureCap(def, MAX_ITERATIONS)
    const m = createMorphBuilder(def).morph(MAX_ITERATIONS)
    expect(m.iterations).toBe(cap)
  })
})

describe('architecture IR is deterministic', () => {
  it('pins segment counts and endpoint checksums at iteration 2 and the cap', () => {
    const table = Object.fromEntries(
      SPECIES.flatMap((s) => {
        const cap = architectureCap(SPECIES_LSYSTEMS[s], MAX_ITERATIONS)
        return [2, cap].map((n) => {
          const def = SPECIES_LSYSTEMS[s]
          const count = interpretLSystem(generateLSystem(def.axiom, def.rules, n), def).segments.length
          return [`${s}@${n}`, { segments: count, checksum: checksum(s, n) }]
        })
      }),
    )
    expect(table).toMatchSnapshot()
  })

  it('a second interpretation matches byte for byte', () => {
    for (const s of SPECIES) {
      const def = SPECIES_LSYSTEMS[s]
      const str = generateLSystem(def.axiom, def.rules, architectureCap(def, MAX_ITERATIONS))
      expect(interpretLSystem(str, def), s).toEqual(interpretLSystem(str, def))
    }
  })
})
