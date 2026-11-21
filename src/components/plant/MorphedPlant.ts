import * as THREE from 'three'
import { SPECIES_LSYSTEMS, leafSpec, type LeafSpec } from '../../simulation/LSystem'
import {
  LEAF_STRIDE,
  MAX_ITERATIONS,
  createMorphBuilder,
  sampleLeaves,
  sampleSegments,
  sampleThickness,
  type LSystemMorph,
  type MorphBuilder,
} from '../../simulation/LSystemMorph'
import { branchDetail, writeBranchMatrices, type BranchDetail } from './branchMatrix'
import { createLeafGeometry, leafRows } from './leafGeometry'
import { writeLeafMatrices } from './leafMatrix'

/** Re-posing is skipped when the factor moved less than this (stalled growth costs nothing). */
const T_EPSILON = 1e-4

/**
 * The drawable form of one L-system morph: branch and leaf instance-matrix
 * buffers whose contents are re-posed in place for any t. A branch is one
 * instance of a shared cylinder (`branchGeometry`), a leaf one of the species'
 * shared blade (`leafGeometry`).
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
  readonly segmentCount: number
  /** The unit cylinder every branch instances; shared between plants, so not owned (never disposed) here. */
  readonly branchGeometry: THREE.BufferGeometry
  readonly branchMatrices: THREE.InstancedBufferAttribute
  /** The species' blade, simplified for the number of leaves; shared between plants, so not owned (never disposed) here. */
  readonly leafGeometry: THREE.BufferGeometry
  readonly leafMatrices: THREE.InstancedBufferAttribute

  private readonly morph: LSystemMorph
  private readonly segmentPose: Float32Array
  private readonly thicknessPose: Float32Array
  private readonly leafPose: Float32Array
  private lastT = NaN

  constructor(key: string, morph: LSystemMorph, leaf: LeafSpec) {
    this.key = key
    this.morph = morph
    this.stage = morph.iterations
    this.leafCount = morph.leafCount

    this.segmentCount = morph.segmentCount
    this.branchGeometry = getBranchGeometry(branchDetail(morph.segmentCount))
    this.branchMatrices = new THREE.InstancedBufferAttribute(new Float32Array(morph.segmentCount * 16), 16)
    this.branchMatrices.setUsage(THREE.DynamicDrawUsage)
    this.segmentPose = new Float32Array(morph.segmentsTo.length)
    this.thicknessPose = new Float32Array(morph.segmentCount)

    this.leafGeometry = getLeafGeometry(leaf, leafRows(morph.leafCount))
    this.leafMatrices = new THREE.InstancedBufferAttribute(new Float32Array(morph.leafCount * 16), 16)
    this.leafMatrices.setUsage(THREE.DynamicDrawUsage)
    this.leafPose = new Float32Array(morph.leafCount * LEAF_STRIDE)
  }

  /** Pose the plant `t ∈ [0, 1]` of the way from `stage` to `stage + 1`. */
  setMorph(t: number): void {
    const k = this.morph.isStatic ? 0 : Math.min(1, Math.max(0, t))
    if (k === this.lastT || (Math.abs(k - this.lastT) < T_EPSILON && k !== 0 && k !== 1)) return
    this.lastT = k

    sampleSegments(this.morph, k, this.segmentPose)
    sampleThickness(this.morph, k, this.thicknessPose)
    writeBranchMatrices(this.segmentPose, this.thicknessPose, this.segmentCount, this.branchMatrices.array as Float32Array)
    this.branchMatrices.needsUpdate = true

    sampleLeaves(this.morph, k, this.leafPose)
    writeLeafMatrices(this.leafPose, this.leafCount, this.leafMatrices.array as Float32Array)
    this.leafMatrices.needsUpdate = true
  }

  /** Nothing to release: the cylinder is shared and the matrix buffers are plain typed arrays. */
  dispose(): void {}
}

// --- shared branch cylinder ---------------------------------------------------

const cylinders = new Map<string, THREE.BufferGeometry>()

/**
 * Unit cylinder (radius 1, height 1) standing on the origin along +Y, which
 * `writeBranchMatrix` stretches onto each segment. One per detail level, shared by
 * every plant, so it lives for the page.
 */
function getBranchGeometry({ radialSegments, capped }: BranchDetail): THREE.BufferGeometry {
  const key = `${radialSegments}:${capped}`
  let g = cylinders.get(key)
  if (!g) {
    g = new THREE.CylinderGeometry(1, 1, 1, radialSegments, 1, !capped)
    g.translate(0, 0.5, 0)
    cylinders.set(key, g)
  }
  return g
}

// --- shared leaf blades -------------------------------------------------------

const blades = new Map<string, THREE.BufferGeometry>()

/** One blade per shape and level of detail, shared by every plant, so it lives for the page. */
function getLeafGeometry(leaf: LeafSpec, rows: number): THREE.BufferGeometry {
  const key = `${leaf.shape}:${leaf.aspect}:${leaf.fold}:${leaf.curl}:${rows}`
  let g = blades.get(key)
  if (!g) {
    g = createLeafGeometry(leaf, rows)
    blades.set(key, g)
  }
  return g
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

  const def = SPECIES_LSYSTEMS[species] ?? SPECIES_LSYSTEMS.sunflower
  let builder = builders.get(species)
  if (!builder) {
    builder = createMorphBuilder(def)
    builders.set(species, builder)
  }
  const plant = new MorphedPlant(key, builder.morph(n), leafSpec(def))
  plants.set(key, plant)

  while (plants.size > MAX_CACHED) {
    const oldest = plants.keys().next().value as string
    plants.get(oldest)?.dispose()
    plants.delete(oldest)
  }
  return plant
}
