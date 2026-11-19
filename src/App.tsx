import { useState } from 'react'
import { Canvas } from '@react-three/fiber'
import { OrbitControls, Environment, Stats } from '@react-three/drei'
import { PlantViewer } from './components/PlantViewer'
import { CrystalViewer, GemLightformers, GEM_VIEW_TARGET, type GemViewOptions, type GemViewScale } from './components/CrystalViewer'
import { WeatherPanel } from './components/WeatherPanel'
import { GeologyPanel } from './components/GeologyPanel'
import { GemInfoPanel } from './components/GemInfoPanel'
import { SpeciesSelector } from './components/SpeciesSelector'
import { GemstoneSelector } from './components/GemstoneSelector'
import { GEM_TABS, PLANT_TABS, ScaleTabs } from './components/ScaleTabs'
import { ModeSwitch } from './components/ModeSwitch'
import { SimControls } from './components/SimControls'
import { SimClock } from './components/SimClock'
import { useSimStore } from './stores/simStore'
import { GEMSTONE_PRESETS } from './simulation/GemstonePresets'
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

function App() {
  const [scale, setScale] = useState<ViewScale>('architecture')
  const [gemScale, setGemScale] = useState<GemViewScale>('crystal')
  const [gemOptions, setGemOptions] = useState<GemViewOptions>({ faceIndexing: false, phantoms: true })
  const mode = useSimStore((s) => s.mode)
  const species = useSimStore((s) => s.species)
  const gemstone = useSimStore((s) => s.gemstone)
  const crystalStatus = useSimStore((s) => s.crystal.status)
  const isPlaying = useSimStore((s) => s.isPlaying)
  const isGem = mode === 'gem'
  const bg = isGem ? '#08070d' : '#0a0f0a'

  return (
    <div className={`app ${isGem ? 'mode-gem' : 'mode-plant'}`}>
      {/* Top bar */}
      <header className="header">
        <div className="logo">
          <span className="logo-icon">{isGem ? '💎' : '🌿'}</span>
          <div>
            <h1>{isGem ? 'Gemstone Growth Simulator' : 'Plant Growth Simulator'}</h1>
            <p className="subtitle">{isGem ? 'Multi-scale crystal growth' : 'Multi-scale botanical simulation'}</p>
          </div>
        </div>
        <ModeSwitch />
        {isGem ? <GemstoneSelector /> : <SpeciesSelector />}
        {isGem ? (
          <ScaleTabs tabs={GEM_TABS} scale={gemScale} onChange={setGemScale} />
        ) : (
          <ScaleTabs tabs={PLANT_TABS} scale={scale} onChange={setScale} />
        )}
      </header>

      <div className="main">
        {/* 3D Viewport */}
        <div className="viewport">
          <Canvas
            camera={{ position: [0, 4, 8], fov: 45 }}
            dpr={[1, 2]}
            gl={{ antialias: true, alpha: false }}
          >
            <color attach="background" args={[bg]} />
            <fog attach="fog" args={[bg, 12, 35]} />
            <ambientLight intensity={0.35} />
            <directionalLight
              position={[8, 12, 5]}
              intensity={1.2}
              castShadow
              shadow-mapSize={[1024, 1024]}
            />
            <hemisphereLight args={isGem ? ['#b8c8ff', '#2a2433', 0.4] : ['#87ceeb', '#2d4a2d', 0.4]} />

            {/* one clock for every mode — keeps the Zustand tick loop intact */}
            <SimClock />
            {isGem ? <CrystalViewer scale={gemScale} options={gemOptions} /> : <PlantViewer scale={scale} />}

            <OrbitControls
              makeDefault
              target={isGem ? GEM_VIEW_TARGET[gemScale] : [0, 0, 0]}
              minDistance={1.5}
              maxDistance={30}
              maxPolarAngle={Math.PI * 0.85}
              enableDamping
              dampingFactor={0.08}
            />
            <Environment preset={isGem ? 'city' : 'forest'}>{isGem && <GemLightformers />}</Environment>
            {import.meta.env.DEV && <Stats />}
          </Canvas>

          {/* Overlay HUD */}
          <div className="hud">
            <div className="hud-item">
              <span className="label">{isGem ? 'Gemstone' : 'Species'}</span>
              <span className="value">{isGem ? GEMSTONE_PRESETS[gemstone].name : species}</span>
            </div>
            <div className="hud-item">
              <span className="label">View</span>
              <span className="value">{isGem ? gemScale : scale}</span>
            </div>
            <div className="hud-item">
              <span className="label">Sim</span>
              <span className={`value ${isPlaying ? 'playing' : ''}`}>
                {!isPlaying ? 'PAUSED' : isGem ? STATUS_HUD[crystalStatus] : 'RUNNING'}
              </span>
            </div>
          </div>
        </div>

        {/* Side panels */}
        <aside className="sidebar">
          <SimControls />
          {isGem ? (
            <>
              <GeologyPanel />
              <GemInfoPanel scale={gemScale} options={gemOptions} onOptions={setGemOptions} />
            </>
          ) : (
            <WeatherPanel />
          )}
        </aside>
      </div>

      <footer className="footer">
        <span>ford442 / plant-growth-sim</span>
        <span>
          {isGem
            ? 'Kinetic Wulff habits · BCF growth · Nucleation · Real lattices'
            : 'L-systems · FSPM · Water uptake · Weather'}
        </span>
      </footer>
    </div>
  )
}

export default App
