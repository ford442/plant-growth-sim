import {
  CAMBIAL_SIZE,
  CORTEX_CELLS,
  CORTEX_SIZE,
  EPIDERMIS_SIZE,
  PITH_RADIUS,
  PRIMARY_RADIUS,
  type RingBand,
  type StemMetrics,
} from '../../simulation/TissueGrowth'
import { HEX } from './palette'
import type { ZoomBox } from './geometry'

const TAU = Math.PI * 2

/** Stable 0–1 noise for placing pores, so the wood texture does not shimmer between repaints. */
function hash01(a: number, b: number): number {
  let h = Math.imul(a + 1, 374761393) ^ Math.imul(b + 7, 668265263)
  h = Math.imul(h ^ (h >>> 13), 1274126177)
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296
}

function mixHex(a: string, b: string, t: number): string {
  const pa = parseInt(a.slice(1), 16)
  const pb = parseInt(b.slice(1), 16)
  const ch = (shift: number) => {
    const x = (pa >> shift) & 255
    const y = (pb >> shift) & 255
    return Math.round(x + (y - x) * t)
  }
  return `rgb(${ch(16)},${ch(8)},${ch(0)})`
}

/**
 * Paints the whole cross-section onto a square canvas: pith, primary xylem, one
 * band per growth ring (pale earlywood then dark latewood), the cambium, phloem,
 * cortex and skin, plus medullary rays and the zoom box that the lens magnifies.
 * Radii come straight from the tissue state, so ring widths are whatever the
 * cell files actually produced.
 */
export function paintDisc(
  ctx: CanvasRenderingContext2D,
  size: number,
  profile: RingBand[],
  m: StemMetrics,
  box: ZoomBox,
  activity: number,
): void {
  const c = size / 2
  const k = (size / 2 - 3) / m.stemRadius // px per µm
  ctx.clearRect(0, 0, size, size)

  const disc = (rUm: number, fill: string) => {
    ctx.beginPath()
    ctx.arc(c, c, Math.max(0.5, rUm * k), 0, TAU)
    ctx.fillStyle = fill
    ctx.fill()
  }

  // Layers, outside in. Each disc covers the ones inside it.
  const cortexOuter = m.stemRadius - EPIDERMIS_SIZE
  const phloemOuter = cortexOuter - CORTEX_CELLS * CORTEX_SIZE
  disc(m.stemRadius, HEX.epidermisWall)
  disc(cortexOuter, HEX.cortexLumen)
  disc(phloemOuter, HEX.companionLumen)
  // cambium: a thin ring on the wood, drawn at least 3 px wide so it never vanishes as the stem thickens
  const cambiumPx = Math.max(CAMBIAL_SIZE * 0.75 * k, 3)
  disc(m.xylemRadius + cambiumPx / k, activity > 0.06 ? HEX.cambiumLumen : '#5fa8a0')

  // Growth rings, newest first: latewood disc, then the earlywood disc inside it.
  for (let i = profile.length - 1; i >= 0; i--) {
    const r = profile[i]
    if (r.outer - r.inner < 0.01) continue
    disc(r.outer, mixHex(HEX.latewood, '#a2351c', r.stress * 0.45))
    disc(r.earlyOuter, HEX.earlywood)
  }

  // Ring boundaries and vessel pores, only where there are enough pixels to read them.
  ctx.lineWidth = 1
  ctx.strokeStyle = 'rgba(48,26,8,0.55)'
  ctx.fillStyle = 'rgba(62,38,18,0.72)'
  for (const r of profile) {
    if ((r.outer - r.inner) * k < 1.5) continue
    ctx.beginPath()
    ctx.arc(c, c, r.outer * k, 0, TAU)
    ctx.stroke()
    const earlyPx = (r.earlyOuter - r.inner) * k
    if (earlyPx >= 3) {
      const rMid = ((r.inner + r.earlyOuter) / 2) * k
      const n = Math.min(70, Math.floor((TAU * rMid) / 10))
      const pore = Math.min(2.2, earlyPx * 0.28)
      for (let j = 0; j < n; j++) {
        const a = ((j + hash01(r.index, j)) / n) * TAU
        const rr = rMid + (hash01(j, r.index) - 0.5) * earlyPx * 0.5
        ctx.beginPath()
        ctx.arc(c + Math.cos(a) * rr, c + Math.sin(a) * rr, pore, 0, TAU)
        ctx.fill()
      }
    }
  }

  // Primary xylem and pith at the heart of the stem.
  disc(PRIMARY_RADIUS, HEX.primaryXylem)
  disc(PITH_RADIUS, HEX.pith)

  // Medullary (vascular) rays: living bands that carry food sideways through the wood.
  ctx.strokeStyle = 'rgba(255,244,214,0.2)'
  const rays = 28
  for (let j = 0; j < rays; j++) {
    const a = (j / rays) * TAU + 0.07
    ctx.beginPath()
    ctx.moveTo(c + Math.cos(a) * PRIMARY_RADIUS * k, c + Math.sin(a) * PRIMARY_RADIUS * k)
    ctx.lineTo(c + Math.cos(a) * m.xylemRadius * k, c + Math.sin(a) * m.xylemRadius * k)
    ctx.stroke()
  }

  // The strip the lens magnifies.
  const x0 = c + box.x0 * k
  const x1 = c + box.x1 * k
  const hh = box.halfH * k
  ctx.fillStyle = 'rgba(255,255,255,0.18)'
  ctx.fillRect(x0, c - hh, x1 - x0, hh * 2)
  ctx.strokeStyle = '#ffffff'
  ctx.lineWidth = 2
  ctx.strokeRect(x0, c - hh, x1 - x0, hh * 2)
}
