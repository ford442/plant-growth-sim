/**
 * Colours for the tissue slice. The niche selector is cosmetic for now: it
 * recolours the backdrop mosaic and nothing else — the sim's tissue niches
 * (`NICHE_DEFS`, which also carry the bright accent each cyst is tinted with)
 * are untouched.
 *
 * Every tissue colour is deliberately dark: the slice is dark-field microscopy,
 * so the cysts and their rims should be the brightest things on screen.
 * `palette.test.ts` holds that line.
 */

import type { NicheId } from '../../../simulation/parasite/hostImmunity'

export interface SlicePalette {
  /** Short tissue name for the selector. */
  name: string
  /** Host-cell tile colour (each tile is varied a little around this). */
  cell: string
  /** The intercellular matrix showing between tiles. */
  matrix: string
}

export const SLICE_PALETTES: Record<NicheId, SlicePalette> = {
  skeletalMuscle: { name: 'Muscle', cell: '#4d2a31', matrix: '#150b0e' },
  cardiacMuscle: { name: 'Heart', cell: '#552738', matrix: '#170a12' },
  retina: { name: 'Retina', cell: '#4a3b1d', matrix: '#150f06' },
  cnsCortex: { name: 'CNS cortex', cell: '#243d55', matrix: '#08121b' },
  cnsAmygdala: { name: 'CNS amygdala', cell: '#37305f', matrix: '#0d0a1a' },
}

/** WCAG relative luminance of a `#rrggbb` colour, 0 (black) – 1 (white). */
export function relativeLuminance(hex: string): number {
  const v = parseInt(hex.slice(1), 16)
  const lin = (c: number) => {
    const s = c / 255
    return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
  }
  return 0.2126 * lin((v >> 16) & 255) + 0.7152 * lin((v >> 8) & 255) + 0.0722 * lin(v & 255)
}
