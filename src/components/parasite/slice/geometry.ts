/**
 * Shared geometries for the tissue slice. All are in micrometres, so scene
 * scale is applied once, on the parent group — instance matrices never need to
 * convert units.
 */

import * as THREE from 'three'
import { crescentGeometry } from '../bodyGeometry'
import { BRADYZOITE_LENGTH_UM, BRADYZOITE_WIDTH_UM } from './bradyzoites'
import { CELL_CIRCUMRADIUS_UM } from './sliceLayout'
import type { SliceLodConfig } from './sliceLod'

/** Dome height of a host-cell tile, µm. */
export const CELL_HEIGHT_UM = 1.6

/** The real bradyzoite: 7 × 1.5 µm, with the stronger bow bradyzoites have (research §2.2). */
export function bradyzoiteGeometry(lod: Pick<SliceLodConfig, 'crescentRadial' | 'crescentLength'>): THREE.BufferGeometry {
  return crescentGeometry({
    length: BRADYZOITE_LENGTH_UM,
    width: BRADYZOITE_WIDTH_UM,
    bend: 0.19,
    radialSegments: lod.crescentRadial,
    lengthSegments: lod.crescentLength,
  })
}

/**
 * A host-cell tile: a pointy-top hexagon in the XZ plane at the sim's real cell
 * size, with a domed top (`rings` = 1: a six-sided pyramid; 2: a shoulder ring
 * for a rounded profile). Faces up (+Y). The bottom is left open — it is never
 * seen, because the tiles sit on an opaque underlay.
 */
export function cellTileGeometry(rings: 1 | 2): THREE.BufferGeometry {
  const R = CELL_CIRCUMRADIUS_UM
  const H = CELL_HEIGHT_UM
  const positions: number[] = [0, H, 0] // 0: crown
  const ringAt = (radius: number, y: number) => {
    const first = positions.length / 3
    for (let k = 0; k < 6; k++) {
      const a = Math.PI / 6 + (k * Math.PI) / 3 // 30°, 90°, … so flat sides face ±X
      positions.push(Math.cos(a) * radius, y, Math.sin(a) * radius)
    }
    return first
  }
  const index: number[] = []
  const next = (k: number) => (k + 1) % 6

  if (rings === 1) {
    const rim = ringAt(R, 0)
    for (let k = 0; k < 6; k++) index.push(0, rim + next(k), rim + k)
  } else {
    const shoulder = ringAt(R * 0.62, H * 0.82)
    const rim = ringAt(R, 0)
    for (let k = 0; k < 6; k++) {
      index.push(0, shoulder + next(k), shoulder + k)
      index.push(shoulder + k, shoulder + next(k), rim + k)
      index.push(shoulder + next(k), rim + next(k), rim + k)
    }
  }

  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  g.setIndex(index)
  g.computeVertexNormals()
  g.computeBoundingSphere()
  return g
}
