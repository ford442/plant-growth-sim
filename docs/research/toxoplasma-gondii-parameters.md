# Exhaustive Biological Parameters: *Toxoplasma gondii* (Toxoplasmatidae)

**Status:** Research dump for in-silico / sim-game design  
**Source:** Gemini Deep Research synthesis (owner-curated), 2026-08  
**Taxonomy note:** Standard family name is **Toxoplasmatidae** (Sarcocystidae); colloquial “Toxoplasminidae” in the research title maps to the same cyst-forming coccidian clade.  
**Primary species:** *Toxoplasma gondii*  
**Related sim modes:** multi-scale life-stage FSM + host environments (see `weekly_plan.md`, GH epic)

This document is the **parameter bible** for a *T. gondii* simulation mode: morphology, organelles, motility, invasion/egress, stage conversion, immunity subversion, comparative Sarcocystidae, and a translational game-engine mapping.

---

## 1. Biological frame

### Phylum & family
- **Phylum:** Apicomplexa — obligate intracellular protozoa with an **apical complex** specialized for host-cell penetration.
- **Family:** Sarcocystidae / subfamily Toxoplasmatidae — cyst-forming coccidians.
- **Flagship species:** *Toxoplasma gondii* — cosmopolitan; invades virtually any nucleated cell of warm-blooded vertebrates (mammals + birds). ~1/3 of humans estimated chronically infected.

### Life-cycle topology (facultatively heteroxenous)
| Phase | Where | Outcome |
|-------|--------|---------|
| **Sexual** | Enterocytes of **felid** definitive hosts only | Gametes → zygote → **oocysts** shed in feces |
| **Asexual** | Extra-intestinal tissues of intermediate hosts | Tachyzoites → dissemination; bradyzoites in **tissue cysts** |

Transmission paths for sim objectives:
1. Oocyst (environment) → intermediate host oral uptake → acute → chronic cysts  
2. Tissue cyst (carnivory) → new intermediate host  
3. Tissue cyst → felid → sexual cycle → millions of oocysts  
4. Vertical / congenital (acute primary infection in pregnancy) — optional later mechanic  
5. Reactivation: immunosuppression → cyst rupture → recrudescent tachyzoites  

---

## 2. Infectious stages — morphology & dimensions

Three primary infectious morphologies: **sporozoite** (in oocyst), **tachyzoite**, **bradyzoite** (in tissue cyst).

### 2.1 Tachyzoite — acute proliferation
| Parameter | Value |
|-----------|--------|
| Shape | Crescent / bow; polarized (pointed anterior, blunt posterior) |
| Size | **~6 µm × 2 µm** |
| Nucleus | Central |
| Replication | **Endodyogeny** (two daughters assemble inside mother) |
| Doubling time | **~7 hours** |
| Residence | **Parasitophorous vacuole (PV)** — blocks lysosomal fusion |
| Dense granules | ~244 nm (133–334 nm) |
| Amylopectin granules | ~201 nm (103–288 nm) |
| Lipid bodies | ~215 nm (111–388 nm) |
| Function | Rapid systemic dissemination, acute infection, cell lysis |

### 2.2 Bradyzoite + tissue cyst — latency
| Parameter | Value |
|-----------|--------|
| Shape | Slender crescent; more curved |
| Size | **~7 µm × 1.5 µm** |
| Nucleus | Shifted **posterior** |
| Ultrastructure | Electron-dense rhoptries; abundant micronemes + amylopectin (long-term glucose storage) |
| Cyst diameter | **5 µm** (young, ~2 bradyzoites) → **~70 µm** (mature, **>1,000** bradyzoites) |
| Cyst wall | **<0.5 µm**; heavily glycosylated modification of original PVM |
| Tissue tropism | CNS (subtle predilection for **medial / basolateral amygdala**), **retina**, skeletal & cardiac muscle |
| Function | Slow replication, immune evasion, chronic latency; oral transmission reservoir |
| Reactivation | Immunosuppression → wall rupture → bradyzoites → tachyzoites (recrudescent, often severe) |

