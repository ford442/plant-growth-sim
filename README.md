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
- **React Three Fiber + Three.js + WebGPU** (preferred for performance & modern shaders) — optional and opt-in so far, see [WebGPU / TSL](#webgpu--tsl-experimental)
- **TSL (Three Shading Language)** for music-reactive / weather-reactive plant shaders (first one: the leaf material)
- L-systems + parametric / functional-structural plant models (FSPM)
- Simple soil moisture + root architecture model
- Weather engine (temperature, RH, PAR, precipitation, wind)

### Multi-scale Views
1. **Macro** – full plant or small garden with weather effects
2. **Architecture** – L-system / space-colonization branching with growth animation
3. **Tissue / Cellular** – a stem cross-section showing cambium, xylem/phloem and growth rings, with the cells dividing, enlarging and hardening (see [Cellular view](#cellular-view)); stomata still to come
4. **Roots** – a soil slice under the plant: water, dissolved minerals, cement and nodules, with the root system drawing on it (see [Roots view](#roots-view)); root hairs still to come

### Plant Species (initial targets)
| Species | Type | Growth model focus |
|---------|------|--------------------|
| Sunflower | Flower | Phototropism, rapid stem elongation, large leaves |
| Oak / Maple | Tree | Strong apical dominance, secondary thickening |
| Rose | Shrub/Flower | Branching, flowering cycles |
| Fern / Barnsley | Frond | Classic L-system fractal |
| Grass / Bamboo | Monocot | Tillering, rapid vertical growth |
| Vine (e.g. Ivy) | Climber | Thigmotropism, search for support |

## Cellular view

The **🧬 Cellular** tab is a real stem cross-section rather than a decoration. It has two linked pictures:

- **Stem disc** (left) — the whole slice: pith, primary xylem, one band per growth ring (pale earlywood then dark latewood, with vessel pores and medullary rays), the cambium, phloem, cortex and skin. It thickens as wood is added. The white box at 3 o'clock is the strip the lens magnifies.
- **Cell lens** (right) — that strip at cell scale, one row per radial file, pith on the left and bark on the right. The bright teal column is the **vascular cambium**, the only layer that divides.

What the cells do:

| Process | What you see |
|---|---|
| **Cell cycle** | A cambial cell swells through G1 → S → G2 (its nucleus grows and changes shade), waits at a G2/M checkpoint, then runs mitosis: chromosomes condense, line up on the equator, split to the two faces, and a white **cell plate** grows across before the cell divides in two. |
| **Periclinal division** | The inner daughter leaves as **xylem** and the outer stays cambial; every few divisions (species-dependent) the outer daughter becomes **phloem** instead. |
| **Expansion and hardening** | New cells swell with turgor, then thicken their walls. Xylem dies as it matures: **vessels** empty into round water-filled pipes (blue) and **fibres** become dense and dark. Late small fibres get the thickest walls, which is what makes latewood dark. |
| **Growth rings** | One 20-day season is one ring: big thin-walled earlywood cells first (wide vessels in ring-porous oak), small thick-walled latewood last, then a dormant gap in which the cambium rests. Pale lines mark the boundaries. |

Weather drives it through the same inputs as the rest of the plant:

- **Drought** (low plant water status) slows division, and stricter still stops cell *enlargement*, so a mild deficit gives small cells first. Under severe drought cambial cells stop at the G2/M checkpoint, living cells shrivel and dull, vessels fill with air, and the ring comes out narrow.
- **Cold or heat** arrests the cambium below roughly 4 °C and above roughly 40 °C. **Low light** limits the sugar supply for new cells.
- Wall hardening only needs warmth, so drought-stunted cells still harden: narrow, dense wood.

The status strip under the viewport says in a sentence what the cambium is doing and why, with live meters for division, enlargement and the cell-cycle mix. The sidebar panel has the ring counts and a legend. Bamboo and fern are shown with the same model for comparison, but note that monocots and ferns have no vascular cambium (the panel says so).

## Roots view

The **🌱 Roots** tab is a vertical soil slice under the plant (4.8 m × 2.4 m, 24 × 16 cells) that the plant actually lives on: rain reaches the plant only through it.

| Process | What happens |
|---|---|
| **Water** | Rain infiltrates the top, water above field capacity drains down (leaching solutes out of the bottom), capillary flow evens it out and lifts it to a drying surface, the surface evaporates, and roots take up water to meet transpiration demand. The plant's **water status** follows uptake ÷ demand. |
| **Minerals** | Pore water carries dissolved **silica** (solubility rises with temperature) and **calcium carbonate** (solubility falls with temperature and rises with soil CO₂). Undersaturated water dissolves the parent material and earlier cement; a large exchangeable-calcium pool on clay buffers it. |
| **Mineral–root interactions** | Roots take water but leave most solutes behind, so a drying root zone concentrates minerals. Root exudates speed silicate weathering; root respiration raises soil CO₂, which holds calcite in solution until the plant slows and the CO₂ falls. Calcium leached below the roots by heavy rain leaves the plant short of **calcium nutrition**, which slows growth. |
| **Precipitation** | Supersaturated water (S > 1) cements pores (less water storage; over 50 % is a **hardpan** that stops roots that have not crossed it yet) and nucleates nodules with the classical J ∝ exp(−B / ln²S) law used for crystals, several times likelier on roots. Nodules grow with the same BCF law as gem crystals. |

Three soils to try (sidebar → **Soil & minerals**):

- **Meadow loam** — the control: buffered, fertile, minerals stay dissolved for weeks.
- **Volcanic ash** — stop the rain and let the plant dry the soil: chert nodules nucleate around the roots, the biggest become **root-channel geodes**, and the surface crusts into silcrete. Heavy rain leaches the scarce calcium. **Grow its quartz lining in Gem mode →** opens the amethyst geode crystal sim.
- **Limestone rendzina** — alternate rain and dry spells: calcite precipitates on the roots as **rhizoliths** and builds a calcic horizon at the base of the root zone.

Overlays colour the slice by water, silica or calcite saturation, cement or root density. Mineral time is compressed like the gem sim's (real calcretes and geodes take centuries).

## Gem mode

Switch **🌿 Plants / 💎 Gems** in the header to grow crystals instead of plants (same clock and playback controls).

| Gemstone | Mineral · system | Distinct growth rule |
|----------|------------------|----------------------|
| Rock crystal | Quartz · trigonal (32) | Long m-prisms with r > z rhombohedra; above the α–β inversion it grows hexagonal bipyramids |
| Amethyst | Quartz · trigonal | Stubby geode points; Fe poisons the prism; colour bleaches irreversibly to citrine when heated |
| Diamond | Diamond · cubic (m-3m) | Cube → cubo-octahedron → octahedron with temperature; resorbs into dodecahedroids outside its field |
| Ruby | Corundum · trigonal (-3m) | Barrel bipyramids when cool, flat hexagonal tablets when hot; Cr³⁺ pink → red |
| Emerald | Beryl · hexagonal (6/mmm) | Flat-topped prisms that lengthen with supersaturation |
| Topaz | Topaz · orthorhombic (mmm) | Rhombic prisms with dome/dipyramid wedges |

- **Formation** — crystals nucleate on matrix rock / a geode / kimberlite (classical nucleation: high saturation → crowded druse)
- **Crystal** — one specimen with refractive optics, Miller-index face labels and growth phantoms recorded whenever conditions change
- **Lattice** — real unit cells (diamond, α-quartz, corundum, beryl, topaz) growing layer by layer via spiral step-flow, 2D island nucleation or kinetic roughening, with frozen-in vacancies and dopants
- Controls: temperature, pressure (log), saturation, dopant level, plus a clickable P–T stability diagram

The habit is a kinetic Wulff construction: each face family advances at its own normal growth velocity and the crystal is the intersection of the half-spaces.

## Parasite mode

Switch **🦠 Parasites** in the header for an in-browser *Toxoplasma gondii*
life-cycle sim-game: the same multi-scale lab stack, but the organism is a
stage machine running across soil, an intermediate host's tissue and a cat's
gut. Design decisions and the time-scale mapping are in
[`docs/design/parasite-mode.md`](docs/design/parasite-mode.md); every parameter
traces to [`docs/research/toxoplasma-gondii-parameters.md`](docs/research/toxoplasma-gondii-parameters.md).

### Systems

| System | What it models |
|---|---|
| **Glideosome** | Gliding as periodic *inward traction*: a ring runs apex→posterior each cycle and the parasite pulls itself through it along a true helix, peaking at ~3 µm/s. Lose the adhesin (ΔMIC2) and the ring slips. |
| **Moving junction** | The strict invasion sequence — MIC release → apical reorientation → RON2/4/5/8 injection → AMA1–RON2 ring → traction through the ring → sealed vacuole. ROM4/5 shed free AMA1 meanwhile, so dawdling costs the receptor. |
| **BFD1 / BFD2** | The latency switch. Stress opens BFD1 translation, BFD1 drives BFD2, BFD2 promotes BFD1 — the loop latches and the cyst becomes irrevocable until host immunity collapses. |
| **Egress** | FNT1/2 acidify the vacuole → Ca²⁺ spike → TgPLP1 oligomerises into ~100 Å pores → both membranes fail. Δplp1 stays trapped and the host destroys the cell instead. |
| **Host immunity** | IL-12, IFN-γ, IRG, NO and ROS fields with a delayed adaptive arm; ROP16 polarises macrophages to M2, ROP18+ROP5 shield the vacuole from IRG, TgIST represses STAT1. |
| **Niches** | Skeletal and cardiac muscle, retina, CNS cortex and amygdala, each with its own tropism weight and immune privilege. |

### Views

- **Soil** — the oocyst field: 1–5 day sporulation, then months of weathering
- **Tissue** — host cells, vacuoles, cysts growing 5 → 70 µm, gliding parasites with their traction rings
- **Cell / PV** — one vacuole: the rosette, the junction ring, the pores
- **Organelle** — a tachyzoite cut open: 22 subpellicular microtubules, the 14-fibre conoid, apicoplast, rhoptries, micronemes

### Objectives

**Quiet tenant** (default — bank 8 mature cysts without killing the host),
**Amygdala garden**, **Close the loop** (tissue → cat → soil → new host),
**Oocyst winter** (365 shelf days), and **ΔBFD1 — runaway**. Challenge
modifiers knock out BFD1, PLP1 or MIC2, or lock latency permanently
(*Hammondia*-style). Four comparative Sarcocystidae presets are selectable.

```bash
npm test   # 51 tests over the pure simulation
```

## WebGPU / TSL (experimental)

The app renders with the classic WebGL renderer by default. To try the
WebGPU renderer and the first TSL node material (plant leaves: veins,
chlorophyll loss, back-scattered light, rain wetness, wind flutter), open the
app with **`?renderer=webgpu`** or use the **Renderer** panel in the plant
sidebar.

- **Never required.** With no WebGPU adapter the same renderer runs on its WebGL2
  backend; if even that fails to load, the app falls back to `WebGLRenderer`.
- **Plant mode only** for now; gem and parasite modes always use WebGL.
- Audit of the dependency versions, the fallback chain, what was and was not
  verified, and the steps to port another mode:
  [`docs/design/webgpu-tsl.md`](docs/design/webgpu-tsl.md).

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
- [x] Vite + React + TS + R3F + WebGPU setup
- [x] Basic L-system tree + flower that grows over time
- [x] Weather panel (temp, light, water)

### Phase 1 – Core Simulation
- [ ] Functional-structural growth (biomass allocation)
- [x] Root architecture + soil water / mineral field (Roots view)
- [ ] Animated water flow in vasculature
- [ ] Species presets with different L-rules + parameters

### Phase 2 – Multi-scale
- [ ] Seamless zoom / scale switcher
- [x] Cellular cross-section with mitosis / expansion animation
- [x] Soil moisture visualization
- [ ] Root hair detail

### Phase 3 – Polish & Export
- [ ] Beautiful TSL shaders (translucency, chlorophyll, rain droplets, etc.) — leaf prototype done (veins, chlorophyll, wetness, wind, back-scatter); stems and droplets open
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
