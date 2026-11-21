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
- `src/rendering/` — renderer bootstrap (`rendererFactory`: classic WebGL by default; `webgpu` = `WebGPURenderer`, on its WebGL2 backend without an adapter, and a plain `WebGLRenderer` if that fails), capability probe, `rendererPreference.ts` (`?renderer=webgpu`; `NODE_READY_MODES` = which modes may use it), `describeRenderer()` (what is *actually* running), GPU-loss handling, `RendererLifecycle` (reports the active renderer + GPU-loss handlers; it must **not** dispose the renderer — R3F does, and doing it twice blanks the canvas under StrictMode). `src/stores/rendererStore.ts` + `components/RendererPanel.tsx` are the UI side. Design + upgrade path: `docs/design/webgpu-tsl.md`
- `src/components/plantExport.ts` — GLB export of the on-screen plant scene (`registerPlantRoot` from PlantViewer; button in SimControls). v0: static snapshot, no animation tracks, branches as LINES until tube branches land, leaves via EXT_mesh_gpu_instancing, plain PBR colours
- `src/components/SimClock.tsx` — the one `useFrame` that calls `tick(dt)`; plant and gem sims share this clock
- `src/simulation/LSystem.ts` — rules + turtle interpreter per species (deterministic: leaf sizes come from `hash01`, never `Math.random`; segments/leaves carry the `src` symbol index that produced them). The turtle is a right-handed **frame** (heading / left / up), not yaw+pitch angles, and each `[` rolls it by `branchRoll` (default 137.5°) so shoots fan out in 3D. `LeafSpec` (`shape`, `aspect`, `size`, `spread`, `fold`, `curl`; `leafSpec(def)` fills defaults) is each species' leaf: `size`/`spread` are applied by the turtle (leaf = a shoot's tip, opened `spread`° from the twig toward the turtle's up), the rest shape the blade mesh
- `src/simulation/LSystemMorph.ts` — pure smooth growth between L-system iterations: lineage through the rewrite, `createMorphBuilder().morph(n)` → `from`/`to` typed arrays, `sampleSegments` / `sampleLeaves` at any `t`, plus `advanceDevelopment` (the weather-driven development clock) and `morphFactor`
- `src/components/plant/` — viewer side of the morph: `MorphedPlant.ts` (branch + leaf instance-matrix buffers, re-posed in place, one shared instance per species+stage via `getMorphedPlant`), `leafMatrix.ts` (hand-expanded instance matrix: long axis along the leaf heading, upper face rolled toward the light — `SUN_DIRECTION`, the scene's key light — pinned by `leafMatrix.test.ts`), `leafGeometry.ts` (the shared blade: width-profile strip with midrib fold + drooping tip, UVs u-across/v-along for the TSL material; `leafRows(count)` simplifies it for dense foliage under `LEAF_TRIANGLE_BUDGET`) and `branchMatrix.ts` (branches as **instanced cylinders**: segment start/end/thickness → instance matrix, plus `branchDetail`, the segment budget)
- `src/components/plant/leafAppearance.ts` (pure, tested: weather + plant status → chlorophyll / wetness / translucency / flutter), `useLeafNodeMaterial.ts` (loads and feeds the TSL leaf material; `null` on classic WebGL → `PlantViewer` draws `meshStandardMaterial`) and `tsl/leafNodeMaterial.ts` (the TSL `MeshSSSNodeMaterial`; **only ever loaded through dynamic `import()`**)
- `src/components/PlantViewer.tsx` — R3F scene that switches on `ViewScale`
- `src/components/WeatherPanel.tsx` + `SimControls.tsx` — UI

### Cellular view (plant, issue #13)
- `src/simulation/TissueGrowth.ts` — pure model: `TissueState` = radial files of cells (pith → xylem → cambium → phloem), a per-season ring record, `stepTissue()` (cambial cell cycle with a G2/M checkpoint, periclinal division, turgor-gated enlargement, wall maturation), `cambialResponse()` (weather → division / enlargement), `SPECIES_TISSUE`, and read-only helpers `layoutFile` / `ringProfile` / `stemMetrics`. `simStore.tick` steps it on the shared clock; `reset()` recreates it
- `src/components/CellularView.tsx` — composes the scene and frames the camera; `cellular/CellLens.tsx` (instanced cells, mitosis visuals, labels), `cellular/StemDisc.tsx` + `paintDisc.ts` (canvas-textured whole-stem disc), `cellular/geometry.ts` (layout constants), `cellular/palette.ts` (colours shared with the sidebar legend), `cellular/instances.ts` (typed-array instance writer)
- `src/components/TissuePanel.tsx` — `TissueHud` (status strip over the viewport) and `TissuePanel` (sidebar reference); both sample the store at ~5 Hz instead of re-rendering per tick

### Roots view + soil mineral field (gem epic #1, issue #12 Phase 4)
- `src/simulation/SoilField.ts` — pure model: `SoilState` = a 24 × 16 vertical soil slice (water, dissolved silica / calcium carbonate, exchangeable Ca, silica / calcite cement, root density, per-column root front and reach, nodules), `stepSoil()` (infiltration, drainage + leaching, capillary flow, evaporation, root uptake, weathering, cementation, nodule nucleation / BCF growth, root front), `SOIL_PROFILES` (`SoilProfileId`: loam / volcanic / limestone), `SPECIES_ROOTS`, read-only helpers `soilMetrics` / `cellSaturation` / `largestGeode`. Reuses `growthLaw` + `rand` from `CrystalGrowth.ts`. `simStore.tick` steps it; its `supply` drives `waterStatus` and its `nutrient` drives `nutrientStatus`
- `src/components/soil/SoilView.tsx` (slice tiles, roots clipped to `soil.rootFront`, nodules, labels), `soil/rootSkeleton.ts` (deterministic drawn root architecture), `soil/palette.ts` (overlay ramps shared with the legend)
- `src/components/SoilPanel.tsx` — soil picker, overlays, meters; "Grow its quartz lining in Gem mode" switches to the amethyst geode

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
- 4 view modes (macro / architecture / cellular / roots); cellular is a real stem cross-section with animated mitosis, expansion and growth rings; roots is a soil slice with water, minerals, cement, nodules and the root system
- Soil mineral field (`SoilField.ts`, 3 soils) under the plant: rain reaches the plant only through it; minerals feed back via calcium nutrition and hardpans; geodes / rhizoliths form around roots
- 6 species presets
- Gem mode: 6 gemstones (quartz, amethyst, diamond, ruby, emerald, topaz), formation / crystal / lattice views, T–P–saturation–dopant controls
- Parasite mode: *T. gondii* life-cycle sim-game — full lytic loop (invade → PV → endodyogeny → egress), BFD1 latency and reactivation, felid sexual cycle, environmental oocysts, 5 objectives, 4 challenge modifiers, 4 comparative species, 4 view scales. 51 unit tests (`npm test`)

## Next High-Value Tasks
1. ~~Replace lineSegments with proper tube / instanced cylinder branches~~ (done: one instanced cylinder per L-system segment, `branchMatrix.ts`; next: taper along a branch / pipe-model thickening, TSL bark material)
2. ~~Better leaf meshes (or simple instanced planes with better orientation)~~ (done: per-species shaped blades, `leafGeometry.ts`; leaves open off the twig and turn their upper face toward the sun. Next: compound leaves / several leaves per node, light direction from a time-of-day sun, per-leaf colour variation that survives a generation step)
3. ~~Smooth growth interpolation (lerp between L-system generations)~~ (done: `LSystemMorph.ts`; the sim exposes a continuous `lsystemProgress`, the view blends generation `floor(progress)` into the next by its fractional part)
4. ~~Real cellular cross-section with animated division~~ (done, #13: `TissueGrowth.ts` + cellular view; next: stomata / leaf tissue, anticlinal divisions to widen the cambium)
5. ~~Soil moisture field~~ (done with the soil mineral field, `SoilField.ts`) + animated water particles into roots
6. ~~WebGPU / TSL upgrade path~~ (path documented and prototyped, #19: opt-in `?renderer=webgpu`, TSL leaf material; next: verify on a native WebGPU device, tune translucency/gloss, TSL stems once tube branches land, port gem/parasite modes — see `docs/design/webgpu-tsl.md` §8–9)
7. ~~Export current plant as GLB~~ (v0 done; branches now export as instanced cylinder meshes rather than LINES)

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
- ~~Mineral–root co-evolution~~ (done: `SoilField.ts` + Roots view). Next: share the substrate with the parasite oocyst field; carry a soil geode's own conditions into the gem crystal instead of the amethyst defaults

## Notes for Agents
- Do not break the Zustand tick loop
- Architecture development is `simStore.lsystemProgress` (continuous; `lsystemIterations` is its integer part). It advances by `days × rate / DAYS_PER_ITERATION`, where `rate` is the same weather-driven factor that scales biomass and height, so branching slows, stalls and pauses with growth. Do not drive it from `age` again — that desyncs architecture from the weather
- The L-system morph is pure and unit-tested (`LSystemMorph.test.ts`, `leafMatrix.test.ts`, `simStore.test.ts`) — run `npm test` after touching `LSystem.ts` or the morph. Interpolation lives in the viewer layer (`useFrame` samples the morph from `useSimStore.getState().lsystemProgress`); the sim never sees the interpolation factor
- Morph assumptions: every drawing symbol (`F`/`G`) rewrites to at least one drawing symbol (otherwise the removed segment pops out at the start of the morph). Depth-0 draws in a replacement are the trunk and tile their parent; draws inside brackets are side branches that peel off it; draws from a bud (`X`, `A`) grow collapsed out of the bud
- Branches are `InstancedMesh` cylinders, not tubes: a merged tube mesh would rewrite ≥ 72 floats per segment every frame and bamboo reaches 78 125 segments at the last iteration; an instance costs 16 floats against one shared unit cylinder (re-pose ≈ 0.7 ms for 24 k segments, less than the leaves). The morph carries per-segment `thicknessFrom/To` (`sampleThickness`): trunk links keep their parent's width, side branches and bud-grown twigs start at 0 and thicken as they extend. Radius = `thickness × RADIUS_PER_THICKNESS` (0.5, thickness is the stem width). Each cylinder overhangs its ends by `JOINT_OVERLAP` radii so bends do not open gaps. **Segment budget:** `branchDetail(segmentCount)` coarsens the shared cylinder (10 → 6 → 5 → 4 sides, caps dropped above 15 k) so the worst case stays under ~0.65 M triangles. `frustumCulled={false}` (bounds change every frame), so cost is per plant, not per visible segment; the macro view draws three plants. Real culling / LOD for very large trees (cluster bounds, or dropping the finest twigs far from the camera) is not done yet
- Turtle: it used to start at pitch π/2 where `+`/`-` did nothing, so every preset grew as a vertical line; it is now a frame (see Key Files), covered by `LSystem.test.ts`. `branchRoll: 0` keeps a plant planar. The morph tests also run on rule sets that tilt with `&`/`^`
- Known issue (pre-existing): plant size is not normalised. `F → FF` doubles the stem each iteration (oak ≈ 28 units tall at iteration 5, bamboo ≈ 1000 at 7), the view only scales by `height / 1.8`, and the camera is fixed, so plants outgrow the frame after iteration ~3. Fit the camera or the display scale to the morph's bounds before changing leaf sizes to compensate
- Leaves: one per closed shoot (`]`) plus the apex, so the morph lineage (`LSystemMorph.ts`) is unchanged; the blade is `leafGeometry.ts`, shared per shape + level of detail. Worst case is bamboo at iteration 7 (39 k leaves → 2-row blades, ~0.31 M triangles on top of the ~0.65 M of branches)
- The parasite sim is pure and unit-tested — run `npm test` after touching `src/simulation/parasite/`
- Parasite time is two gears (action seconds vs lesion hours); never collapse them into one clock without reading `docs/design/parasite-mode.md` §3
- When adding a parasite stage, extend `LifeStage` + `STAGE_DEFS` and add its transitions to `LIFE_CYCLE`
- When adding species, update `SpeciesId`, `SPECIES_LSYSTEMS`, `SPECIES_TISSUE` and `SPECIES_ROOTS` (typed on `SpeciesId`, so a missing entry is a compile error)
- The tissue sim is pure and unit-tested (`TissueGrowth.test.ts`, including a deep-frozen-state purity test) — run `npm test` after touching it; keep new tissue behaviour in `stepTissue` and keep drawing code out of the simulation
- When adding a gemstone, extend `GemstoneId` and `GEMSTONE_PRESETS`; add a structure to `STRUCTURES` in `CrystalLattice.ts` if it needs a new lattice, and check atom counts / bond lengths against literature
- Growth rates are tuned to lab-synthesis scale (~0.1–1 mm/day) so they are watchable; stability fields are simplified curves
- The soil sim is pure and unit-tested (`SoilField.test.ts`, plus coupling tests in `simStore.test.ts`) — run `npm test` after touching it. Plant water comes *only* through the soil now: `waterStatus` relaxes towards `soil.supply` (uptake ÷ transpiration demand), and growth rate is temp × light × water × `nutrientStatus`. Do not add a direct rain → waterStatus shortcut again
- Soil units: `water` is a fraction of a cell's original pore space (≤ 1 − cement); solutes are stored as amounts (concentration × water) so drying concentrates them; saturation S = c / c_eq. A hardpan (cement ≥ `HARDPAN`) stops roots that have not reached it (`rootReach` per column) — one forming around established roots does not cut them off
- TSL / node materials: load via dynamic `import()` only (a static `three/webgpu` or `three/tsl` import drags the whole WebGPU build into the default bundle), check `describeRenderer()` before using one, always keep a classic-material fallback, drive them with uniforms, and keep `color`/`roughness` mirrored on the material so GLB export still works. Before adding a mode to `NODE_READY_MODES`, walk every view with `?renderer=webgpu` and a console open (`THREE.LineLoop` is unsupported there — that is why the cellular frame is `lineSegments`). Full checklist: `docs/design/webgpu-tsl.md` §5, §8
- Prefer small, focused PRs
- Keep performance in mind (instancing, frustum culling later)
