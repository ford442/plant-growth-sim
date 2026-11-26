import { lazy, Suspense, useCallback, useState } from 'react'
import { Canvas } from '@react-three/fiber'
import { OrbitControls, Environment, Stats } from '@react-three/drei'
import { PlantViewer, PLANT_VIEW_TARGET } from './components/PlantViewer'
import { SoilPanel } from './components/SoilPanel'
import type { SoilOverlay } from './components/soil/palette'
import { CrystalViewer, GemLightformers, GEM_VIEW_TARGET, type GemViewOptions, type GemViewScale } from './components/CrystalViewer'
import { WeatherPanel } from './components/WeatherPanel'
import { GeologyPanel } from './components/GeologyPanel'
import { TissueHud, TissuePanel } from './components/TissuePanel'
import { GemInfoPanel } from './components/GemInfoPanel'
import { SpeciesSelector } from './components/SpeciesSelector'
import { GemstoneSelector } from './components/GemstoneSelector'
import { ParasiteSelector } from './components/ParasiteSelector'
import { GameHud, ObjectiveModal } from './components/parasite/GameHud'
/**
 * `?debug=1` adds a Leva panel for the objective thresholds. Lazy, so `leva`
 * is fetched only when the switch is on and stays out of the default bundle.
 */
const TuningPanel = lazy(() => import('./components/parasite/TuningPanel'))
const DEBUG_TUNING =
  typeof window !== 'undefined' && new URLSearchParams(window.location.search).has('debug')
import {
  HostPanel,
  ObjectivePanel,
  ParasiteInfoPanel,
  ParasiteViewportHint,
} from './components/ParasitePanels'
import { GEM_TABS, PARASITE_TABS, PLANT_TABS, ScaleTabs } from './components/ScaleTabs'
import { ModeSwitch } from './components/ModeSwitch'
import { SimControls } from './components/SimControls'
import { SimClock } from './components/SimClock'
import {
  ParasiteCameraRig,
  ParasiteLights,
  ParasiteViewer,
  PARASITE_VIEW_TARGET,
  type ParasiteViewScale,
} from './components/ParasiteViewer'
import { LyticPanel, LyticTimeline } from './components/parasite/LyticPanels'
import { SliceOverlay, SlicePanel } from './components/parasite/SlicePanels'
import { useSimStore } from './stores/simStore'
import { useModeStore } from './stores/modeStore'
import { useTimeStore } from './stores/timeStore'
import { useParasiteStore } from './stores/parasiteStore'
import { useLyticStore } from './stores/lyticStore'
import { LYTIC_PHASE_DEFS, lyticSettled } from './simulation/parasite/lytic/sandbox'
import { useRendererStore } from './stores/rendererStore'
import { RendererPanel } from './components/RendererPanel'
import { RendererLifecycle, backendForMode, rendererFactory, useGraphicsCapability } from './rendering'
import { GEMSTONE_PRESETS } from './simulation/GemstonePresets'
import { SOIL_PROFILES } from './simulation/SoilField'
import { COMPARTMENT_LABEL } from './simulation/parasite/stages'
import './App.css'

export type ViewScale = 'macro' | 'architecture' | 'cellular' | 'roots'

const STATUS_HUD: Record<string, string> = {
  growing: 'GROWING',
  mature: 'MATURE',
  equilibrium: 'SATURATED',
  unstable: 'UNSTABLE',
  dissolving: 'DISSOLVING',
  resorbing: 'RESORBING',
}

const MODE_TITLE = {
  plant: { icon: '🌿', title: 'Plant Growth Simulator', subtitle: 'Multi-scale botanical simulation' },
  gem: { icon: '💎', title: 'Gemstone Growth Simulator', subtitle: 'Multi-scale crystal growth' },
  parasite: { icon: '🦠', title: 'Toxoplasma Life-Cycle Simulator', subtitle: 'Multi-scale host–parasite sim-game' },
} as const

const MODE_FOOTER = {
  plant: 'L-systems · FSPM · Water uptake · Weather',
  gem: 'Kinetic Wulff habits · BCF growth · Nucleation · Real lattices',
  parasite: 'Glideosome traction · Moving junction · BFD1 latency · TgPLP1 egress',
} as const

