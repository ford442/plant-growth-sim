import { clamp01, lerpColor, rampColor } from '../../simulation/color'

/**
 * Colour language of the Roots view, shared by the 3D soil slice and the
 * sidebar legend. Every overlay also whitens cemented cells, so a hardpan is
 * visible whichever field is showing.
 */
export type SoilOverlay = 'moisture' | 'silica' | 'calcite' | 'cement' | 'roots'

export interface OverlayDef {
  label: string
  /** Ramp over the overlay's 0–1 parameter. */
  stops: [number, string][]
  /** Legend tick labels at 0, ½ and 1. */
  ticks: [string, string, string]
  hint: string
}

export const OVERLAYS: Record<SoilOverlay, OverlayDef> = {
  moisture: {
    label: 'Water',
    stops: [
      [0, '#9a7646'],
      [0.25, '#6e5332'],
      [0.6, '#3c3022'],
      [1, '#1c3a5a'],
    ],
    ticks: ['dry', 'field capacity', 'saturated'],
    hint: 'Pore water as a share of the open pore space. Roots cannot pull water below ~16 %.',
  },
  silica: {
    label: 'Silica S',
    stops: [
      [0, '#231d16'],
      [0.45, '#33404f'],
      [0.6, '#5f77a6'],
      [0.75, '#a98bf0'],
      [1, '#f1d9ff'],
    ],
    ticks: ['0', 'S = 1 (saturated)', '1.7'],
    hint: 'Dissolved silica ÷ solubility. Above 1 it precipitates: nodules nucleate on roots, cement coats grains.',
  },
  calcite: {
    label: 'Calcite S',
    stops: [
      [0, '#231d16'],
      [0.45, '#4f4130'],
      [0.6, '#a88a52'],
      [0.75, '#e8cf8e'],
      [1, '#fff6dc'],
    ],
    ticks: ['0', 'S = 1 (saturated)', '1.7'],
    hint: 'Dissolved calcium carbonate ÷ solubility. Root CO₂ raises the solubility, so it drops out where CO₂ escapes or the soil dries.',
  },
  cement: {
    label: 'Cement',
    stops: [
      [0, '#2a2018'],
      [0.3, '#6b5a45'],
      [0.55, '#b9ab93'],
      [1, '#f4efe4'],
    ],
    ticks: ['0 %', 'hardpan (50 %)', '90 %'],
    hint: 'Share of the pore space filled by precipitated silica or calcite. Above half, roots cannot get through.',
  },
  roots: {
    label: 'Roots',
    stops: [
      [0, '#211a12'],
      [0.3, '#3d4a26'],
      [1, '#b6e07c'],
    ],
    ticks: ['none', '', 'dense'],
    hint: 'Root length density. Dense roots draw water fastest, breathe the most CO₂ and give minerals a template to nucleate on.',
  },
}

export const SOIL_OVERLAY_IDS = Object.keys(OVERLAYS) as SoilOverlay[]

/** Saturation indices are mapped so S = 1 sits at 0.6 of the ramp. */
export const saturationParam = (S: number) => clamp01(S / 1.7)

const CEMENT_TINT = '#ddd5c4'

export function overlayColor(overlay: SoilOverlay, value: number, cement: number): string {
  const base = rampColor(OVERLAYS[overlay].stops, overlay === 'cement' ? value / 0.9 : value)
  return overlay === 'cement' ? base : lerpColor(base, CEMENT_TINT, clamp01(cement * 1.1))
}

export const MINERAL_HEX = {
  silica: '#b7a3ee',
  calcite: '#efe2c2',
  root: '#f3e2bd',
  rootTip: '#f2e6c8',
} as const

/** CSS gradient for a legend bar. */
export function overlayGradient(overlay: SoilOverlay): string {
  const stops = OVERLAYS[overlay].stops.map(([t, c]) => `${c} ${Math.round(t * 100)}%`)
  return `linear-gradient(90deg, ${stops.join(', ')})`
}
