/**
 * Adaptive level-of-detail ladder: step a quality tier down when the measured
 * frame rate stays low, and back up when there is sustained headroom.
 *
 * Borrowed from ford442/watershed (`src/systems/lod/adaptiveQuality.ts`),
 * trimmed to the part that is independent of that game: the tier ladder and its
 * hysteresis. Dropped: the render-scale "valve" that gives resolution up before
 * the preset does (this repo has no such valve), and the coupling to watershed's
 * game store and frame-work timers. The caller owns measuring FPS; this module
 * is pure so the rules are unit-tested without a GPU.
 *
 * What a tier *means* (instance budgets, geometry detail) is up to each view —
 * see `components/parasite/slice/sliceLod.ts`. Tiers only change how much is
 * drawn, never simulation state.
 */

export type LodTier = 'low' | 'medium' | 'high' | 'ultra'

/** Cheapest first. */
export const LOD_TIERS: readonly LodTier[] = ['low', 'medium', 'high', 'ultra']

/**
 * Tiers automatic scaling may move between. `low` is left to the player on
 * purpose: stepping into it visibly thins the scene, which should be a choice,
 * not something the app does to you during a rough patch (watershed's rule).
 */
export const ADAPTIVE_LOD_BAND: readonly LodTier[] = ['medium', 'high', 'ultra']

/** Samples (one per second) below `target − 10` fps before a downgrade. */
export const DOWNGRADE_AFTER = 3
/** Samples above `target + 5` fps before an upgrade — headroom is rarer, so it is cheaper to prove. */
export const UPGRADE_AFTER = 2

export interface AdaptiveLodInput {
  tier: LodTier
  /** Mean frames per second over the last sampling window. */
  fps: number
  targetFps: number
  /** Consecutive slow windows so far (the previous result's `lowSeconds`). */
  lowSeconds: number
  /** Consecutive fast windows so far (the previous result's `highSeconds`). */
  highSeconds: number
}

export interface AdaptiveLodResult {
  /** `null` when the tier should not move this window. */
  nextTier: LodTier | null
  lowSeconds: number
  highSeconds: number
}

const HOLD: AdaptiveLodResult = { nextTier: null, lowSeconds: 0, highSeconds: 0 }

export function stepAdaptiveLod({ tier, fps, targetFps, lowSeconds, highSeconds }: AdaptiveLodInput): AdaptiveLodResult {
  // A tier outside the band (the player picked `low`) is left alone.
  const index = ADAPTIVE_LOD_BAND.indexOf(tier)
  if (index < 0) return HOLD

  if (fps < targetFps - 10 && index > 0) {
    const slow = lowSeconds + 1
    if (slow >= DOWNGRADE_AFTER) return { nextTier: ADAPTIVE_LOD_BAND[index - 1], lowSeconds: 0, highSeconds: 0 }
    return { nextTier: null, lowSeconds: slow, highSeconds: 0 }
  }

  if (fps > targetFps + 5 && index < ADAPTIVE_LOD_BAND.length - 1) {
    const fast = highSeconds + 1
    if (fast >= UPGRADE_AFTER) return { nextTier: ADAPTIVE_LOD_BAND[index + 1], lowSeconds: 0, highSeconds: 0 }
    return { nextTier: null, lowSeconds: 0, highSeconds: fast }
  }

  // In the comfortable middle (or already at an end of the band): evidence decays.
  return { nextTier: null, lowSeconds: Math.max(0, lowSeconds - 1), highSeconds: Math.max(0, highSeconds - 1) }
}
