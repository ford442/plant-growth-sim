# AGENTS.md — Plant Growth Simulator

Guidance for AI agents and human collaborators working on this repo.

## Project Goal
Interactive multi-scale browser simulation of plant growth (flowers + trees):
- Visual L-system / procedural architecture that grows over time
- Cellular / tissue views
- Root system + water uptake
- Weather (temp, light, humidity, rain, wind) driving growth rates and stress

## Tech Stack
- Vite 6 + React 19 + TypeScript
- React Three Fiber + Three.js (WebGPU preferred later)
- Zustand for sim state
- L-systems + simple FSPM-style biomass model

## Key Files
- `src/stores/simStore.ts` — single source of truth for time, weather, plant status, gem state (`mode`, `gemstone`, `geology`, `crystal`)
- `src/stores/modeStore.ts` — `mode: 'plant' | 'gem' | 'parasite'`; `src/stores/timeStore.ts` — shared play/pause + speed (one clock for all modes)
- `src/rendering/` — renderer bootstrap (`rendererFactory`: WebGL for GLSL modes, WebGPU→WebGL2 fallback on request), capability probe, GPU-loss handling, `RendererLifecycle` (disposes renderer/device on Canvas unmount)
- `src/components/SimClock.tsx` — the one `useFrame` that calls `tick(dt)`; plant and gem sims share this clock
- `src/simulation/LSystem.ts` — rules + turtle interpreter per species
- `src/components/PlantViewer.tsx` — R3F scene that switches on `ViewScale`
- `src/components/WeatherPanel.tsx` + `SimControls.tsx` — UI

### Gem mode (epic #1)
- `src/simulation/GemstonePresets.ts` — `GemstoneId` + `GEMSTONE_PRESETS` (face families, growth rules, stability field, kinetics, optics, colour)
- `src/simulation/CrystalHabit.ts` — Miller indices → face poles under point-group symmetry; kinetic Wulff polyhedron (half-space clipping), volume/areas/extents
- `src/simulation/CrystalGrowth.ts` — `CrystalState` + pure `stepCrystal()` (Arrhenius × BCF growth law, nucleation, size cap, growth zones)
- `src/simulation/CrystalLattice.ts` — real unit cells from space-group generators, slab + bonds, growth-front arrival times, frozen-in defects
- `src/components/CrystalViewer.tsx` (formation / crystal views) + `LatticeView.tsx` (atomic lattice)
- `src/components/GeologyPanel.tsx` + `PhaseDiagram.tsx` + `GemInfoPanel.tsx` — gem UI

## Conventions
- Prefer TSL node materials when adding fancy leaf/stem shaders
- Keep simulation pure (no Three.js objects inside store)
- Species presets live in `SPECIES_LSYSTEMS` — easy to add more
- Gemstone presets live in `GEMSTONE_PRESETS` (`Record<GemstoneId, …>`, so TypeScript flags a missing entry)
- Views derive geometry from pure state each frame (`useSimStore.getState()` in `useFrame`) instead of subscribing to per-tick values
- Dark botanical UI (greens on near-black)
- Diátaxis docs later under `/docs`

## Current Status (Phase 0)
- Scaffold complete
- Working L-system that iterates with plant age
- Weather affects growth rate + water status
- 4 view modes (macro / architecture / cellular stub / roots stub)
- 6 species presets
- Gem mode: 6 gemstones (quartz, amethyst, diamond, ruby, emerald, topaz), formation / crystal / lattice views, T–P–saturation–dopant controls

## Next High-Value Tasks
1. Replace lineSegments with proper tube / instanced cylinder branches
2. Better leaf meshes (or simple instanced planes with better orientation)
3. Smooth growth interpolation (lerp between L-system generations)
4. Real cellular cross-section with animated division
5. Soil moisture field + animated water particles into roots
6. WebGPU / TSL upgrade path
7. Export current plant as GLB

## Running Locally
```bash
npm install
npm run dev
```

### Gem follow-ups
- TSL optical materials (IOR/dispersion/colour vs T) once the WebGPU path lands (#15, #19) — currently `MeshPhysicalMaterial`
- Mineral–root co-evolution: soil mineral field, geodes near roots (#12 Phase 4, helps from #10)

## Notes for Agents
- Do not break the Zustand tick loop
- When adding species, update both `SpeciesId` type and `SPECIES_LSYSTEMS`
- When adding a gemstone, extend `GemstoneId` and `GEMSTONE_PRESETS`; add a structure to `STRUCTURES` in `CrystalLattice.ts` if it needs a new lattice, and check atom counts / bond lengths against literature
- Growth rates are tuned to lab-synthesis scale (~0.1–1 mm/day) so they are watchable; stability fields are simplified curves
- Prefer small, focused PRs
- Keep performance in mind (instancing, frustum culling later)
