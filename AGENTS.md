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
- `src/stores/simStore.ts` — single source of truth for time, weather, plant status
- `src/simulation/LSystem.ts` — rules + turtle interpreter per species
- `src/components/PlantViewer.tsx` — R3F scene that switches on `ViewScale`
- `src/components/WeatherPanel.tsx` + `SimControls.tsx` — UI

## Conventions
- Prefer TSL node materials when adding fancy leaf/stem shaders
- Keep simulation pure (no Three.js objects inside store)
- Species presets live in `SPECIES_LSYSTEMS` — easy to add more
- Dark botanical UI (greens on near-black)
- Diátaxis docs later under `/docs`

## Current Status (Phase 0)
- Scaffold complete
- Working L-system that iterates with plant age
- Weather affects growth rate + water status
- 4 view modes (macro / architecture / cellular stub / roots stub)
- 6 species presets

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

## Notes for Agents
- Do not break the Zustand tick loop
- When adding species, update both `SpeciesId` type and `SPECIES_LSYSTEMS`
- Prefer small, focused PRs
- Keep performance in mind (instancing, frustum culling later)
