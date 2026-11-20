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
- `src/components/plantExport.ts` — GLB export of the on-screen plant scene (`registerPlantRoot` from PlantViewer; button in SimControls). v0: static snapshot, no animation tracks, branches as LINES until tube branches land, leaves via EXT_mesh_gpu_instancing, plain PBR colours
- `src/components/SimClock.tsx` — the one `useFrame` that calls `tick(dt)`; plant and gem sims share this clock
- `src/simulation/LSystem.ts` — rules + turtle interpreter per species (deterministic: leaf sizes come from `hash01`, never `Math.random`; segments/leaves carry the `src` symbol index that produced them)
- `src/simulation/LSystemMorph.ts` — pure smooth growth between L-system iterations: lineage through the rewrite, `createMorphBuilder().morph(n)` → `from`/`to` typed arrays, `sampleSegments` / `sampleLeaves` at any `t`, plus `advanceDevelopment` (the weather-driven development clock) and `morphFactor`
- `src/components/plant/` — viewer side of the morph: `MorphedPlant.ts` (dynamic branch geometry + leaf instance buffer, re-posed in place, one shared instance per species+stage via `getMorphedPlant`) and `leafMatrix.ts` (hand-expanded `lookAt` + `rotateX(π/2)`, pinned to three.js by a test)
- `src/components/PlantViewer.tsx` — R3F scene that switches on `ViewScale`
- `src/components/WeatherPanel.tsx` + `SimControls.tsx` — UI

### Cellular view (plant, issue #13)
- `src/simulation/TissueGrowth.ts` — pure model: `TissueState` = radial files of cells (pith → xylem → cambium → phloem), a per-season ring record, `stepTissue()` (cambial cell cycle with a G2/M checkpoint, periclinal division, turgor-gated enlargement, wall maturation), `cambialResponse()` (weather → division / enlargement), `SPECIES_TISSUE`, and read-only helpers `layoutFile` / `ringProfile` / `stemMetrics`. `simStore.tick` steps it on the shared clock; `reset()` recreates it
- `src/components/CellularView.tsx` — composes the scene and frames the camera; `cellular/CellLens.tsx` (instanced cells, mitosis visuals, labels), `cellular/StemDisc.tsx` + `paintDisc.ts` (canvas-textured whole-stem disc), `cellular/geometry.ts` (layout constants), `cellular/palette.ts` (colours shared with the sidebar legend), `cellular/instances.ts` (typed-array instance writer)
- `src/components/TissuePanel.tsx` — `TissueHud` (status strip over the viewport) and `TissuePanel` (sidebar reference); both sample the store at ~5 Hz instead of re-rendering per tick

### Parasite mode (epic #3)
- `src/simulation/parasite/stages.ts` — `LifeStage` + `STAGE_DEFS` (dimensions, speeds) and the **two-gear clock** (`advanceClocks`: action seconds for biomechanics, lesion hours for development)
- `src/simulation/parasite/bfdSwitch.ts` — BFD1/BFD2 positive-feedback latency latch and the reactivation rule
- `src/simulation/parasite/glideosome.ts` — periodic inward-traction kinematics on a true helix (not forward thrust)
- `src/simulation/parasite/invasion.ts` — moving-junction FSM (MIC → orient → RON → AMA1–RON2 ring → PV)
- `src/simulation/parasite/egress.ts` — FNT acidification → Ca²⁺ → TgPLP1 pores
- `src/simulation/parasite/hostImmunity.ts` — IL-12/IFN-γ/IRG/NO/ROS fields, ROP effectors, tissue niches
- `src/simulation/parasite/lifeCycleGraph.ts` — declarative stage transitions (research §12.1)
- `src/simulation/parasite/world.ts` — the one pure `stepWorld()` over agents, cells, vacuoles, cysts and oocysts
- `src/simulation/parasite/objectives.ts` + `modifiers.ts` — objective registry, ΔBFD1/Δplp1/ΔMIC2/terminal-latency modifiers, comparative Sarcocystidae
- `src/stores/parasiteStore.ts` — sibling of `simStore`; holds state, forwards the clock, evaluates the objective
- `src/components/ParasiteViewer.tsx` + `parasite/OrganelleView.tsx` + `ParasitePanels.tsx` — four view scales and the UI
- Design lock: `docs/design/parasite-mode.md`

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
- 4 view modes (macro / architecture / cellular / roots stub); cellular is a real stem cross-section with animated mitosis, expansion and growth rings
- 6 species presets
- Gem mode: 6 gemstones (quartz, amethyst, diamond, ruby, emerald, topaz), formation / crystal / lattice views, T–P–saturation–dopant controls
- Parasite mode: *T. gondii* life-cycle sim-game — full lytic loop (invade → PV → endodyogeny → egress), BFD1 latency and reactivation, felid sexual cycle, environmental oocysts, 5 objectives, 4 challenge modifiers, 4 comparative species, 4 view scales. 51 unit tests (`npm test`)