### 2.3 Oocyst + sporozoite — environmental persistence
| Stage | Dimensions | Notes |
|-------|------------|--------|
| Unsporulated oocyst | **10–12 µm** (subspherical) | Two-layered wall; single large sporont; pre-infectious |
| Sporulation | **1–5 days** | Needs O₂ + suitable temperature |
| Sporulated oocyst | **11 × 13 µm** | 2 sporocysts (**6 × 8 µm**, no Stieda body); each with **4 sporozoites** + residual body |
| Wall (sporulated) | 3 layers | Electron-dense outer, lucent middle, moderately dense inner; **~350 nm micropyle** (bile salts + trypsin → excystation) |
| Sporozoite | **6 × 2 µm** | Dense terminal plaques; dense granules ~208 nm; amylopectin ~356 nm; lipids ~388 nm |
| Environmental viability | Up to **18 months** moist soil/water; **~334 days** covered feces |

### Quick stage table (sim mesh defaults)

| Life stage | Cellular dimensions | Defining traits | Primary function |
|------------|---------------------|-----------------|------------------|
| Tachyzoite | 6 × 2 µm | Crescent, central nucleus, pointed apex | Acute spread / lysis |
| Bradyzoite | 7 × 1.5 µm | Posterior nucleus, dense rhoptries, amylopectin | Latency |
| Tissue cyst | 5–70 µm | Wall <0.5 µm; 2–>1000 bradyzoites | Persistence / oral reservoir |
| Unsporulated oocyst | 10–12 µm | Two-layer wall, sporont | Pre-infectious shed |
| Sporulated oocyst | 11 × 13 µm | 2 sporocysts, micropyle | Environmental vector |
| Sporozoite | 6 × 2 µm | 4 per sporocyst | Initiates infection after excystation |

---

## 3. Apicoplast — non-photosynthetic plastid

| Aspect | Detail |
|--------|--------|
| Origin | Secondary endosymbiosis (cyanobacterium-derived alga) |
| Position | Just anterior to nucleus |
| Membranes | **Four** membranes (or dual-membrane with pocketed four-laminar sectors) |
| Genome | **35 kb** circular: 4 rRNAs, 33 tRNAs, 28 predicted proteins |
| Proteome | Mostly nuclear-encoded; bipartite N-terminal targeting; APT1 uses short pre-TM motif (Tyr16, Gly17 critical) |
| Metabolism | Type II fatty acids, isoprenoids, heme, lipoic acid; redox via TgATrx1/2, TgTrx1, TgBipA |
| Endodyogeny | Elongates (U/dumbbell, up to **~3 µm**), poles tethered to centrosomes (TgATG8), fission by **DrpA** |
| Endopolygeny (felid gut) | Massive branched apicoplast → fragments into up to **~30** daughters at merozoite budding |
| Inheritance | **Maternal only** — excluded from microgametes; enriched in macrogametocytes |

**Sim hooks:** organelle as critical resource; drugs / heat / redox stress can target apicoplast; sexual stage = maternal inheritance rule for “genetics” minigame.

---

## 4. Cytoskeleton & apical complex

### Pellicle
- Plasma membrane + **inner membrane complex (IMC)** = alveoli patchwork  
- **Subpellicular network (SPN)** of alveolins  
- **22 subpellicular microtubules** from apical polar ring (APR), ~2/3 body length → crescent rigidity  
- Anterior gap for **conoid** extrusion; posterior **basal complex** (MORN-1 constrictive ring)  
- IMC biogenesis: GAP40, GAP50, GAPM family  

### Conoid
| Parameter | Value |
|-----------|--------|
| Base diameter | **~400 nm** |
| Length | **~250 nm** |
| Structure | **14** spiraling comma-shaped tubulin fibers (~9 protofilaments each); 2 intraconoidal MTs; 2 preconoidal rings |
| Resting state | Retracted under APR |
| Extrusion | Ca²⁺ rise; powered by **MyoH**; tethered to APR by **22 RNG2** filaments |
| Loss of RNG2 | Conoid detaches → **immotile** + rhoptry discharge defects |

