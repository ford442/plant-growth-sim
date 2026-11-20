import { useEffect, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import { Html } from '@react-three/drei'
import * as THREE from 'three'
import { useSimStore } from '../../stores/simStore'
import {
  cambialResponse,
  cellPlateProgress,
  CYCLE,
  FILE_COUNT,
  layoutFile,
  smoothstep,
  type CambialCell,
  type LayoutKind,
  type RadialFile,
  type TissueCell,
} from '../../simulation/TissueGrowth'
import { COLOR, mixColor, TISSUE_INFO } from './palette'
import { InstanceLayer } from './instances'
import { FADE_UM, LENS_HEIGHT, LENS_LEFT, LENS_LEFT_UM, LENS_RIGHT, LENS_SCALE, ROW_H, rowY } from './geometry'

/**
 * The cell lens: a magnified strip of the stem at 3 o'clock, one row per radial
 * file, redrawn every frame from the pure tissue state.
 *
 * What to look for:
 *  - the bright teal column is the cambium; its cells swell through G1/S/G2 (the
 *    nucleus grows), then mitosis shows chromosomes lining up, splitting, and a
 *    new wall (cell plate) growing across before the cell divides in two;
 *  - the daughter on the inner side swells and hardens into wood: wide round
 *    vessels (blue, water-filled) and narrow brown fibres;
 *  - every few divisions the outer daughter becomes phloem instead;
 *  - pale lines mark growth-ring boundaries; in drought, cells stay small,
 *    living cells shrivel and vessels fill with air.
 */

const S = LENS_SCALE
const Z_WALL = 0
const Z_LUMEN = 0.01
const Z_VESSEL = 0.02
const Z_NUCLEUS = 0.03
const Z_BAR = 0.04

// Generous upper bounds: 8 files × (26 xylem + 4 primary + cambium + 4 phloem + cortex + skin).
const CAP_RECT = 520
const CAP_ROUND = 520
const CAP_NUCLEI = 640
const CAP_BARS = 320

const MIN_WALL = 0.011

interface Layers {
  walls: InstanceLayer
  lumens: InstanceLayer
  vessels: InstanceLayer
  nuclei: InstanceLayer
  bars: InstanceLayer
}

/** Per-frame values the drawing code needs, resolved once. */
interface Env {
  /** 0 (wilted) – 1 (turgid): cell enlargement gate. Drives shrivelling. */
  turgor: number
  /** 0–1: how air-filled the vessels are. */
  embolism: number
}

const wall = new THREE.Color()
const lumen = new THREE.Color()
const nucleus = new THREE.Color()

/** Stable pseudo-random 0–1 for decorative cells that carry no state of their own. */
function hash01(a: number, b: number, c: number): number {
  let h = Math.imul(a + 1, 374761393) ^ Math.imul(b + 7, 668265263) ^ Math.imul(c + 13, 2246822519)
  h = Math.imul(h ^ (h >>> 13), 1274126177)
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296
}

const KIND_ORDER: LayoutKind[] = [
  'pith',
  'primaryXylem',
  'xylem',
  'cambium',
  'phloem',
  'cortex',
  'epidermis',
]

function drawCell(
  L: Layers,
  env: Env,
  kind: LayoutKind,
  x0: number,
  x1: number,
  cell: TissueCell | null,
  idx: number,
  fileIndex: number,
  y: number,
): void {
  const left = -LENS_LEFT_UM
  if (x1 <= left + 3) return
  const a = Math.max(x0, left)
  const mid = (a + x1) / 2
  const w = (x1 - a) * S
  const h = ROW_H
  const cx = mid * S
  // 1 at the clipped edge, 0 once the cell is well inside the lens
  const fade = 1 - smoothstep(left, left + FADE_UM, mid)

  let wallFrac = 0.1
  let living = 0
  let round = false
  let nucleusSize = 0 // fraction of the lumen's short side
  nucleus.copy(COLOR.phloemNucleus)

  switch (kind) {
    case 'pith':
      wall.copy(COLOR.pithWall)
      lumen.copy(COLOR.pith)
      wallFrac = 0.07
      living = 1
      break
    case 'primaryXylem':
      wall.copy(COLOR.primaryXylem)
      lumen.copy(COLOR.primaryXylemLumen)
      wallFrac = 0.14
      round = true
      break
    case 'xylem': {
      const c = cell!
      const m = c.maturity
      const fibre = c.variant === 'fibre'
      // Late, small fibres end up with the thickest walls (that is what makes latewood dark).
      const thick = fibre ? 0.5 - 0.34 * smoothstep(6, 16, c.target) : 0.09
      wallFrac = 0.07 + (thick - 0.07) * smoothstep(0.15, 0.9, m)
      mixColor(wall, COLOR.xylemYoungWall, fibre ? COLOR.fibreWall : COLOR.vesselWall, smoothstep(0.25, 1, m))
      const dead = smoothstep(0.75, 0.97, m)
      if (fibre) {
        mixColor(lumen, COLOR.cytoplasm, COLOR.fibreLumen, dead)
      } else {
        // a vessel's emptied lumen carries water, or air once the water column breaks
        mixColor(nucleus, COLOR.water, COLOR.air, env.embolism)
        mixColor(lumen, COLOR.cytoplasm, nucleus, dead)
        nucleus.copy(COLOR.phloemNucleus)
        round = true
      }
      living = 1 - dead
      nucleusSize = 0.42 * (1 - smoothstep(0.45, 0.8, m))
      break
    }
    case 'phloem': {
      const c = cell!
      wall.copy(COLOR.phloemWall)
      wallFrac = 0.11
      living = 1
      if (c.variant === 'sieve') {
        lumen.copy(COLOR.sieveLumen)
        // sieve tube elements lose their nucleus as they mature
        nucleusSize = 0.36 * (1 - smoothstep(0.3, 0.6, c.maturity))
      } else {
        lumen.copy(COLOR.companionLumen)
        nucleusSize = 0.4
      }
      break
    }
    case 'cortex':
      wall.copy(COLOR.cortexWall)
      lumen.copy(COLOR.cortexLumen)
      wallFrac = 0.09
      living = 1
      nucleusSize = 0.22
      break
    case 'epidermis':
      wall.copy(COLOR.epidermisWall)
      lumen.copy(COLOR.epidermisLumen)
      wallFrac = 0.34
      living = 0.6
      break
    default:
      return
  }

  // A little per-cell variation so the tissue does not look stamped out.
  const tone = cell ? cell.tone : hash01(fileIndex, idx, KIND_ORDER.indexOf(kind))
  const k = 0.94 + 0.12 * tone
  wall.multiplyScalar(k)
  lumen.multiplyScalar(k)

  // Drought: living cells lose turgor, the protoplast pulls away from the wall and dulls.
  const wilt = (1 - env.turgor) * living
  if (wilt > 0) mixColor(lumen, lumen, COLOR.wilted, wilt * 0.6)
  if (fade > 0) {
    mixColor(wall, wall, COLOR.background, fade * 0.9)
    mixColor(lumen, lumen, COLOR.background, fade * 0.9)
  }

  const wt = Math.max(MIN_WALL, wallFrac * 0.5 * Math.min(w, h))
  let lw = Math.max(0.006, w - 2 * wt)
  let lh = Math.max(0.006, h - 2 * wt)
  const shrink = 1 - 0.28 * wilt
  lw *= shrink
  lh *= shrink

  L.walls.add(cx, y, Z_WALL, w, h, wall)
  if (round) {
    const d = Math.min(lw, lh)
    L.vessels.add(cx, y, Z_VESSEL, d, d, lumen)
  } else {
    L.lumens.add(cx, y, Z_LUMEN, lw, lh, lumen)
  }
  if (nucleusSize > 0.02 && fade < 0.6) {
    const d = nucleusSize * Math.min(lw, lh) * (1 - 0.5 * wilt)
    // living nuclei are a darker shade of the cell's own cytoplasm
    L.nuclei.add(cx, y, Z_NUCLEUS, d, d, nucleus)
  }
}

/** The dividing cell: interphase growth, then the mitosis sequence. */
function drawCambium(L: Layers, env: Env, c: CambialCell, y: number): void {
  const w = c.size * S
  const h = ROW_H
  const wilt = 1 - env.turgor
  const wt = MIN_WALL * 1.2
  const lw = Math.max(0.01, w - 2 * wt) * (1 - 0.2 * wilt)
  const lh = Math.max(0.01, h - 2 * wt) * (1 - 0.2 * wilt)

  wall.copy(COLOR.cambiumWall)
  mixColor(lumen, COLOR.cambiumLumen, COLOR.wilted, wilt * 0.5)
  L.walls.add(0, y, Z_WALL, w, h, wall)
  L.lumens.add(0, y, Z_LUMEN, lw, lh, lumen)

  const p = c.cycle
  const g = smoothstep(0, CYCLE.M_START, p) // interphase growth
  const barW = Math.max(0.02, lw * 0.13)
  const maxNuc = Math.min(lw * 0.82, lh * 0.5)

  if (p < CYCLE.M_START) {
    // interphase: the nucleus enlarges and its colour moves G1 → S → G2
    if (p < CYCLE.G1_END) nucleus.copy(COLOR.nucleusG1)
    else if (p < CYCLE.S_END) nucleus.copy(COLOR.nucleusS)
    else nucleus.copy(COLOR.nucleusG2)
    L.nuclei.add(0, y, Z_NUCLEUS, maxNuc * (0.55 + 0.45 * g), maxNuc * (0.55 + 0.45 * g) * 0.9, nucleus)
    return
  }

  nucleus.copy(COLOR.nucleusG2)
  if (p < CYCLE.PROPHASE_END) {
    // prophase: nuclear envelope dissolves, chromosomes condense
    const q = (p - CYCLE.M_START) / (CYCLE.PROPHASE_END - CYCLE.M_START)
    const s = maxNuc * (1 - 0.65 * q)
    L.nuclei.add(0, y, Z_NUCLEUS, s, s, nucleus)
    L.bars.add(0, y, Z_BAR, barW, lh * (0.14 + 0.4 * q), COLOR.chromosome)
  } else if (p < CYCLE.METAPHASE_END) {
    // metaphase: chromosomes line up on the equator
    L.bars.add(0, y, Z_BAR, barW, lh * 0.66, COLOR.chromosome)
  } else if (p < CYCLE.ANAPHASE_END) {
    // anaphase: sister chromatids pulled to opposite poles (inner and outer face)
    const q = (p - CYCLE.METAPHASE_END) / (CYCLE.ANAPHASE_END - CYCLE.METAPHASE_END)
    const off = lw * (0.08 + 0.27 * q)
    L.bars.add(-off, y, Z_BAR, barW, lh * 0.58, COLOR.chromosome)
    L.bars.add(off, y, Z_BAR, barW, lh * 0.58, COLOR.chromosome)
  } else {
    // telophase + cytokinesis: two nuclei re-form and a cell plate grows outward from the middle
    const q = (p - CYCLE.ANAPHASE_END) / (1 - CYCLE.ANAPHASE_END)
    const off = lw * 0.28
    const s = maxNuc * (0.25 + 0.55 * q)
    nucleus.copy(COLOR.nucleusG1)
    L.nuclei.add(-off, y, Z_NUCLEUS, s * 0.8, s, nucleus)
    L.nuclei.add(off, y, Z_NUCLEUS, s * 0.8, s, nucleus)
    const fade = 1 - smoothstep(0.4, 0.85, q)
    if (fade > 0.05) {
      L.bars.add(-off, y, Z_BAR, barW * 0.8, lh * 0.4 * fade, COLOR.chromosome)
      L.bars.add(off, y, Z_BAR, barW * 0.8, lh * 0.4 * fade, COLOR.chromosome)
    }
    L.bars.add(0, y, Z_BAR, Math.max(0.026, lw * 0.16), lh * cellPlateProgress(p), COLOR.cellPlate)
  }
}

function drawFile(L: Layers, env: Env, f: RadialFile, fileIndex: number): void {
  const y = rowY(fileIndex)
  let prevRing = -1
  let prevX0 = 0
  layoutFile(f, (kind, x0, x1, cell, idx) => {
    if (kind === 'cambium') {
      drawCambium(L, env, f.cambium, y)
      return
    }
    drawCell(L, env, kind, x0, x1, cell, idx, fileIndex, y)
    if (kind === 'xylem' && cell) {
      // layoutFile walks xylem from the cambium inwards: a change of ring is a growth-ring boundary
      if (prevRing !== -1 && cell.ring !== prevRing && prevX0 > -LENS_LEFT_UM + 8) {
        L.bars.add(prevX0 * S, y, Z_BAR, 0.03, ROW_H, COLOR.boundary)
      }
      prevRing = cell.ring
      prevX0 = x0
    }
  })
}

// ---------------------------------------------------------------------------

/** Labels along the foot of the lens; one bar + one caption per tissue. */
const RULER_KINDS = KIND_ORDER

export function CellLens() {
  const wallsRef = useRef<THREE.InstancedMesh>(null)
  const lumensRef = useRef<THREE.InstancedMesh>(null)
  const vesselsRef = useRef<THREE.InstancedMesh>(null)
  const nucleiRef = useRef<THREE.InstancedMesh>(null)
  const barsRef = useRef<THREE.InstancedMesh>(null)
  const glowRef = useRef<THREE.MeshBasicMaterial>(null)
  const layers = useRef<Layers | null>(null)

  const rulerBars = useRef<(THREE.Mesh | null)[]>([])
  const rulerLabels = useRef<(THREE.Group | null)[]>([])
  const rulerText = useRef<(HTMLDivElement | null)[]>([])
  const extents = useRef(RULER_KINDS.map(() => ({ lo: Infinity, hi: -Infinity })))

  useEffect(() => {
    return () => {
      layers.current = null
    }
  }, [])

  useFrame(() => {
    if (!layers.current) {
      const walls = wallsRef.current
      const lumens = lumensRef.current
      const vessels = vesselsRef.current
      const nuclei = nucleiRef.current
      const bars = barsRef.current
      if (!walls || !lumens || !vessels || !nuclei || !bars) return
      layers.current = {
        walls: new InstanceLayer(walls, CAP_RECT),
        lumens: new InstanceLayer(lumens, CAP_RECT),
        vessels: new InstanceLayer(vessels, CAP_ROUND),
        nuclei: new InstanceLayer(nuclei, CAP_NUCLEI),
        bars: new InstanceLayer(bars, CAP_BARS),
      }
    }
    const L = layers.current

    const { tissue, waterStatus, weather } = useSimStore.getState()
    const resp = cambialResponse({ temperature: weather.temperature, light: weather.light, water: waterStatus })
    const env: Env = { turgor: resp.expansion, embolism: smoothstep(0.35, 0.1, waterStatus) }

    L.walls.reset()
    L.lumens.reset()
    L.vessels.reset()
    L.nuclei.reset()
    L.bars.reset()
    for (let i = 0; i < tissue.files.length; i++) drawFile(L, env, tissue.files[i], i)
    L.walls.flush()
    L.lumens.flush()
    L.vessels.flush()
    L.nuclei.flush()
    L.bars.flush()

    if (glowRef.current) glowRef.current.opacity = 0.05 + 0.22 * resp.activity

    // --- ruler: extents of each tissue in the middle file -------------------
    const ext = extents.current
    for (const e of ext) {
      e.lo = Infinity
      e.hi = -Infinity
    }
    const ref = tissue.files[Math.floor(FILE_COUNT / 2)]
    layoutFile(ref, (kind, x0, x1) => {
      const e = ext[KIND_ORDER.indexOf(kind)]
      const lo = Math.max(x0, -LENS_LEFT_UM)
      if (x1 <= -LENS_LEFT_UM) return
      if (lo < e.lo) e.lo = lo
      if (x1 > e.hi) e.hi = x1
    })
    for (let i = 0; i < RULER_KINDS.length; i++) {
      const e = ext[i]
      const present = e.hi > e.lo
      const bar = rulerBars.current[i]
      const label = rulerLabels.current[i]
      const text = rulerText.current[i]
      if (bar) {
        bar.visible = present
        if (present) {
          bar.position.x = ((e.lo + e.hi) / 2) * S
          bar.scale.x = Math.max(0.02, (e.hi - e.lo) * S - 0.035)
        }
      }
      if (label && present) label.position.x = ((e.lo + e.hi) / 2) * S
      if (text) text.style.opacity = present ? '1' : '0'
    }
  })

  const top = LENS_HEIGHT / 2
  const rulerY = -top - 0.16

  return (
    <group>
      {/* backing plate and frame */}
      <mesh position={[(LENS_RIGHT - LENS_LEFT) / 2, 0, -0.03]}>
        <planeGeometry args={[LENS_LEFT + LENS_RIGHT, LENS_HEIGHT]} />
        <meshBasicMaterial color={COLOR.background} toneMapped={false} />
      </mesh>
      <lineLoop position={[0, 0, -0.02]}>
        <bufferGeometry>
          <bufferAttribute
            attach="attributes-position"
            args={[
              new Float32Array([
                -LENS_LEFT, -top, 0, LENS_RIGHT, -top, 0, LENS_RIGHT, top, 0, -LENS_LEFT, top, 0,
              ]),
              3,
            ]}
          />
        </bufferGeometry>
        <lineBasicMaterial color="#3f6f46" toneMapped={false} />
      </lineLoop>

      {/* cambium column glow: brighter the faster the cambium is cycling */}
      <mesh position={[0, 0, -0.015]}>
        <planeGeometry args={[0.7, LENS_HEIGHT]} />
        <meshBasicMaterial
          ref={glowRef}
          color={COLOR.cambiumLumen}
          transparent
          opacity={0.2}
          depthWrite={false}
          toneMapped={false}
        />
      </mesh>

      <instancedMesh ref={wallsRef} args={[undefined, undefined, CAP_RECT]}>
        <planeGeometry args={[1, 1]} />
        <meshBasicMaterial toneMapped={false} />
      </instancedMesh>
      <instancedMesh ref={lumensRef} args={[undefined, undefined, CAP_RECT]}>
        <planeGeometry args={[1, 1]} />
        <meshBasicMaterial toneMapped={false} />
      </instancedMesh>
      <instancedMesh ref={vesselsRef} args={[undefined, undefined, CAP_ROUND]}>
        <circleGeometry args={[0.5, 24]} />
        <meshBasicMaterial toneMapped={false} />
      </instancedMesh>
      <instancedMesh ref={nucleiRef} args={[undefined, undefined, CAP_NUCLEI]}>
        <circleGeometry args={[0.5, 20]} />
        <meshBasicMaterial toneMapped={false} />
      </instancedMesh>
      <instancedMesh ref={barsRef} args={[undefined, undefined, CAP_BARS]}>
        <planeGeometry args={[1, 1]} />
        <meshBasicMaterial toneMapped={false} />
      </instancedMesh>

      {/* ruler: coloured bar + caption under each tissue (captions alternate height so neighbours never collide) */}
      {RULER_KINDS.map((kind, i) => {
        const info = TISSUE_INFO[kind]
        return (
          <group key={kind}>
            <mesh
              ref={(m) => {
                rulerBars.current[i] = m
              }}
              position={[0, rulerY, 0]}
            >
              <planeGeometry args={[1, 0.07]} />
              <meshBasicMaterial color={info.color} toneMapped={false} />
            </mesh>
            <group
              ref={(g) => {
                rulerLabels.current[i] = g
              }}
              position={[0, rulerY - 0.2 - (i % 2) * 0.27, 0]}
            >
              <Html center zIndexRange={[20, 0]} style={{ pointerEvents: 'none' }}>
                <div
                  className="tissue-label"
                  style={{ color: info.color }}
                  ref={(el) => {
                    rulerText.current[i] = el
                  }}
                >
                  {info.label}
                </div>
              </Html>
            </group>
          </group>
        )
      })}

      {/* orientation */}
      <group position={[-LENS_LEFT + 0.06, top + 0.2, 0]}>
        <Html zIndexRange={[20, 0]} style={{ pointerEvents: 'none', transform: 'translate(0, -50%)' }}>
          <div className="tissue-label tissue-label-dim">← toward pith (stem centre)</div>
        </Html>
      </group>
      <group position={[LENS_RIGHT - 0.06, top + 0.2, 0]}>
        <Html zIndexRange={[20, 0]} style={{ pointerEvents: 'none', transform: 'translate(-100%, -50%)' }}>
          <div className="tissue-label tissue-label-dim">toward bark →</div>
        </Html>
      </group>
    </group>
  )
}
