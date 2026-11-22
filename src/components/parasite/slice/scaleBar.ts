/**
 * The micrometre scale bar: pick a round length (1, 2 or 5 × 10ⁿ µm) whose
 * on-screen width is nearest a target, and label it. Pure.
 */

export interface ScaleBar {
  /** Length the bar stands for, µm. */
  um: number
  /** Its width on screen, CSS px. */
  px: number
  label: string
}

export function scaleBarLabel(um: number): string {
  if (um >= 1000) return `${um / 1000} mm`
  if (um >= 1) return `${um} µm`
  return `${Math.round(um * 1000)} nm`
}

/**
 * `umPerPx` is how many micrometres one CSS pixel covers at the focal plane.
 * Returns the round length whose width is closest to `targetPx` on a log scale
 * (so 80 px and 180 px are equally "far" from 120).
 */
export function niceScaleBar(umPerPx: number, targetPx = 120): ScaleBar {
  const ideal = umPerPx * targetPx
  const decade = Math.floor(Math.log10(ideal))
  let best = 1
  let bestErr = Infinity
  for (const d of [decade - 1, decade, decade + 1]) {
    for (const m of [1, 2, 5]) {
      const um = m * 10 ** d
      const err = Math.abs(Math.log(um / ideal))
      if (err < bestErr) {
        bestErr = err
        best = um
      }
    }
  }
  // 10 ** negative decade leaves float dust (0.30000000000000004); round to a clean figure
  const um = Number(best.toPrecision(3))
  return { um, px: um / umPerPx, label: scaleBarLabel(um) }
}
