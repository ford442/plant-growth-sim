# Weekly Plan — Plant Growth Simulator (multi-mode lab)

Living task board for this monorepo vision: **plants**, **gemstones**, and a surreal **Toxoplasma gondii life-cycle sim-game**.  
Primary research dump for the parasite mode: [`docs/research/toxoplasma-gondii-parameters.md`](./docs/research/toxoplasma-gondii-parameters.md).

**Today’s date context:** 2026-08-12  

---

## North star

One browser lab (Vite + React + R3F + Zustand) that can switch “simulation organisms”:

| Mode | Metaphor | Environment drivers | View scales |
|------|----------|---------------------|-------------|
| **Plant** (Phase 0 live) | L-system / FSPM growth | Weather (T, light, RH, rain, wind) | Macro → architecture → cellular → roots |
| **Gem** ([#1](https://github.com/ford442/plant-growth-sim/issues/1)) | Crystallographic growth | T, pressure, mineral saturation | Macro → crystal habit → lattice |
| **Parasite / *T. gondii*** ([#3](https://github.com/ford442/plant-growth-sim/issues/3)) | Multi-host life-cycle FSM + sim-game objectives | Host immunity, tissue niche, felid gut, soil/water oocyst field | Environment → tissue → PV/cell → organelle |

Shared rules (from `AGENTS.md`):
- Pure simulation (no Three.js objects in stores)
- Preset tables easy to extend
- Dark botanical (and later mineral / microscopic) UI
- Prefer small focused PRs

---

## Today’s focus

1. **Capture planning** — land `weekly_plan.md` + toxoplasma research doc + GH epic (this pass).  
2. **Do not block plant Phase-0 polish** — parasite/gem are parallel tracks, not rewrites of the tick loop.  
3. **Next research paste** — owner may add more bizarre facts / papers into `docs/research/`.

---

## Track A — Plant (core product)

### Status
Phase 0 scaffold: L-system grows with age; weather affects growth/water; 4 view modes; 6 species presets.

### Backlog (high value from AGENTS.md)
- [ ] [#17](https://github.com/ford442/plant-growth-sim/issues/17) Replace lineSegments with tube / instanced cylinder branches  
- [ ] [#18](https://github.com/ford442/plant-growth-sim/issues/18) Better leaf meshes (instanced planes, orientation)  
- [ ] [#14](https://github.com/ford442/plant-growth-sim/issues/14) Smooth growth interpolation (lerp L-system generations)  
- [ ] [#13](https://github.com/ford442/plant-growth-sim/issues/13) Real cellular cross-section + animated division  
- [ ] [#10](https://github.com/ford442/plant-growth-sim/issues/10) Soil moisture field + water particles into roots  
- [ ] [#19](https://github.com/ford442/plant-growth-sim/issues/19) WebGPU / TSL upgrade path  
- [ ] [#16](https://github.com/ford442/plant-growth-sim/issues/16) Export plant as GLB  

### Done (baseline)
- [x] Vite + React + TS + R3F scaffold  
- [x] Working L-system + species presets  
- [x] Weather panel + sim controls  
- [x] Multi-view scale tabs (stubs for cellular/roots)  

---

## Track B — Gemstone growth ([#1](https://github.com/ford442/plant-growth-sim/issues/1))

### Status
**Documented as open GH issue #1** (full implementation plan). Not started in code.

### Plan summary (mirror of #1)
- Phase 1: [#11](https://github.com/ford442/plant-growth-sim/issues/11) `CrystalGrowth.ts`, `GemstoneId` + `GEMSTONE_PRESETS`, env fields, prism/octahedra instances  
- Phase 2: [#15](https://github.com/ford442/plant-growth-sim/issues/15) lattice systems + TSL optical materials (IOR, color vs T)  
- Phase 3–4: [#12](https://github.com/ford442/plant-growth-sim/issues/12) atomic/defect cross-sections + soil mineral field + root/geode co-evolution  

### Acceptance (from #1)
- [ ] ≥3 gem types with distinct growth rules  
- [ ] Macro / structure / lattice views  
- [ ] T, pressure, saturation controls  
- [ ] Performance budget respected  
- [ ] Conventions match plant path  

---

## Track C — *Toxoplasma gondii* sim-game mode

### Status
**Research ingested** into `docs/research/toxoplasma-gondii-parameters.md` (Gemini Deep Research).  
**Epic GH issue: [#3](https://github.com/ford442/plant-growth-sim/issues/3).** **No simulation code yet.**

### Design intent
Strange multi-scale **objective-driven** sim: play the life cycle (tachyzoite ↔ bradyzoite/cyst ↔ oocyst/sporozoite ↔ felid sexual stage) with biomechanically grounded systems (glideosome traction, moving junction, BFD1 lock, PLP1 egress) rather than generic “virus tycoon.”

### Architecture sketch
```
src/simulation/parasite/   # pure FSMs + kinematics
src/stores/parasiteStore.ts
src/components/ParasiteViewer.tsx
```
Reuse: tick loop patterns from `simStore`, multi-scale UI from plant views, preset pattern from `SPECIES_LSYSTEMS`.

### Implementation phases (proposed)

#### C0 — Design lock — [#9](https://github.com/ford442/plant-growth-sim/issues/9)
- [x] Morphological parameter tables  
- [x] Translational FSM / MJ / egress / BFD1 specs from research  
- [ ] Art + tone (educational surreal vs clinical) + content framing  
- [ ] Session time-scale mapping (7 h doubling → player time)  
- [ ] First playable objective (recommend: “encyst without killing host”)  

#### C1 — Stage FSM + pure sim — [#8](https://github.com/ford442/plant-growth-sim/issues/8)
- [ ] `LifeStage` enum + dimension presets  
- [ ] Host types: intermediate tissue, felid enterocyte, environment  
- [ ] Timers: endodyogeny ~7 h, sporulation 1–5 d, oocyst viability  
- [ ] BFD1/BFD2 stress feedback (latency lock + reactivation on immunity collapse)  

#### C2 — Motility & invasion sandbox — [#4](https://github.com/ford442/plant-growth-sim/issues/4)
- [ ] Glideosome helical inward-traction kinematics (not freeflight)  
- [ ] MJ sequence: MIC → orient → RON/AMA1 ring → PV  
- [ ] Egress: FNT acidify → Ca²⁺ → TgPLP1 pores  

#### C3 — Host field + immunity game — [#5](https://github.com/ford442/plant-growth-sim/issues/5)
- [ ] ROS / IL-12 / IFN-γ / IRG pressure fields  
- [ ] ROP16 M2 debuff; ROP18/5 IRG shield; TgIST optional  
- [ ] Tissue niches: muscle, retina, amygdala-weighted CNS  

#### C4 — Multi-scale R3F views — [#6](https://github.com/ford442/plant-growth-sim/issues/6)
- [ ] Macro host / environment map  
- [ ] Tissue slice with cysts (5–70 µm growth)  
- [ ] Single-cell PV + endodyogeny  
- [ ] Organelle close-up (apicoplast, conoid 400×250 nm)  

#### C5 — Objectives & surreal win states — [#7](https://github.com/ford442/plant-growth-sim/issues/7)
- [ ] Life-cycle completion (felid oocyst shed)  
- [ ] Environmental oocyst endurance  
- [ ] ΔBFD1 / ΔPLP1 challenge modifiers  
- [ ] Optional comparative presets: *Neospora*, *Hammondia*, *Besnoitia*  

### Bizarre / high-signal facts to keep in design (from research)
- 22 subpellicular MTs + 14-fiber conoid; RNG2 loss → total immotility  
- Gliding = inward traction “pinch,” up to ~3 µm/s  
- Apicoplast 35 kb genome; maternal inheritance only  
- Cysts 5→70 µm, up to 1000+ bradyzoites; wall <0.5 µm  
- Amygdala / retina tropism hooks for surreal host-behavior side objectives  
- Oocysts infectious months in soil; micropyle + bile/trypsin excystation  
- *H. hammondi* as “no reactivation” alternate mode  

### Acceptance criteria (v0 playable)
- [ ] Switchable mode from plant UI without breaking plant tick loop  
- [ ] At least tachyzoite / bradyzoite-cyst / oocyst states with correct relative scales  
- [ ] One full lytic-cycle loop: invade → PV → replicate → egress  
- [ ] One stress path into latency (BFD1)  
- [ ] One documented objective with win/lose  
- [ ] Parameters sourced/traceable to research doc  

---

## Cross-cutting

- [ ] Mode switcher in shell UI (`plant` | `gem` | `parasite`) — only when second mode is non-stub  
- [ ] Shared time / pause / speed controls  
- [ ] Docs Diátaxis later under `/docs` (tutorial / how-to / reference / explanation)  
- [ ] Do not break Zustand plant tick loop when adding modes  

---

## Open questions

1. Single repo multi-mode forever, or eventual package split (`@lab/plant`, `@lab/parasite`)?  
2. First shippable parasite slice: **tissue-cyst garden** (zen) vs **tachyzoite action** (lytics)?  
3. How hard to lean into host-behavior / amygdala mechanics for public demo?  
4. Gem + plant co-evolution (#1 Phase 4) before or after parasite C1?  

---

## Last updated

- **2026-08-12** — Created weekly plan; mirrored gem #1; ingested Gemini *T. gondii* research; opened parasite epic **#3**.  
- **2026-08-12** — Filed child issues: parasite **#9–#4** (C0–C5 order: #9 C0, #8 C1, #4 C2, #5 C3, #6 C4, #7 C5); plant **#17 #18 #14 #13 #10 #19 #16**; gem **#11 #15 #12**.
