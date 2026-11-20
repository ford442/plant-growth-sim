import * as THREE from 'three'
import { SPECIES_LSYSTEMS } from '../../simulation/LSystem'
import {
  LEAF_STRIDE,
  MAX_ITERATIONS,
  createMorphBuilder,
  sampleLeaves,
  sampleSegments,
  type LSystemMorph,
  type MorphBuilder,
} from '../../simulation/LSystemMorph'
import { writeLeafMatrices } from './leafMatrix'

/** Re-posing is skipped when the factor moved less than this (stalled growth costs nothing). */
const T_EPSILON = 1e-4

/**
 * The drawable form of one L-system morph: a branch line geometry and a leaf
 * instance-matrix buffer whose contents are re-posed in place for any t.
 *
 * It is shared by every plant on screen at the same stage (the macro view
 * draws three of the same species), so a frame costs one re-pose rather than
 * one per plant — `setMorph` is a no-op for a t it already holds. Because the
 * buffers always hold the current pose, GLB export (plantExport.ts) captures
 * the plant exactly as it appears on screen.
 */
export class MorphedPlant {
  /** Whole iteration shown at t = 0 (t = 1 is the next one). */
  readonly stage: number
  readonly key: string
  readonly leafCount: number
  readonly branchGeometry = new THREE.BufferGeometry()
  readonly leafMatrices: THREE.InstancedBufferAttribute

  private readonly morph: LSystemMorph
  private readonly positions: THREE.BufferAttribute
  private readonly leafPose: Float32Array
  private lastT = NaN

  constructor(key: string, morph: LSystemMorph) {
    this.key = key
    this.morph = morph
    this.stage = morph.iterations
    this.leafCount = morph.leafCount

    this.positions = new THREE.BufferAttribute(new Float32Array(morph.segmentsTo.length), 3)
    this.positions.setUsage(THREE.DynamicDrawUsage)
    this.branchGeometry.setAttribute('position', this.positions)

    this.leafMatrices = new THREE.InstancedBufferAttribute(new Float32Array(morph.leafCount * 16), 16)
    this.leafMatrices.setUsage(THREE.DynamicDrawUsage)
    this.leafPose = new Float32Array(morph.leafCount * LEAF_STRIDE)
  }

  /**
   * Height of the highest branch vertex in the current pose, in the plant's
   * own units (before the view's growth scale). Scanned on demand — the Roots
   * view reads it a few times a second to know how far up the stem its water
   * rises — so re-posing stays free of it.
   */
  get top(): number {
    const a = this.positions.array as Float32Array
    let top = 0
    for (let i = 1; i < a.length; i += 3) if (a[i] > top) top = a[i]
    return top
  }

  /** Pose the plant `t ∈ [0, 1]` of the way from `stage` to `stage + 1`. */
  setMorph(t: number): void {
    const k = this.morph.isStatic ? 0 : Math.min(1, Math.max(0, t))
    if (k === this.lastT || (Math.abs(k - this.lastT) < T_EPSILON && k !== 0 && k !== 1)) return
    this.lastT = k

    sampleSegments(this.morph, k, this.positions.array as Float32Array)
    this.positions.needsUpdate = true

    sampleLeaves(this.morph, k, this.leafPose)
    writeLeafMatrices(this.leafPose, this.leafCount, this.leafMatrices.array as Float32Array)
    this.leafMatrices.needsUpdate = true
  }

  dispose(): void {
    this.branchGeometry.dispose()
  }
}

// --- shared cache -----------------------------------------------------------

/** Current morph plus the one(s) just left behind; older ones are disposed. */
const MAX_CACHED = 3
const builders = new Map<string, MorphBuilder>()
const plants = new Map<string, MorphedPlant>() // insertion order = least → most recently used

/**
 * The morph for `species` starting at `stage`, built once and shared. The
 * strings, lineage and geometry are the expensive part and only happen when the
 * stage steps, never per frame.
 */
export function getMorphedPlant(species: string, stage: number): MorphedPlant {
  const n = Math.max(0, Math.min(MAX_ITERATIONS, Math.floor(stage)))
  const key = `${species}:${n}`

  const hit = plants.get(key)
  if (hit) {
    plants.delete(key) // refresh recency
    plants.set(key, hit)
    return hit
  }

  let builder = builders.get(species)
  if (!builder) {
    builder = createMorphBuilder(SPECIES_LSYSTEMS[species] ?? SPECIES_LSYSTEMS.sunflower)
    builders.set(species, builder)
  }
  const plant = new MorphedPlant(key, builder.morph(n))
  plants.set(key, plant)

  while (plants.size > MAX_CACHED) {
    const oldest = plants.keys().next().value as string
    plants.get(oldest)?.dispose()
    plants.delete(oldest)
  }
  return plant
}