function App() {
  const [scale, setScale] = useState<ViewScale>('architecture')
  const [gemScale, setGemScale] = useState<GemViewScale>('crystal')
  const [parasiteScale, setParasiteScale] = useState<ParasiteViewScale>('tissue')
  const [gemOptions, setGemOptions] = useState<GemViewOptions>({ faceIndexing: false, phantoms: true })
  const [soilOverlay, setSoilOverlay] = useState<SoilOverlay>('moisture')
  const [soilFlow, setSoilFlow] = useState(true)
  const mode = useModeStore((s) => s.mode)
  const species = useSimStore((s) => s.species)
  const soilProfile = useSimStore((s) => s.soilProfile)
  const gemstone = useSimStore((s) => s.gemstone)
  const crystalStatus = useSimStore((s) => s.crystal.status)
  const isPlaying = useTimeStore((s) => s.isPlaying)
  const capability = useGraphicsCapability()
  // WebGL unless the user opted in *and* this mode is node/TSL-ready (see rendererPreference.ts)
  const rendererPreference = useRendererStore((s) => s.preference)
  const setActiveRenderer = useRendererStore((s) => s.setActive)
  // drei's Environment children render through a cube camera that the node renderer's WebGL2
  // backend rejects (GL_INVALID_OPERATION); the gem softboxes stay on the classic renderer only
  const classicRenderer = useRendererStore((s) => s.active) === 'webgl'
  const backend = backendForMode(mode, rendererPreference)
  // bumping the key remounts the Canvas with a fresh renderer after device loss
  const [canvasKey, setCanvasKey] = useState(0)
  const remountCanvas = useCallback(() => setCanvasKey((k) => k + 1), [])
  const isGem = mode === 'gem'
  const isParasite = mode === 'parasite'
  const bg = isParasite ? '#05080c' : isGem ? '#08070d' : '#0a0f0a'
  const chrome = MODE_TITLE[mode]

  return (
    <div className={`app mode-${mode}`}>
      {/* Top bar */}
      <header className="header">
        <div className="logo">
          <span className="logo-icon">{chrome.icon}</span>
          <div>
            <h1>{chrome.title}</h1>
            <p className="subtitle">{chrome.subtitle}</p>
          </div>
        </div>
        <ModeSwitch />
        {isParasite ? <ParasiteSelector /> : isGem ? <GemstoneSelector /> : <SpeciesSelector />}
        {isParasite ? (
          <ScaleTabs tabs={PARASITE_TABS} scale={parasiteScale} onChange={setParasiteScale} />
        ) : isGem ? (
          <ScaleTabs tabs={GEM_TABS} scale={gemScale} onChange={setGemScale} />
        ) : (
          <ScaleTabs tabs={PLANT_TABS} scale={scale} onChange={setScale} />
        )}
      </header>

      {/* one clock for every mode, outside the Canvas so a remount never forks or stops it */}
      <SimClock />

      <div className="main">
        {/* 3D Viewport */}
        <div className="viewport">
          {capability && (
          <Canvas
            // the `gl` factory only runs when the Canvas is created, so a backend change remounts it
            key={`${canvasKey}:${backend}`}
            camera={{ position: [0, 4, 8], fov: 45 }}
            dpr={[1, 2]}
            gl={rendererFactory({ backend, capability })}
          >
            <RendererLifecycle onDeviceLost={remountCanvas} onActive={setActiveRenderer} />
            <color attach="background" args={[bg]} />
            {!isParasite && <fog attach="fog" args={[bg, 12, 35]} />}

            {isParasite ? (
              <ParasiteLights />
            ) : (
              <>
                <ambientLight intensity={0.35} />
                <directionalLight
                  position={[8, 12, 5]}
                  intensity={1.2}
                  castShadow
                  shadow-mapSize={[1024, 1024]}
                />
                <hemisphereLight args={isGem ? ['#b8c8ff', '#2a2433', 0.4] : ['#87ceeb', '#2d4a2d', 0.4]} />
              </>
            )}

            {isParasite ? (
              <>
                <ParasiteCameraRig scale={parasiteScale} />
                <ParasiteViewer scale={parasiteScale} />
              </>
            ) : isGem ? (
              <CrystalViewer scale={gemScale} options={gemOptions} />
            ) : (
              <PlantViewer scale={scale} soilOverlay={soilOverlay} soilFlow={soilFlow} />
            )}

            <OrbitControls
              makeDefault
              target={
                isParasite
                  ? PARASITE_VIEW_TARGET[parasiteScale]
                  : isGem
                    ? GEM_VIEW_TARGET[gemScale]
                    : PLANT_VIEW_TARGET[scale]
              }
              minDistance={1.5}
              maxDistance={isParasite ? 45 : 30}
              maxPolarAngle={isParasite ? Math.PI : Math.PI * 0.85}
              enableDamping
              dampingFactor={0.08}
            />
            {!isParasite && (
              <Environment preset={isGem ? 'city' : 'forest'}>{isGem && classicRenderer && <GemLightformers />}</Environment>
            )}
            {import.meta.env.DEV && <Stats />}
          </Canvas>
          )}

          {isParasite && parasiteScale !== 'sandbox' && (
            <>
              <GameHud />
              <ObjectiveModal />
              {DEBUG_TUNING && (
                <Suspense fallback={null}>
                  <TuningPanel />
                </Suspense>
              )}
            </>
          )}
          {isParasite && <ParasiteViewportHint scale={parasiteScale} />}
          {isParasite && parasiteScale === 'sandbox' && <LyticTimeline />}
          {isParasite && parasiteScale === 'slice' && <SliceOverlay />}
          {!isParasite && !isGem && scale === 'cellular' && <TissueHud />}

          {/* Overlay HUD */}
          <div className="hud">
            {isParasite && parasiteScale === 'sandbox' ? (
              <LyticHud isPlaying={isPlaying} />
            ) : isParasite ? (
              <ParasiteHud scale={parasiteScale} isPlaying={isPlaying} />
            ) : (
              <>
                <div className="hud-item">
                  <span className="label">{isGem ? 'Gemstone' : 'Species'}</span>
                  <span className="value">{isGem ? GEMSTONE_PRESETS[gemstone].name : species}</span>
                </div>
                <div className="hud-item">
                  <span className="label">View</span>
                  <span className="value">{isGem ? gemScale : scale}</span>
                </div>
                {!isGem && (
                  <div className="hud-item">
                    <span className="label">Soil</span>
                    <span className="value">{SOIL_PROFILES[soilProfile].name}</span>
                  </div>
                )}
                <div className="hud-item">
                  <span className="label">Sim</span>
                  <span className={`value ${isPlaying ? 'playing' : ''}`}>
                    {!isPlaying ? 'PAUSED' : isGem ? STATUS_HUD[crystalStatus] : 'RUNNING'}
                  </span>
                </div>
              </>
            )}
          </div>
        </div>

        {/* Side panels */}
        <aside className="sidebar">
          <SimControls />
          {isParasite && parasiteScale === 'sandbox' ? (
            <LyticPanel />
          ) : isParasite ? (
            <>
              <ObjectivePanel />
              <HostPanel />
              {parasiteScale === 'slice' && <SlicePanel />}
              <ParasiteInfoPanel scale={parasiteScale} />
            </>
          ) : isGem ? (
            <>
              <GeologyPanel />
              <GemInfoPanel scale={gemScale} options={gemOptions} onOptions={setGemOptions} />
              <RendererPanel />
            </>
          ) : (
            <>
              <WeatherPanel />
              <RendererPanel />
              {scale === 'cellular' && <TissuePanel />}
              {scale === 'roots' && <SoilPanel overlay={soilOverlay} onOverlay={setSoilOverlay} flow={soilFlow} onFlow={setSoilFlow} />}
            </>
          )}
        </aside>
      </div>

      <footer className="footer">
        <span>ford442 / plant-growth-sim</span>
        <span>{MODE_FOOTER[mode]}</span>
      </footer>
    </div>
  )
}

