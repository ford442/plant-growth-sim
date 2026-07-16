# Plant Growth Simulator

**Interactive multi-scale simulation of flower and tree growth**  
Visualize realistic growth patterns, cellular processes, root water uptake, and environmental interactions (weather, temperature, light, humidity).

Live demo will be at: `https://ford442.github.io/plant-growth-sim` (or custom domain later)

## Vision

A beautiful, educational, and scientifically grounded web app that lets you:

- Watch plants grow over time using real botanical growth models
- Zoom from **whole plant / forest scale** → **branch architecture** → **cellular tissue** → **root system in soil**
- See **water flowing** from soil → roots → xylem → leaves (animated)
- Control weather and watch the plant respond (drought stress, optimal growth, cold dormancy, etc.)
- Switch between species with different growth habits (trees, flowers, vines, grasses)
- Export models / growth data

### Core Tech Stack (planned)
- **Vite + React 19 + TypeScript**
- **React Three Fiber + Three.js + WebGPU** (preferred for performance & modern shaders)
- **TSL (Three Shading Language)** for music-reactive / weather-reactive plant shaders
- L-systems + parametric / functional-structural plant models (FSPM)
- Simple soil moisture + root architecture model
- Weather engine (temperature, RH, PAR, precipitation, wind)

### Multi-scale Views
1. **Macro** – full plant or small garden with weather effects
2. **Architecture** – L-system / space-colonization branching with growth animation
3. **Tissue / Cellular** – cross-sections showing cambium, xylem/phloem, cell division, stomata
4. **Root Zone** – 3D soil volume, root hairs, water potential gradients, nutrient uptake

### Plant Species (initial targets)
| Species | Type | Growth model focus |
|---------|------|--------------------|
| Sunflower | Flower | Phototropism, rapid stem elongation, large leaves |
| Oak / Maple | Tree | Strong apical dominance, secondary thickening |
| Rose | Shrub/Flower | Branching, flowering cycles |
| Fern / Barnsley | Frond | Classic L-system fractal |
| Grass / Bamboo | Monocot | Tillering, rapid vertical growth |
| Vine (e.g. Ivy) | Climber | Thigmotropism, search for support |

## Project Structure (target)

```
plant-growth-sim/
├── public/
├── src/
│   ├── components/
│   │   ├── PlantViewer.tsx       # Main R3F canvas
│   │   ├── WeatherControls.tsx
│   │   ├── SpeciesSelector.tsx
│   │   ├── ScaleNavigator.tsx    # Macro / Tissue / Root tabs
│   │   ├── CellularView.tsx
│   │   ├── RootSystem.tsx
│   │   └── UI/
│   ├── simulation/
│   │   ├── LSystem.ts
│   │   ├── GrowthEngine.ts      # time-stepped biomass + architecture
│   │   ├── WaterUptake.ts
│   │   ├── Weather.ts
│   │   └── species/
│   ├── shaders/                 # TSL node materials
│   ├── hooks/
│   ├── stores/                  # Zustand for sim state
│   ├── App.tsx
│   └── main.tsx
├── docs/                       # Diátaxis style
├── AGENTS.md
├── package.json
└── ...
```

## Getting Started (once scaffolded)

```bash
npm install
npm run dev
```

## Roadmap (high level)

### Phase 0 – Scaffold (now)
- [x] Repo + README
- [ ] Vite + React + TS + R3F + WebGPU setup
- [ ] Basic L-system tree + flower that grows over time
- [ ] Weather panel (temp, light, water)

### Phase 1 – Core Simulation
- [ ] Functional-structural growth (biomass allocation)
- [ ] Root architecture + water potential model
- [ ] Animated water flow in vasculature
- [ ] Species presets with different L-rules + parameters

### Phase 2 – Multi-scale
- [ ] Seamless zoom / scale switcher
- [ ] Cellular cross-section with mitosis / expansion animation
- [ ] Soil moisture visualization + root hair detail

### Phase 3 – Polish & Export
- [ ] Beautiful TSL shaders (translucency, chlorophyll, rain droplets, etc.)
- [ ] Time-lapse recording / export GLB of current plant
- [ ] Educational tooltips + glossary
- [ ] Mobile / touch friendly controls

## Scientific Inspiration
- L-systems (Lindenmayer)
- Functional-Structural Plant Models (GreenLab, LIGNUM, etc.)
- Root water uptake (hydraulic architecture, soil–plant–atmosphere continuum)
- Space colonization algorithms for branching
- Existing tools: EZ-Tree, FloraSynth, SimRoot concepts

## License
MIT

---

**Next steps:** Scaffold full Vite project, working L-system demo that grows with time and weather influence, multi-view UI. Preferences? (specific first species, pure WebGPU, dark mode, etc.)