### Secretory cascade

| Organelle | Cargo (examples) | When | Function |
|-----------|------------------|------|----------|
| Micronemes | MICs, TgPLP1, TgAMA1 | Host contact / pre-invasion | Attachment, MJ (AMA1), egress perforins |
| Rhoptry neck | RON2,4,5,8 | Immediately pre-penetration | Host-side MJ receptor |
| Rhoptry bulb | ROP16, ROP18, ROP5 | During penetration | Host cytosol/nucleus immune subversion |
| Dense granules | GRA2, GRA6, GRA17 | Post-invasion | PV remodel, IVN, nutrient pores |

---

## 5. Gliding motility (glideosome)

No cilia/flagella/pseudopodia. Substrate-dependent **gliding**.

| Parameter | Value / mechanism |
|-----------|-------------------|
| Peak speed | Up to **~3 µm/s** |
| Trajectory | Helical / corkscrew; circular twists + forward roll |
| Motor | **MyoA** (class XIV) + MLC1, ELC1/2; anchored by GAP50, GAP45, GAP40 |
| Compensation | **MyoC** + GAP80 + IAP1 at basal ring if MyoA impaired |
| Actin | Nucleated at apex by **Formin-1 (FRM1)** at PCRs; F-actin translocated rearwards |
| Force link | **GAC** (~280 kDa armadillo protein) couples F-actin → adhesin tails (e.g. **MIC2**) |
| Traction style | Periodic **inward** traction → annular constriction; parasite squeezes through fixed ring |

**Sim kinematics (from research translation):**
- Not a simple forward thrust  
- Series of inward traction forces vs environment mesh  
- Local “pinch” constriction + helical path  
- Disable MIC2/adhesin → traction fails → random inefficient motion  

---

## 6. Moving junction (invasion)

Avoids classic endocytosis → PV lacks host endocytic markers.

**Sequence:**
1. Glide + MIC attachment (e.g. TgMIC1 ↔ sialyl oligosaccharides)  
2. Apical reorientation against host membrane  
3. RON2/4/5/8 into host; RON2 hairpin exposes D3/D4 extracellularly  
4. AMA1 on parasite surface; hydrophobic groove (Trp353, Trp354, Tyr230) binds RON2 D3  
5. Glideosome drives parasite through MJ ring → PV formation  
6. Rhomboids TgROM4/5 constitutively cleave free AMA1; RON2-bound AMA1 resists cleavage; Ser527 dephosphorylation aids penetration  
7. Concurrent ROP effector injection into host cytosol  

---

## 7. Host immune subversion

| Effector | Action |
|----------|--------|
| **ROP16** | Phosphorylates STAT3/STAT6 (e.g. STAT6 Tyr641) → M2-like macrophage polarization; ↓IL-12, ↓TNF-α; ↑Arginase-1 → ↓NO; ↓ROS (w/ thioredoxin systems) |
| **ROP18 + ROP5** | On PVM cytosolic face; block IRG oligomerization (IFN-γ clearance pathway in mice) |
| **TgIST** | Nuclear; Mi-2/NuRD → repress STAT1 / IFN-γ programs |
| Chronic CNS | Neuroinflammation; GABA / kynurenine pathway shifts → **behavioral alteration** hooks |

---

## 8. Cell-cycle transcription (ApiAP2)

Asexual = endodyogeny only in intermediate hosts.

