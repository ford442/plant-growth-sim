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
- [x] [#14](https://github.com/ford442/plant-growth-sim/issues/14) Smooth growth interpolation (lerp L-system generations) — `LSystemMorph.ts` (lineage through the rewrite; trunk stretches, side branches peel off, buds grow out of their parent, new leaves fade in) driven by the weather-coupled `lsystemProgress`  
- [x] [#13](https://github.com/ford442/plant-growth-sim/issues/13) Real cellular cross-section + animated division — `TissueGrowth.ts` (cambium / xylem / phloem files, growth rings, drought slows division and enlargement) + cellular view with stem disc and cell lens  
- [ ] [#10](https://github.com/ford442/plant-growth-sim/issues/10) Soil moisture field + water particles into roots  
- [ ] [#19](https://github.com/ford442/plant-growth-sim/issues/19) WebGPU / TSL upgrade path  
- [ ] [#16](https://github.com/ford442/plant-growth-sim/issues/16) Export plant as GLB  

### Done (baseline)
- [x] Vite + React + TS + R3F scaffold  
- [x] Working L-system + species presets  
- [x] Weather panel + sim controls  
- [x] Multi-view scale tabs (roots is still a stub; cellular is real as of #13)  

---

## Track B — Gemstone growth ([#1](https://github.com/ford442/plant-growth-sim/issues/1))

### Status
**Gem mode in code (2026-11-19).** Phase 1 (#11) done; crystal-system habits from #15 and the lattice view + defects / layer growth from #12 Phase 3 done. Open: TSL optical materials (#15, waits on #19), mineral–root co-evolution (#12 Phase 4).

### Plan summary (mirror of #1)
- Phase 1: [#11](https://github.com/ford442/plant-growth-sim/issues/11) `CrystalGrowth.ts`, `GemstoneId` + `GEMSTONE_PRESETS`, env fields, prism/octahedra instances  
- Phase 2: [#15](https://github.com/ford442/plant-growth-sim/issues/15) lattice systems + TSL optical materials (IOR, color vs T)  
- Phase 3–4: [#12](https://github.com/ford442/plant-growth-sim/issues/12) atomic/defect cross-sections + soil mineral field + root/geode co-evolution  

### Acceptance (from #1)
- [x] ≥3 gem types with distinct growth rules (6)  
- [x] Macro / structure / lattice views  
- [x] T, pressure, saturation controls (+ dopant, P–T diagram)  
- [x] Performance budget respected (~2 ms JS / frame)  
- [x] Conventions match plant path  

---

## Track C — *Toxoplasma gondii* sim-game mode

### Status
**Parasite mode in code (2026-11-19).** C0–C5 all landed in one pass: design lock (`docs/design/parasite-mode.md`), pure stage FSM + BFD1 switch + `parasiteStore`, glideosome/moving-junction/egress biomechanics, host immunity fields + niches, four-scale `ParasiteViewer`, and the objective layer with challenge modifiers. 51 unit tests cover the pure sim (`npm test`).  
**Epic GH issue: [#3](https://github.com/ford442/plant-growth-sim/issues/3).**

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

#### C0 — Design lock — [#9](https://github.com/ford442/plant-growth-sim/issues/9) ✅
- [x] Morphological parameter tables  
- [x] Translational FSM / MJ / egress / BFD1 specs from research  
- [x] Art + tone (educational surreal, mechanism-first) + content framing  
- [x] Session time-scale mapping — **two gears**: action seconds (4/s at 1×) and lesion hours (0.9/s at 1×), both shown in the HUD  
- [x] First playable objective locked: **Quiet tenant** — 8 mature cysts, host above 20% health  

#### C1 — Stage FSM + pure sim — [#8](https://github.com/ford442/plant-growth-sim/issues/8) ✅
- [x] `LifeStage` enum + dimension presets (`stages.ts`)  
- [x] Host types: intermediate tissue, felid enterocyte, environment  
- [x] Timers: endodyogeny ~7 h, sporulation 1–5 d, oocyst shelf life  
- [x] BFD1/BFD2 stress feedback (latency lock + reactivation on immunity collapse)  

#### C2 — Motility & invasion sandbox — [#4](https://github.com/ford442/plant-growth-sim/issues/4) ✅
- [x] Glideosome helical inward-traction kinematics (not freeflight)  
- [x] MJ sequence: MIC → orient → RON/AMA1 ring → PV, with AMA1 shedding as a real failure mode  
- [x] Egress: FNT acidify → Ca²⁺ → TgPLP1 pores, plus the Δplp1 trapped path  

#### C3 — Host field + immunity game — [#5](https://github.com/ford442/plant-growth-sim/issues/5) ✅
- [x] ROS / IL-12 / IFN-γ / IRG / NO pressure fields  
- [x] ROP16 M2 debuff; ROP18/5 IRG shield; TgIST  
- [x] Tissue niches: skeletal + cardiac muscle, retina, CNS cortex, amygdala  

#### C4 — Multi-scale R3F views — [#6](https://github.com/ford442/plant-growth-sim/issues/6) ✅
- [x] Environment / soil oocyst field  
- [x] Tissue view with cysts (5–70 µm growth) and instanced zoites + traction rings  
- [x] Single-cell PV with rosette, junction ring and PLP1 pores  
- [x] Organelle close-up (22 MTs, 14-fibre conoid, apicoplast, rhoptries, micronemes)  

#### C5 — Objectives & surreal win states — [#7](https://github.com/ford442/plant-growth-sim/issues/7) ✅
- [x] Life-cycle completion (felid gametogony → oocyst shed → new host)  
- [x] Environmental oocyst endurance (365 shelf days)  
- [x] ΔBFD1 / Δplp1 / ΔMIC2 / terminal-latency challenge modifiers  
- [x] Comparative presets: *Neospora*, *Hammondia*, *Besnoitia*  

### Bizarre / high-signal facts to keep in design (from research)
- 22 subpellicular MTs + 14-fiber conoid; RNG2 loss → total immotility  
- Gliding = inward traction “pinch,” up to ~3 µm/s  
- Apicoplast 35 kb genome; maternal inheritance only  
- Cysts 5→70 µm, up to 1000+ bradyzoites; wall <0.5 µm  
- Amygdala / retina tropism hooks for surreal host-behavior side objectives  
- Oocysts infectious months in soil; micropyle + bile/trypsin excystation  
- *H. hammondi* as “no reactivation” alternate mode  

### Acceptance criteria (v0 playable)
- [x] Switchable mode from plant UI without breaking plant tick loop  
- [x] Tachyzoite / bradyzoite-cyst / oocyst states with correct relative scales  
- [x] One full lytic-cycle loop: invade → PV → replicate → egress  
- [x] One stress path into latency (BFD1)  
- [x] Five documented objectives with win/lose  
- [x] Parameters sourced/traceable to research doc  

---

## Cross-cutting

- [x] Mode switcher in shell UI (`plant` | `gem` | `parasite`)  
- [x] Shared time / pause / speed controls (`SimClock`)  
- [ ] Docs Diátaxis later under `/docs` (tutorial / how-to / reference / explanation)  
- [ ] Do not break Zustand plant tick loop when adding modes  

---

## Open questions

1. Single repo multi-mode forever, or eventual package split (`@lab/plant`, `@lab/parasite`)?  
2. First shippable parasite slice: **tissue-cyst garden** (zen) vs **tachyzoite action** (lytics)?  
3. How hard to lean into host-behavior / amygdala mechanics for public demo?  
4. Gem + plant co-evolution (#1 Phase 4) before or after parasite C1?  

---

## Next for Track C

- [ ] Felid gut deserves its own view scale (enterocytes + endopolygeny), currently reuses the tissue scene
- [ ] Congenital / vertical transmission route (research §1, path 4)
- [ ] TSL materials for the pellicle and cyst wall once the WebGPU path lands (#19)
- [ ] Soil mineral field shared with gem mode (#12 Phase 4) — oocysts and geodes in one substrate

## Last updated

- **2026-11-20** — Plant #13 landed: the Cellular tab is a real stem cross-section (`src/simulation/TissueGrowth.ts`, `CellularView`, `TissuePanel`) with animated mitosis / expansion, growth rings and weather-driven division. Gem and parasite modes untouched.
- **2026-11-19** — Track C landed end to end: C0 design lock (`docs/design/parasite-mode.md`), C1–C5 implemented in `src/simulation/parasite/` + `parasiteStore` + `ParasiteViewer`, 51 unit tests. Plant and gem modes untouched.

- **2026-08-12** — Created weekly plan; mirrored gem #1; ingested Gemini *T. gondii* research; opened parasite epic **#3**.  
- **2026-08-12** — Filed child issues: parasite **#9–#4** (C0–C5 order: #9 C0, #8 C1, #4 C2, #5 C3, #6 C4, #7 C5); plant **#17 #18 #14 #13 #10 #19 #16**; gem **#11 #15 #12**.
