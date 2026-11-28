/**
 * A synthetic cyst population for stress-testing the slice (`?stress=200`).
 *
 * A real run cannot reach 200 cysts today — the sim caps creation at
 * `MAX_CYSTS` (64) — but the slice's acceptance case is 200 cysts and ~20 k
 * bradyzoites at 60 fps, and that needs *something* to draw. This builds
 * `Cyst` records the same way the sim does (`cystDiameter`, `cystWallThickness`
 * from `stages.ts`), spread log-uniformly from a 2-bradyzoite 5 µm cyst to a
 * full 1 024-bradyzoite 70 µm one, so every size class is on screen at once.
 * It is a fixture, not a simulation: nothing here is written back to a store,
 * and the same `(n, seed)` always gives the same garden.
 */

import { hash01 } from '../../../simulation/LSystem'
import { createBfdState } from '../../../simulation/parasite/bfdSwitch'
import { NICHES } from '../../../simulation/parasite/hostImmunity'
import {
  BRADYZOITE_DIVISION_HOURS,
  CYST_MAX_BRADYZOITES,
  cystDiameter,
  cystWallThickness,
} from '../../../simulation/parasite/stages'
import type { Cyst } from '../../../simulation/parasite/world'

export function syntheticCysts(n: number, seed = 1): Cyst[] {
  const out: Cyst[] = []
  for (let i = 0; i < n; i++) {
    const h = (j: number) => hash01((seed * 100_003 + i) * 8 + j)
    // log-uniform between 2 and the cap: 2 · 512^u
    const bradyzoites = Math.min(CYST_MAX_BRADYZOITES, Math.max(2, Math.round(2 * (CYST_MAX_BRADYZOITES / 2) ** h(0))))
    out.push({
      id: 100_000 + i,
      niche: NICHES[Math.floor(h(1) * NICHES.length)],
      pos: { x: 0, y: 0, z: 0 },
      diameter: cystDiameter(bradyzoites),
      wall: cystWallThickness(bradyzoites),
      bradyzoites,
      // only a plausible age for the tooltip: one division period per doubling.
      // The sim's own pacing (×1.6 per period, slowed as a cyst fills) is not re-derived here.
      ageHours: Math.log2(bradyzoites / 2) * BRADYZOITE_DIVISION_HOURS,
      bfd: createBfdState(),
      divisionTimer: 0,
      intact: true,
    })
  }
  return out
}

let memo: { n: number; cysts: Cyst[] } | null = null

/** The stress population for `n`, built once and shared (the scene and the tooltip must see the same cysts). */
export function stressCysts(n: number): Cyst[] {
  if (!memo || memo.n !== n) memo = { n, cysts: syntheticCysts(n) }
  return memo.cysts
}