| Factor | Phase | Role | Disruption |
|--------|-------|------|------------|
| **TgAP2IX-5** | G1/S–early S | Master budding; IMC, apical cap, subordinate AP2s | Lethal; no daughter buds |
| **TgAP2XII-9** | S/M | ↑ MJ/microneme; ↓ rhoptry/cyclins late | MJ + apicoplast defects |
| **TgAP2XI-5** | S/M | ~300+ virulence/apical promoters | Attenuated invasion |
| **TgAP2XII-8** | C/G1 | Ribosomes; next cycle prep | G1 arrest |
| **TgAP2IX-4** | S/M stress | Bradyzoite transition assist | Reduced cysts |

---

## 9. Stage conversion — BFD1 master switch

**Triggers (in vitro / sim stressors):** alkaline shift **pH 8.0–8.2**, nutrient deprivation, heat shock, NO, IFN-γ / proinflammatory cytokines.

| Component | Role |
|-----------|------|
| **BFD1** | Myb-like TF; necessary **and** sufficient for bradyzoite differentiation; drives BAG1, LDH2, ENO1, cyst wall program |
| ΔBFD1 | No cysts; uncontrolled tachyzoites → host-lethal |
| BFD1 mRNA | Present in tachyzoites but translation repressed |
| Stress | eIF1.2 opens translation of differentiation mRNAs |
| **BFD2** | CCCH Zn-finger RBP; stabilizes/promotes BFD1 translation |
| Feedback | BFD1 → BFD2 transcription → BFD2 → BFD1 translation → **lock-in** |
| Reactivation | Sim rule from research: reverse only if host immunity collapses (~0) |

---

## 10. Egress (TgPLP1)

| Step | Mechanism |
|------|-----------|
| Trigger | Cytosolic **Ca²⁺** spike |
| Effector | **TgPLP1** (micronemes): N-extension + MACPF + APC-β |
| Targeting | Prefers PE/PS (+ inositol phosphates) on inner leaflets |
| Pore | Hexameric rings; ~**100 Å** pores |
| pH prep | **FNT1/FNT2** dump lactate/pyruvate → PV acidifies → max PLP1 activity + host calpains |
| Δplp1 | Trapped in host; host mounts earlier protective immunity vs WT cytokine storm lethality |

---

## 11. Comparative Sarcocystidae (future species presets)

| Species | Definitive host | Intermediate | Vertical | Distinctive mechanic |
|---------|-----------------|--------------|----------|----------------------|
| *T. gondii* | Felids | All warm-blooded | Mainly acute primary pregnancy | Extra-intestinal in cats; easy reactivation |
| *N. caninum* | Canids | Cattle, etc. | Highly efficient multi-generation | Abortion storms; no feline sex cycle |
| *H. hammondi* | Felids | Rodents | Unknown / none | Obligate heteroxenous; **terminal** cysts (no reactivation); host DNA-damage / SASP |
| *B. besnoiti* | Unknown | Cattle, ungulates | Unknown | Mechanical vector (biting insects) |

---

## 12. Translational framework → sim / game engine

### 12.1 Finite state machine (core stages)
```
ENVIRONMENT: UnsporulatedOocyst --[1–5 d O₂/temp]--> SporulatedOocyst
HOST_GUT:    SporulatedOocyst --[bile+trypsin / micropyle]--> Sporozoite → Tachyzoite
INTRACELL:   Tachyzoite --[endodyogeny ~7 h in PV]--> more Tachyzoites
             Tachyzoite --[stress + BFD1 lock]--> Bradyzoite (in growing cyst)
             Bradyzoite --[immunity ≈ 0 / wall rupture]--> Tachyzoite (reactivation)
FELID_GUT:   Bradyzoite (ingested) → Merozoite (endopolygeny) → Gametes → Zygote → Oocyst
```

### 12.2 Morphological meshes & timers
| State | Mesh | Motion | Timer / lock |
|-------|------|--------|--------------|
| Tachyzoite | Rigid crescent 6×2 µm | Up to 3 µm/s helical glide | Endodyogeny every ~7 sim hours **only inside PV** |
| Bradyzoite | 7×1.5 µm slender | ~0 | BFD1/BFD2 feedback lock |
| Tissue cyst | Sphere 5→70 µm | Immobile | Capacity 2→1000+; wall <0.5 µm |
| Oocyst | 11×13 µm | Passive environment | 1–5 d sporulation; extreme damage immunity |