## Next High-Value Tasks
1. Replace lineSegments with proper tube / instanced cylinder branches
2. Better leaf meshes (or simple instanced planes with better orientation)
3. ~~Smooth growth interpolation (lerp between L-system generations)~~ (done: `LSystemMorph.ts`; the sim exposes a continuous `lsystemProgress`, the view blends generation `floor(progress)` into the next by its fractional part)
4. ~~Real cellular cross-section with animated division~~ (done, #13: `TissueGrowth.ts` + cellular view; next: stomata / leaf tissue, anticlinal divisions to widen the cambium)
5. Soil moisture field + animated water particles into roots
6. WebGPU / TSL upgrade path
7. ~~Export current plant as GLB~~ (v0 done; revisit after tube branches)

## Running Locally
```bash
npm install
npm run dev
```

Tests (pure simulation only, no DOM):
```bash
npm test
```

### Gem follow-ups
- TSL optical materials (IOR/dispersion/colour vs T) once the WebGPU path lands (#15, #19) — currently `MeshPhysicalMaterial`
- Mineral–root co-evolution: soil mineral field, geodes near roots (#12 Phase 4, helps from #10)

## Notes for Agents
- Do not break the Zustand tick loop
- Architecture development is `simStore.lsystemProgress` (continuous; `lsystemIterations` is its integer part). It advances by `days × rate / DAYS_PER_ITERATION`, where `rate` is the same weather-driven factor that scales biomass and height, so branching slows, stalls and pauses with growth. Do not drive it from `age` again — that desyncs architecture from the weather
- The L-system morph is pure and unit-tested (`LSystemMorph.test.ts`, `leafMatrix.test.ts`, `simStore.test.ts`) — run `npm test` after touching `LSystem.ts` or the morph. Interpolation lives in the viewer layer (`useFrame` samples the morph from `useSimStore.getState().lsystemProgress`); the sim never sees the interpolation factor
- Morph assumptions: every drawing symbol (`F`/`G`) rewrites to at least one drawing symbol (otherwise the removed segment pops out at the start of the morph). Depth-0 draws in a replacement are the trunk and tile their parent; draws inside brackets are side branches that peel off it; draws from a bud (`X`, `A`) grow collapsed out of the bud
- Known issue (pre-existing, not fixed by the morph): the turtle starts with pitch π/2, where yaw (`+`/`-`) has no sideways effect, and every shipped species only uses `+`/`-`, so all presets currently grow as a straight vertical line. The morph tests also run on rule sets that tilt with `&`/`^` so they exercise real 3D branching
- The parasite sim is pure and unit-tested — run `npm test` after touching `src/simulation/parasite/`
- Parasite time is two gears (action seconds vs lesion hours); never collapse them into one clock without reading `docs/design/parasite-mode.md` §3
- When adding a parasite stage, extend `LifeStage` + `STAGE_DEFS` and add its transitions to `LIFE_CYCLE`
- When adding species, update `SpeciesId`, `SPECIES_LSYSTEMS` and `SPECIES_TISSUE` (typed on `SpeciesId`, so a missing entry is a compile error)
- The tissue sim is pure and unit-tested (`TissueGrowth.test.ts`, including a deep-frozen-state purity test) — run `npm test` after touching it; keep new tissue behaviour in `stepTissue` and keep drawing code out of the simulation
- When adding a gemstone, extend `GemstoneId` and `GEMSTONE_PRESETS`; add a structure to `STRUCTURES` in `CrystalLattice.ts` if it needs a new lattice, and check atom counts / bond lengths against literature
- Growth rates are tuned to lab-synthesis scale (~0.1–1 mm/day) so they are watchable; stability fields are simplified curves
- Prefer small, focused PRs
- Keep performance in mind (instancing, frustum culling later)
