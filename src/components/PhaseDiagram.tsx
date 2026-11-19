import { useMemo, useRef, type PointerEvent as ReactPointerEvent } from 'react'
import {
  alphaBetaQuartzT,
  GEOLOGY_RANGES,
  graphiteDiamondP,
  type GemstoneDef,
  type GeologyState,
} from '../simulation/GemstonePresets'

const W = 268
const H = 150
const PAD = { l: 30, r: 6, t: 6, b: 20 }
const PW = W - PAD.l - PAD.r
const PH = H - PAD.t - PAD.b
const T_MIN = GEOLOGY_RANGES.temperature.min
const T_MAX = GEOLOGY_RANGES.temperature.max
const LP_MIN = Math.log10(GEOLOGY_RANGES.pressure.min)
const LP_MAX = Math.log10(GEOLOGY_RANGES.pressure.max)

const xOf = (t: number) => PAD.l + ((t - T_MIN) / (T_MAX - T_MIN)) * PW
const yOf = (p: number) => PAD.t + PH - ((Math.log10(Math.max(p, 1e-3)) - LP_MIN) / (LP_MAX - LP_MIN)) * PH

interface Boundary {
  label: string
  points: [number, number][] // [T, P]
  dashed?: boolean
}

function boundaries(def: GemstoneDef): Boundary[] {
  const ps = Array.from({ length: 40 }, (_, i) => 10 ** (LP_MIN + ((LP_MAX - LP_MIN) * i) / 39))
  const ts = Array.from({ length: 40 }, (_, i) => T_MIN + ((T_MAX - T_MIN) * i) / 39)
  const out: Boundary[] = []
  if (def.lattice === 'alpha-quartz') {
    out.push({ label: 'α | β', points: ps.map((p) => [alphaBetaQuartzT(p), p] as [number, number]).filter(([t]) => t < T_MAX) })
  }
  if (def.id === 'amethyst') {
    out.push({ label: 'bleach', dashed: true, points: [[350, 10 ** LP_MIN], [350, 10 ** LP_MAX]] })
  }
  if (def.id === 'diamond') {
    out.push({ label: 'graphite | diamond', points: ts.map((t) => [t, graphiteDiamondP(t)] as [number, number]) })
  }
  return out
}

/**
 * Pressure–temperature map of where the selected mineral can grow.
 * Click or drag to move the growth conditions.
 */
export function PhaseDiagram({
  def,
  geology,
  onPick,
}: {
  def: GemstoneDef
  geology: GeologyState
  onPick: (t: number, p: number) => void
}) {
  const svg = useRef<SVGSVGElement>(null)
  const dragging = useRef(false)

  const cells = useMemo(() => {
    const nx = 44
    const ny = 26
    const out: { x: number; y: number; w: number; h: number; o: number }[] = []
    for (let i = 0; i < nx; i++) {
      for (let j = 0; j < ny; j++) {
        const t = T_MIN + ((i + 0.5) / nx) * (T_MAX - T_MIN)
        const p = 10 ** (LP_MIN + ((j + 0.5) / ny) * (LP_MAX - LP_MIN))
        const o = def.stability({ ...def.defaults, temperature: t, pressure: p })
        if (o > 0.02) {
          out.push({ x: PAD.l + (i / nx) * PW, y: PAD.t + PH - ((j + 1) / ny) * PH, w: PW / nx + 0.3, h: PH / ny + 0.3, o })
        }
      }
    }
    return out
  }, [def])

  const lines = useMemo(() => boundaries(def), [def])

  const pick = (e: ReactPointerEvent) => {
    const el = svg.current
    if (!el) return
    const r = el.getBoundingClientRect()
    const x = ((e.clientX - r.left) / r.width) * W
    const y = ((e.clientY - r.top) / r.height) * H
    const t = T_MIN + ((x - PAD.l) / PW) * (T_MAX - T_MIN)
    const lp = LP_MIN + ((PAD.t + PH - y) / PH) * (LP_MAX - LP_MIN)
    onPick(
      Math.round(Math.min(T_MAX, Math.max(T_MIN, t)) / 5) * 5,
      Math.min(10 ** LP_MAX, Math.max(10 ** LP_MIN, 10 ** lp))
    )
  }

  const px = xOf(geology.temperature)
  const py = yOf(geology.pressure)

  return (
    <svg
      ref={svg}
      className="phase-diagram"
      viewBox={`0 0 ${W} ${H}`}
      role="img"
      aria-label={`Pressure–temperature stability field for ${def.mineral}`}
      onPointerDown={(e) => {
        dragging.current = true
        ;(e.target as Element).setPointerCapture?.(e.pointerId)
        pick(e)
      }}
      onPointerMove={(e) => dragging.current && pick(e)}
      onPointerUp={() => (dragging.current = false)}
      onPointerLeave={() => (dragging.current = false)}
    >
      <rect x={PAD.l} y={PAD.t} width={PW} height={PH} className="pd-bg" />
      {cells.map((c, i) => (
        <rect key={i} x={c.x} y={c.y} width={c.w} height={c.h} fill={def.swatch} opacity={0.12 + 0.4 * c.o} />
      ))}
      {[0.01, 0.1, 1, 10].map((p) => (
        <g key={p}>
          <line x1={PAD.l} x2={PAD.l + PW} y1={yOf(p)} y2={yOf(p)} className="pd-grid" />
          <text x={PAD.l - 3} y={yOf(p) + 3} className="pd-tick" textAnchor="end">
            {p < 1 ? p : p.toFixed(0)}
          </text>
        </g>
      ))}
      {[0, 400, 800, 1200, 1600].map((t) => (
        <g key={t}>
          <line x1={xOf(Math.max(t, T_MIN))} x2={xOf(Math.max(t, T_MIN))} y1={PAD.t} y2={PAD.t + PH} className="pd-grid" />
          <text x={xOf(Math.max(t, T_MIN))} y={H - 8} className="pd-tick" textAnchor={t === 1600 ? 'end' : t === 0 ? 'start' : 'middle'}>
            {t}
          </text>
        </g>
      ))}
      {lines.map((b) => (
        <g key={b.label}>
          <polyline
            points={b.points.map(([t, p]) => `${xOf(t)},${yOf(p)}`).join(' ')}
            className="pd-boundary"
            strokeDasharray={b.dashed ? '3 2' : undefined}
          />
          {b.points.length > 0 && (
            <text
              x={Math.min(PAD.l + PW - 4, xOf(b.points[Math.floor(b.points.length * 0.25)][0]) + 4)}
              y={Math.max(PAD.t + 8, yOf(b.points[Math.floor(b.points.length * 0.25)][1]) - 3)}
              className="pd-label"
            >
              {b.label}
            </text>
          )}
        </g>
      ))}
      <circle cx={px} cy={py} r={5} className="pd-point" />
      <circle cx={px} cy={py} r={9} className="pd-point-halo" />
      <text x={PAD.l + PW / 2} y={H - 0.5} className="pd-axis" textAnchor="middle">
        T (°C)
      </text>
      <text x={7} y={PAD.t + PH / 2} className="pd-axis" textAnchor="middle" transform={`rotate(-90 7 ${PAD.t + PH / 2})`}>
        P (kbar)
      </text>
    </svg>
  )
}
