import * as THREE from 'three'
import type { LayoutKind } from '../../simulation/TissueGrowth'

/**
 * Colour language of the cellular view. The same hues carry meaning in the 3D
 * cell lens, the painted stem disc, the labels and the sidebar legend:
 * warm browns are wood (xylem), blue is water in a vessel, teal is the dividing
 * cambium, yellow-green is phloem, and the outer greens are cortex / skin.
 */
export const HEX = {
  background: '#070d09',

  pith: '#efe6c8',
  pithWall: '#b9ad86',
  primaryXylem: '#9b7b45',
  primaryXylemLumen: '#2d4658',

  xylemYoungWall: '#d8e7a8',
  fibreWall: '#a8692f',
  fibreLumen: '#22150b',
  vesselWall: '#d7a65f',
  water: '#4aa0e6',
  air: '#dfe7ec',
  cytoplasm: '#a9d98f',
  wilted: '#bfa24f',
  earlywood: '#e9cf98',
  latewood: '#7d4d22',

  cambiumWall: '#1f8f86',
  cambiumLumen: '#a6f7ea',
  nucleusG1: '#0e4b56',
  nucleusS: '#1d7a8c',
  nucleusG2: '#2f9fb8',
  chromosome: '#ffd75e',
  cellPlate: '#f4fffc',

  phloemWall: '#5f9440',
  sieveLumen: '#e6f7c4',
  companionLumen: '#9ad06a',
  phloemNucleus: '#2b5a2a',

  cortexWall: '#5a8f45',
  cortexLumen: '#bfe0a0',
  epidermisWall: '#2a6a33',
  epidermisLumen: '#7eb86e',

  boundary: '#f6edd0',
  bark: '#3b2a1b',
} as const

const c = (hex: string) => new THREE.Color(hex)

/** THREE colours for the instanced lens (built once). */
export const COLOR = {
  background: c(HEX.background),
  pith: c(HEX.pith),
  pithWall: c(HEX.pithWall),
  primaryXylem: c(HEX.primaryXylem),
  primaryXylemLumen: c(HEX.primaryXylemLumen),
  xylemYoungWall: c(HEX.xylemYoungWall),
  fibreWall: c(HEX.fibreWall),
  fibreLumen: c(HEX.fibreLumen),
  vesselWall: c(HEX.vesselWall),
  water: c(HEX.water),
  air: c(HEX.air),
  cytoplasm: c(HEX.cytoplasm),
  wilted: c(HEX.wilted),
  cambiumWall: c(HEX.cambiumWall),
  cambiumLumen: c(HEX.cambiumLumen),
  nucleusG1: c(HEX.nucleusG1),
  nucleusS: c(HEX.nucleusS),
  nucleusG2: c(HEX.nucleusG2),
  chromosome: c(HEX.chromosome),
  cellPlate: c(HEX.cellPlate),
  phloemWall: c(HEX.phloemWall),
  sieveLumen: c(HEX.sieveLumen),
  companionLumen: c(HEX.companionLumen),
  phloemNucleus: c(HEX.phloemNucleus),
  cortexWall: c(HEX.cortexWall),
  cortexLumen: c(HEX.cortexLumen),
  epidermisWall: c(HEX.epidermisWall),
  epidermisLumen: c(HEX.epidermisLumen),
  boundary: c(HEX.boundary),
} as const

/** One row per tissue in the ruler under the lens and in the sidebar legend. */
export interface TissueInfo {
  label: string
  color: string
  /** What the tissue does, in a few words. */
  role: string
}

export const TISSUE_INFO: Record<LayoutKind, TissueInfo> = {
  pith: { label: 'Pith', color: HEX.pith, role: 'Stores food at the stem centre' },
  primaryXylem: { label: 'Primary xylem', color: HEX.primaryXylem, role: 'First water pipes, from the shoot tip' },
  xylem: { label: 'Xylem (wood)', color: HEX.fibreWall, role: 'Carries water up; vessels are open pipes, fibres give strength' },
  cambium: { label: 'Cambium', color: HEX.cambiumLumen, role: 'The only layer that divides: wood inwards, bark outwards' },
  phloem: { label: 'Phloem', color: HEX.companionLumen, role: 'Carries sugar down from the leaves' },
  cortex: { label: 'Cortex', color: HEX.cortexLumen, role: 'Soft storage tissue under the skin' },
  epidermis: { label: 'Epidermis', color: HEX.epidermisLumen, role: 'Waxy protective skin' },
}

/** Colour mixing without allocation: out = a + (b - a) * t. */
export function mixColor(out: THREE.Color, a: THREE.Color, b: THREE.Color, t: number): THREE.Color {
  out.r = a.r + (b.r - a.r) * t
  out.g = a.g + (b.g - a.g) * t
  out.b = a.b + (b.b - a.b) * t
  return out
}