/**
 * Parasite HUD. Selectors return coarse, rounded values so the overlay only
 * re-renders when a figure actually changes rather than on every tick.
 */
function ParasiteHud({ scale, isPlaying }: { scale: ParasiteViewScale; isPlaying: boolean }) {
  const compartment = useParasiteStore((s) => s.world.compartment)
  const lesionHours = useParasiteStore((s) => Math.floor(s.world.lesionHours))
  const status = useParasiteStore((s) => s.progress.status)
  const free = useParasiteStore((s) => s.world.tally.extracellular + s.world.tally.overflow)
  const inside = useParasiteStore((s) => s.world.tally.intracellular)
  const cysts = useParasiteStore((s) => s.world.tally.cysts)

  const days = lesionHours / 24
  return (
    <>
      <div className="hud-item">
        <span className="label">Compartment</span>
        <span className="value">{COMPARTMENT_LABEL[compartment]}</span>
      </div>
      <div className="hud-item">
        <span className="label">View</span>
        <span className="value">{scale}</span>
      </div>
      <div className="hud-item">
        <span className="label">Lesion clock</span>
        <span className="value">{days < 2 ? `${lesionHours} h` : `${days.toFixed(1)} d`}</span>
      </div>
      <div className="hud-item">
        <span className="label">Population</span>
        <span className="value">
          {free} free · {inside} in PV · {cysts} cysts
        </span>
      </div>
      <div className="hud-item">
        <span className="label">Sim</span>
        <span className={`value ${isPlaying && status === 'active' ? 'playing' : ''}`}>
          {status === 'won' ? 'OBJECTIVE MET' : status === 'lost' ? 'RUN OVER' : isPlaying ? 'RUNNING' : 'PAUSED'}
        </span>
      </div>
    </>
  )
}

/** HUD for the lytic sandbox: only values that change rarely, so it re-renders rarely. */
function LyticHud({ isPlaying }: { isPlaying: boolean }) {
  const phase = useLyticStore((s) => s.lytic.phase)
  const seed = useLyticStore((s) => s.seed)
  const parasites = useLyticStore((s) => s.lytic.pv?.parasites ?? 1)
  const settled = useLyticStore((s) => lyticSettled(s.lytic))
  return (
    <>
      <div className="hud-item">
        <span className="label">View</span>
        <span className="value">lytic sandbox</span>
      </div>
      <div className="hud-item">
        <span className="label">Phase</span>
        <span className="value">{LYTIC_PHASE_DEFS[phase].name}</span>
      </div>
      <div className="hud-item">
        <span className="label">Tachyzoites</span>
        <span className="value">{parasites}</span>
      </div>
      <div className="hud-item">
        <span className="label">Seed</span>
        <span className="value">{seed}</span>
      </div>
      <div className="hud-item">
        <span className="label">Sim</span>
        <span className={`value ${isPlaying && !settled ? 'playing' : ''}`}>
          {settled ? 'LOOP DONE' : isPlaying ? 'RUNNING' : 'PAUSED'}
        </span>
      </div>
    </>
  )
}

export default App
