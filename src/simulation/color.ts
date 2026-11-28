/** Tiny pure colour helpers (hex strings in, hex strings out). */

export const clamp01 = (x: number) => Math.min(1, Math.max(0, x))

export function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = clamp01((x - edge0) / (edge1 - edge0))
  return t * t * (3 - 2 * t)
}

function parse(hex: string): [number, number, number] {
  const h = hex.replace('#', '')
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)]
}

function toHex(rgb: [number, number, number]): string {
  return '#' + rgb.map((c) => Math.round(Math.min(255, Math.max(0, c))).toString(16).padStart(2, '0')).join('')
}

export function lerpColor(a: string, b: string, t: number): string {
  const x = parse(a)
  const y = parse(b)
  const k = clamp01(t)
  return toHex([x[0] + (y[0] - x[0]) * k, x[1] + (y[1] - x[1]) * k, x[2] + (y[2] - x[2]) * k])
}

/** Piecewise-linear colour ramp: stops are [position 0–1, hex]. */
export function rampColor(stops: [number, string][], t: number): string {
  const k = clamp01(t)
  for (let i = 1; i < stops.length; i++) {
    if (k <= stops[i][0]) {
      const [p0, c0] = stops[i - 1]
      const [p1, c1] = stops[i]
      return lerpColor(c0, c1, (k - p0) / (p1 - p0 || 1))
    }
  }
  return stops[stops.length - 1][1]
}

/** Volume-weighted average of several colours. */
export function mixColors(colors: { color: string; weight: number }[]): string {
  let w = 0
  const acc = [0, 0, 0]
  for (const { color, weight } of colors) {
    const c = parse(color)
    acc[0] += c[0] * weight
    acc[1] += c[1] * weight
    acc[2] += c[2] * weight
    w += weight
  }
  if (w <= 0) return colors[0]?.color ?? '#ffffff'
  return toHex([acc[0] / w, acc[1] / w, acc[2] / w])
}
