/**
 * Game-layer thresholds for the primary objective (epic #3, issue #5/#7).
 *
 * These are the numbers that decide a win or a loss, as opposed to the
 * biological parameters in `stages.ts` / `hostImmunity.ts` / `bfdSwitch.ts`.
 * They are **all** `// TUNING`: the research doc says what a mature cyst is and
 * how long an infection takes to become chronic, but nothing in it says "eight
 * cysts in thirty days" — that is a difficulty curve.
 *
 * They live in their own module, and on `ParasiteConfig`, for two reasons: the
 * objective table stays data-driven (`objectives.ts` reads them rather than
 * closing over constants), and the Leva debug panel can retune a live run
 * without touching the sim.
 */

export interface GameTuning {
  /**
   * Reservoir cysts needed to win. TUNING — 8 is the figure the C0 design lock
   * recorded, and a stressed run reaches it in the second half of the window.
   */
  latentTarget: number
  /**
   * Host health at or below which the run is lost. TUNING — the design lock
   * says "above 20%", which is stricter than mere survival, so a host that is
   * merely dying slowly still fails the objective.
   */
  hostFloor: number
  /**
   * Sim days the host has to carry the cysts. TUNING — 30 days is the issue's
   * window; it is long enough that the IFN-γ ramp (~4 days) and a cyst's growth
   * to 50 µm (~2 weeks) both fit, and short enough to watch at 6×.
   */
  holdDays: number
  /**
   * Cyst diameter, µm, that counts toward the objective. The research anchors
   * are 5 µm at 2 bradyzoites and ~70 µm past 1000 (§2.2); 50 µm is a
   * well-grown cyst, about 460 bradyzoites through `cystDiameter`.
   */
  matureDiameterUm: number
}

export const DEFAULT_TUNING: GameTuning = {
  latentTarget: 8,
  hostFloor: 0.2,
  holdDays: 30,
  matureDiameterUm: 50,
}

/** Bounds the debug panel offers, so a retune cannot produce an absurd run. */
export const TUNING_RANGE: Record<keyof GameTuning, { min: number; max: number; step: number }> = {
  latentTarget: { min: 1, max: 32, step: 1 },
  hostFloor: { min: 0, max: 0.9, step: 0.01 },
  holdDays: { min: 2, max: 120, step: 1 },
  matureDiameterUm: { min: 5, max: 70, step: 1 },
}