### 12.3 BFD1 switch (boolean/continuous hybrid)
- Hidden vars: `bfd1`, `bfd2`, `stress`  
- Stress ↑ → `bfd1` increments (post-transcriptional gate)  
- Past threshold → BFD2 multiplier → exponential BFD1 → **irrevocable bradyzoite** until immunity collapse  

### 12.4 Gliding kinematics
- Periodic inward traction on environment contacts  
- Annular constriction / corkscrew path  
- MIC2 (or adhesin) off → traction off  

### 12.5 Invasion boolean pipeline
```
collide(host) → microneme_release → orient(apical)
  → rhoptry_release → create_MJ(AMA1–RON2 ring)
  → glide_through_MJ → create_PV
  → cast_debuff(ROP16/ROP18)  // host → M2, suppress ROS/IL-12 zones
```

### 12.6 Egress pipeline
```
FNT acidify_PV → Ca²⁺ event → spawn_TgPLP1_pores
  → destroy PV + host boundary → free tachyzoites
  // ΔPLP1: trapped; host builds cytokine storm hazard instead of clean egress
```

### 12.7 Surreal / sim-game objective seeds
(Strange, grounded in real biology — not pure body-horror for its own sake.)

1. **Complete the life cycle once** without killing the intermediate host (balance acute load vs latency).  
2. **Amygdala occupancy** — maximize cysts in preferred CNS niches; optional host-behavior side effects.  
3. **Oocyst winter** — survive 18 months environmental clock as sporulated oocyst.  
4. **Felid endgame** — reach sexual stage; shed N oocysts; maternal apicoplast inheritance puzzle.  
5. **ΔBFD1 hard mode** — cannot encyst; pure tachyzoite race vs host death.  
6. **ΔPLP1 challenge** — escape only via host inflammatory destruction path.  
7. **Hammondia contrast** — play a “locked latency” cousin with no reactivation.  
8. **Immune chess** — ROP16 M2 push vs IRG/IFN-γ pressure; manage STAT / NO / ROS fields.  

### 12.8 Suggested code layout (this repo)
```
src/simulation/parasite/
  stages.ts          # LifeStage enum + dimensions
  bfdSwitch.ts       # BFD1/BFD2 stress dynamics
  glideosome.ts      # helical traction kinematics (pure)
  invasion.ts        # MJ sequence FSM
  egress.ts          # PLP1 / pH / Ca²⁺
  hostImmunity.ts    # IRG, ROS, IL-12, M2 polarization
  lifeCycleGraph.ts  # stage transitions + host types
src/stores/parasiteStore.ts  # parallel to simStore; pure state
src/components/ParasiteViewer.tsx  # multi-scale views
```

Keep simulation **pure** (no Three.js in stores), matching plant / gem conventions.

---

## 13. Research gaps / owner follow-ups

- [ ] Cite primary papers for each numeric parameter (EM, cryo-ET, traction mapping)  
- [ ] Strain differences (Type I/II/III virulence; ROP16/18 alleles) as difficulty presets  
- [ ] Quantify amygdala tropism evidence for gameplay fairness  
- [ ] Time-scale mapping: 7 h doubling vs player session length  
- [ ] Art direction: surreal multi-scale (tissue → PV → glideosome) vs clinical accuracy  
- [ ] Content warning / educational framing for public demo  

---

## 14. Cross-links

- Living board: [`weekly_plan.md`](../../weekly_plan.md)  
- Epic issue: [**#3** — Toxoplasma gondii multi-stage life-cycle sim-game](https://github.com/ford442/plant-growth-sim/issues/3)  
- Sibling mode: GH **#1** gemstone growth simulation  
- Plant baseline: `AGENTS.md`, `src/stores/simStore.ts`, `src/simulation/LSystem.ts`  
