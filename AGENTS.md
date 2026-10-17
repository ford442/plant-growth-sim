# AGENTS.md — Plant Growth Simulator

Guidance for AI agents and human collaborators working on this repo.

## Project Goal
Interactive multi-scale browser simulation of plant growth (flowers + trees):
- Visual L-system / procedural architecture that grows over time
- Cellular / tissue views
- Root system + water uptake
- Weather (temp, light, humidity, rain, wind) driving growth rates and stress

## Tech Stack
- Vite 6 + React 19 + TypeScript 5.7
- React Three Fiber 9 + drei + Three.js 0.175 (WebGPU preferred later)
- Zustand for sim state
- L-systems + simple FSPM-style biomass model

## Key Files
- `src/stores/simStore.ts` — single source of truth for time, weather, plant status
- `src/simulation/LSystem.ts` — rules + turtle interpreter per species
- `src/App.tsx` — layout; defines `ViewScale` (`macro | architecture | cellular | roots`)
- `src/components/PlantViewer.tsx` — R3F scene that switches on `ViewScale`; drives `tick(dt)` from `useFrame`
- `src/components/WeatherPanel.tsx`, `SimControls.tsx`, `SpeciesSelector.tsx`, `ScaleTabs.tsx` — UI
- `weekly_plan.md` — living task board (plant core + planned gem and *T. gondii* parasite modes); research in `docs/research/`

## Conventions
- Prefer TSL node materials when adding fancy leaf/stem shaders
- Keep simulation pure (no Three.js objects inside store)
- Species presets live in `SPECIES_LSYSTEMS` — easy to add more
- Dark botanical UI (greens on near-black)
- Diátaxis docs later under `/docs` (currently only `docs/research/`)

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
npm run dev       # Vite dev server
npm run build     # tsc -b && vite build
npm run preview
```
`npm run lint` (`eslint .`) currently has no `eslint.config.js`, so it will fail until one is added.

## Notes for Agents
- Do not break the Zustand tick loop
- When adding species, update the `SpeciesId` type, `SPECIES_LSYSTEMS`, and the `SPECIES` list in `SpeciesSelector.tsx`
- Prefer small, focused PRs
- Keep performance in mind (instancing, frustum culling later)
