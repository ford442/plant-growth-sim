import { useState } from 'react'
import { Canvas } from '@react-three/fiber'
import { OrbitControls, Environment, Stats } from '@react-three/drei'
import { PlantViewer } from './components/PlantViewer'
import { WeatherPanel } from './components/WeatherPanel'
import { SpeciesSelector } from './components/SpeciesSelector'
import { ScaleTabs } from './components/ScaleTabs'
import { SimControls } from './components/SimControls'
import { useSimStore } from './stores/simStore'
import './App.css'

export type ViewScale = 'macro' | 'architecture' | 'cellular' | 'roots'

function App() {
  const [scale, setScale] = useState<ViewScale>('architecture')
  const species = useSimStore((s) => s.species)
  const isPlaying = useSimStore((s) => s.isPlaying)

  return (
    <div className="app">
      {/* Top bar */}
      <header className="header">
        <div className="logo">
          <span className="logo-icon">🌿</span>
          <div>
            <h1>Plant Growth Simulator</h1>
            <p className="subtitle">Multi-scale botanical simulation</p>
          </div>
        </div>
        <SpeciesSelector />
        <ScaleTabs scale={scale} onChange={setScale} />
      </header>

      <div className="main">
        {/* 3D Viewport */}
        <div className="viewport">
          <Canvas
            camera={{ position: [0, 4, 8], fov: 45 }}
            dpr={[1, 2]}
            gl={{ antialias: true, alpha: false }}
          >
            <color attach="background" args={['#0a0f0a']} />
            <fog attach="fog" args={['#0a0f0a', 12, 35]} />
            <ambientLight intensity={0.35} />
            <directionalLight
              position={[8, 12, 5]}
              intensity={1.2}
              castShadow
              shadow-mapSize={[1024, 1024]}
            />
            <hemisphereLight args={['#87ceeb', '#2d4a2d', 0.4]} />

            <PlantViewer scale={scale} />

            <OrbitControls
              makeDefault
              minDistance={1.5}
              maxDistance={30}
              maxPolarAngle={Math.PI * 0.85}
              enableDamping
              dampingFactor={0.08}
            />
            <Environment preset="forest" />
            {import.meta.env.DEV && <Stats />}
          </Canvas>

          {/* Overlay HUD */}
          <div className="hud">
            <div className="hud-item">
              <span className="label">Species</span>
              <span className="value">{species}</span>
            </div>
            <div className="hud-item">
              <span className="label">View</span>
              <span className="value">{scale}</span>
            </div>
            <div className="hud-item">
              <span className="label">Sim</span>
              <span className={`value ${isPlaying ? 'playing' : ''}`}>
                {isPlaying ? 'RUNNING' : 'PAUSED'}
              </span>
            </div>
          </div>
        </div>

        {/* Side panels */}
        <aside className="sidebar">
          <SimControls />
          <WeatherPanel />
        </aside>
      </div>

      <footer className="footer">
        <span>ford442 / plant-growth-sim</span>
        <span>L-systems · FSPM · Water uptake · Weather</span>
      </footer>
    </div>
  )
}

export default App
