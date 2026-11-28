import * as THREE from 'three'
import { specimenPolyhedron } from '../../simulation/CrystalGrowth'
import { polyhedronExtents, polyhedronToMesh, type Polyhedron } from '../../simulation/CrystalHabit'
import type { GemstoneDef } from '../../simulation/GemstonePresets'

/** Re-mesh when any normalised face distance moved more than this (≈ 0.01 % of the size: no visible steps). */
const REBUILD_EPS = 1e-4

export type HabitPaint = { mode: 'family' } | { mode: 'pleo'; alongC: string; acrossC: string }

/**
 * The specimen habit as a BufferGeometry normalised to unit equivalent radius,
 * so growth itself is a per-frame scale. Re-meshed from the (eased) face
 * distances whenever the habit's *shape* changes; when the face topology stays
 * the same the vertex buffers are rewritten in place instead of reallocated.
 *
 * Attributes: `position`, `normal`, `color` (face-indexing colours, or the
 * pleochroic tint for the classic material — see `paint`) and `pleo`
 * (|n·c| per vertex, read by the TSL gem material).
 */
export class HabitGeometry {
  geometry = new THREE.BufferGeometry()
  halfLength = 1
  halfExtent = 1
  poly: Polyhedron | null = null
  /** Bumped whenever `poly` changes (labels / outlines follow it). */
  version = 0

  private last: number[] | null = null
  private families: Int8Array = new Int8Array(0)
  private paintKey = ''
  private readonly targets = new Set<THREE.Mesh>()
  private readonly c = new THREE.Color()
  private readonly c2 = new THREE.Color()
  private readonly white = new THREE.Color('#ffffff')

  constructor(private readonly def: GemstoneDef) {}

  attach(mesh: THREE.Mesh | null, previous?: THREE.Mesh | null) {
    if (previous) this.targets.delete(previous)
    if (mesh) {
      this.targets.add(mesh)
      mesh.geometry = this.geometry
    }
  }

  /** `h` in mm, `radius` the equivalent radius in mm. Returns true if the shape changed. */
  update(h: number[], radius: number, paint: HabitPaint): boolean {
    const inv = 1 / Math.max(radius, 1e-6)
    const prev = this.last
    let changed = !prev || prev.length !== h.length
    if (!changed) for (let i = 0; i < h.length && !changed; i++) changed = Math.abs(h[i] * inv - prev![i]) > REBUILD_EPS
    if (changed) this.rebuild(h.map((x) => x * inv))
    this.paint(paint, changed)
    return changed
  }

  private rebuild(hn: number[]) {
    this.last = hn
    const poly = specimenPolyhedron(this.def, hn)
    const mesh = polyhedronToMesh(poly)
    const n = mesh.families.length
    const pos = this.geometry.getAttribute('position') as THREE.BufferAttribute | undefined
    if (pos && pos.count === n) {
      ;(pos.array as Float32Array).set(mesh.positions)
      pos.needsUpdate = true
      const nor = this.geometry.getAttribute('normal') as THREE.BufferAttribute
      ;(nor.array as Float32Array).set(mesh.normals)
      nor.needsUpdate = true
      this.writePleo(mesh.normals, this.geometry.getAttribute('pleo') as THREE.BufferAttribute)
    } else {
      const g = new THREE.BufferGeometry()
      g.setAttribute('position', new THREE.BufferAttribute(mesh.positions, 3))
      g.setAttribute('normal', new THREE.BufferAttribute(mesh.normals, 3))
      g.setAttribute('color', new THREE.BufferAttribute(new Float32Array(n * 3), 3))
      const pleo = new THREE.BufferAttribute(new Float32Array(n), 1)
      this.writePleo(mesh.normals, pleo)
      g.setAttribute('pleo', pleo)
      const old = this.geometry
      this.geometry = g
      for (const m of this.targets) m.geometry = g
      old.dispose()
      this.paintKey = ''
    }
    this.families = mesh.families
    this.geometry.computeBoundingSphere()
    const ext = polyhedronExtents(poly)
    this.halfLength = ext.length / 2
    this.halfExtent = Math.max(ext.length, ext.width) / 2
    this.poly = poly
    this.version++
  }

  private writePleo(normals: Float32Array, attr: THREE.BufferAttribute) {
    const a = attr.array as Float32Array
    for (let i = 0; i < a.length; i++) a[i] = Math.abs(normals[i * 3 + 1]) // c-axis = +Y
    attr.needsUpdate = true
  }

  private paint(p: HabitPaint, force: boolean) {
    const key = p.mode === 'family' ? 'family' : `${p.alongC}${p.acrossC}`
    if (!force && key === this.paintKey) return
    this.paintKey = key
    const col = this.geometry.getAttribute('color') as THREE.BufferAttribute | undefined
    if (!col) return
    const a = col.array as Float32Array
    if (p.mode === 'family') {
      for (let i = 0; i < this.families.length; i++) {
        this.c.set(this.def.faces[this.families[i]]?.color ?? '#888888')
        a[i * 3] = this.c.r
        a[i * 3 + 1] = this.c.g
        a[i * 3 + 2] = this.c.b
      }
    } else {
      // classic material: the tint seen through each face, kept light (the depth of colour comes from absorption)
      const pleo = (this.geometry.getAttribute('pleo') as THREE.BufferAttribute).array as Float32Array
      const along = this.c2.set(p.alongC)
      const across = new THREE.Color(p.acrossC)
      for (let i = 0; i < pleo.length; i++) {
        this.c.copy(across).lerp(along, pleo[i] * pleo[i])
        this.c.lerp(this.white, 0.45)
        a[i * 3] = this.c.r
        a[i * 3 + 1] = this.c.g
        a[i * 3 + 2] = this.c.b
      }
    }
    col.needsUpdate = true
  }

  dispose() {
    this.geometry.dispose()
    this.targets.clear()
  }
}
