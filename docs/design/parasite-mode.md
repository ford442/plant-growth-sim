# Parasite mode — design lock (Track C0)

**Status:** locked, 2026-11-19 · Epic [#3](https://github.com/ford442/plant-growth-sim/issues/3), issue [#9](https://github.com/ford442/plant-growth-sim/issues/9)
**Parameter bible:** [`../research/toxoplasma-gondii-parameters.md`](../research/toxoplasma-gondii-parameters.md)
**Board:** [`../../weekly_plan.md`](../../weekly_plan.md) Track C

This note records the decisions C0 was holding up: tone and framing, how real
time maps to play time, and which objective v0 ships locked. Everything here is
implemented in `src/simulation/parasite/`.

---

## 1. Tone and framing

**Educational surreal, grounded in mechanism — not a plague sandbox and not
clinical horror.**

The interesting thing about *T. gondii* is not that it makes people ill. It is
that a single cell pulls itself through a self-made ring into another cell,
keeps a 35 kb plastid genome it inherits only from its mother, and can throw a
transcriptional latch that it cannot itself undo. The mode is built to show
those mechanisms.

Concretely:

- **Systems are named after the real molecules.** The player toggles ROP16,
  ROP18/ROP5 and TgIST, not "immune debuff I/II/III". The egress readout says
  TgPLP1 pores and vacuolar pH.
- **The host is a system, not a victim.** No symptom lists, no patients, no
  medical imagery. Host state is a health bar, five cytokine/effector fields and
  five tissue niches.
- **Failure is biological.** ΔBFD1 loses by killing its host, because that is
  the published phenotype — not because a score ran out.
- **The visual register is dark-field microscopy**, consistent with the dark
  botanical and mineral chrome of the other two modes: teal on near-black,
  translucent cells, instanced crescents.

**Content framing for a public demo:** the mode is about a parasite's cell
biology. It does not depict human illness, does not use real patient data or
imagery, and names no real people. It does not need a content warning beyond
the fact that it is a simulation of an infection; the surreal register is in
the *scale-jumping*, not in gore.

**Deliberately out of scope:** congenital transmission as a playable route, and
the host-behaviour-manipulation literature as a mechanic. The amygdala niche
exists as a tropism target with its reported predilection noted, but the sim
does not claim behavioural effects — the evidence is contested and a sim-game
is the wrong place to overstate it.

---

## 2. Scope of v0

| Area | In | Out |
|---|---|---|
| Stages | tachyzoite, bradyzoite, tissue cyst, both oocysts, sporozoite, merozoite | gamont morphology, congenital stages |
| Compartments | environment, intermediate tissue, felid gut | multi-host epidemiology |
| Biomechanics | glideosome traction, moving junction, PLP1 egress | cytoskeletal detail below the conoid |
| Host | 5 immune fields, 3 effectors, 5 niches, health | organ-level physiology |
| Objectives | 5, one locked as default | campaign / progression |

---

## 3. Time-scale mapping — the two gears

*T. gondii* spans about seven decades of time: a traction pulse lasts ~0.1 s, an
oocyst stays infectious for 18 months. **One linear clock cannot show both**, so
parasite mode runs two gears off the shared `timeStore.speed` slider, normalised
so the plant default (0.5 d/s) is "1×":

| Gear | Drives | Rate at 1× | Constant |
|---|---|---|---|
| **Action seconds** | gliding, moving junction, egress cascade | 4 sim-s per real s | `ACTION_SECONDS_PER_SECOND` |
| **Lesion hours** | replication, cyst growth, sporulation, immunity | 0.9 sim-h per real s | `LESION_HOURS_PER_SECOND` |

They are deliberately inconsistent with each other — a 3-second glide burns 12
action-seconds but also ~2.7 lesion-hours. That is a stated abstraction, not a
bug, and **both clocks are shown in the HUD and the stats panel** so it is
visible rather than hidden.

Resulting play durations at 1× (the speed slider spans 0.1×–6×):

| Process | Real duration | Play duration |
|---|---|---|
| Glide across a host cell | 10–30 s | ~3 s |
| Moving junction, start to sealed PV | 15–30 s | ~7 s |
| Egress cascade | 1–5 min | ~5 s |
| Endodyogeny | 7 h | ~8 s |
| Vacuole fills to 64 | ~40 h | ~45 s |
| Oocyst sporulation | 1–5 d | 27–133 s |
| Cyst matures to >256 bradyzoites | ~2 weeks | ~4 min |

**The one extra compression:** an oocyst's 18-month shelf life would still take
four hours of play on the lesion clock, so sporulated oocysts age on a third,
explicitly-named multiplier (`OOCYST_AGEING = 90`). Their *shelf clock* is what
the endurance objective scores, and the UI labels it "shelf days" rather than
sim days so the two are never confused. Ideal cool, moist soil then gives
~540 shelf days of viability, against a 365-day target.

---

## 4. First objective (locked)

**"Quiet tenant" — establish lasting latency without killing the host.**

Hold **8 reservoir cysts at day 30**, with host health above 20%. A *reservoir
cyst* is intact, **≥50 µm** across (about 460 bradyzoites through
`cystDiameter`) and in **CNS or muscle** — the tissues that actually carry a
chronic infection to the next host. Retinal cysts are counted and reported
separately: the retina is an easy place to hide, but a few cysts in a few
square millimetres of it is not what a predator eats.

Three ways the run ends (`objectives.ts`, thresholds in `tuning.ts`):

| Ending | Condition | What the player did wrong |
|---|---|---|
| **Win** | day 30, ≥8 reservoir cysts, health > 20% | — |
| **Lose — too lytic** | health ≤ 20% at any point | let tachyzoites replicate unchecked |
| **Lose — cleared** | no parasite, no cyst anywhere | never protected a vacuole; the host won the acute phase |
| **Lose — window closed** | day 30, under target | encysted too early (too few parasites) or too late (vacuoles already stripped) |

The window matters: reaching 8 cysts on day 12 is *not* a win, because cysts
can still be stripped or reactivated before day 30. The player has to reach the
target and then keep it.

This was the C0 recommendation and it survives contact with the
implementation, because it is the objective that forces the player to engage
with the actual trade-off the parasite faces:

- Tachyzoites replicate fast and lyse cells, which damages the host.
- Cysts only form when stress opens BFD1 translation — and the cheapest source
  of stress is the host's own immune response.
- So the player must let the host mount a response, but not so much that IRG
  strips the vacuoles, and not kill the host while waiting.

Push stress too early and there are too few parasites to encyst; too late and
the host is dead. That is the real biology of chronic infection, and it is a
legible game decision.

The scripted runs in `golden.test.ts` pin all four endings from seed 42, and
they are the acceptance evidence that the objective is winnable *and* losable
both ways:

| Script | Ending |
|---|---|
| effectors fired on cooldown, stress pushed at 48 h | **won**, 9 reservoir cysts, host at 100% |
| effectors fired, stress never pushed | **lost** day 26.3, host floor, 78 cells lysed |
| nothing fired, no stress | **lost** day 30 with 5 cysts — cleared in the acute phase |
| effectors fired, stress pushed at 120 h | **lost** day 30 with 5 cysts — too late |

The other four shipped objectives are: **Amygdala garden** (niche tropism),
**Close the loop** (full heteroxenous cycle through a felid), **Oocyst winter**
(environmental endurance) and **ΔBFD1 — runaway** (the knockout phenotype as a
hard mode).

---

## 4a. Abilities: the effector economy

The three ROP/GRA effectors (research §7) are the player's only verbs. Their
*mechanisms* are modelled in `hostImmunity.ts`; what is game-only is the
economy, and `abilities.ts` says so in as many words:

| Ability | Acts for | Recharges | Role |
|---|---|---|---|
| **ROP16** | 20 h | 34 h | strategic: M2 skew, ↓IL-12 / NO / ROS, buys quiet time to build load |
| **ROP18 + ROP5** | 12 h | 20 h | tactical: shields existing vacuoles from IRG, fired into a peak |
| **TgIST** | 24 h | 80 h | the blunt one: throttles IFN-γ at source; unlocked by the run's first conversion |

Two switches, kept apart on purpose:

- **Carried** (`EffectorFlags` in the config, the sidebar tick boxes) — does
  this strain have the gene at all? Unticking one is a knockout for the run.
- **Active** (`AbilityStates` on the world, the HUD buttons) — is it being
  secreted *right now*?

`activeEffectors()` is the product of the two, and that product — never the
carried flags alone — is what `stepWorld` hands the host model. So a wild-type
strain with nothing fired is, as far as the host can tell, a triple knockout.
That is the whole mechanic: the player's advantage is *intermittent*, and the
immune ramp is not.

Durations are on the lesion clock and are marked `// TUNING`. A real tachyzoite
injects its rhoptry bulb at every invasion and secretes GRAs continuously;
there is no published cooldown. They are chosen against the clocks they compete
with — the adaptive arm needs ~24 h to start and ~72 h to saturate, M2
polarisation itself eases over ~10 h, and the objective window is 30 days — so
an ability has to matter over hours and recharge several times inside one
immune ramp.

The win/lose thresholds live in `tuning.ts` on `ParasiteConfig`, so the
objective table stays data-driven and `?debug=1` opens a Leva panel that
retunes a live run (the panel is lazy-loaded; `leva` never enters the default
bundle).

---

## 5. Decisions that fell out of implementation

Recorded because they are not obvious from the research doc alone:

1. **Encystment is gated to the intermediate host.** Stress in the felid gut
   must not divert the parasite into a tissue cyst; the gut runs schizogony and
   then gametogony instead.
2. **"Immune collapse" requires prior control.** A naive host has near-zero
   cytokine levels, which is not the collapse that releases the BFD1 latch.
   Collapse needs ≥48 lesion hours of antigen exposure *and* either heavy
   immunosuppression or a failing host, so reactivation stays a late event.
3. **`everLocked` on the BFD state.** Reactivation is "the latch engaged and
   then wound down", which cannot be told from "never committed" without
   remembering that it latched.
4. **The scene is capped, the population is not.** 56 extracellular parasites
   are simulated individually; the rest are an aggregate that immunity still
   clears and that refills scene slots as they free up. The ΔBFD1 runaway stays
   lethal without 10,000 draw calls.
5. **Oocysts weather whether or not they sporulate.** Otherwise a cohort that
   cannot mature (too hot, too dry, anoxic) would live forever.
6. **The world advances in fixed steps, not frame deltas.** The store banks
   real time × speed in an accumulator and `advanceFixed` spends it as
   identical steps of 1/60 s of 1× play (0.015 lesion hours + ≈0.067 action
   seconds — both gears move together, §3). The speed slider changes the number
   of steps per frame, never their size, so a seed plays the same run at 60 Hz,
   144 Hz or on a slow phone, and golden/replay tests are possible. The
   original issue suggested 0.25 sim-hours; that is ≈0.28 s of play at 1×, and
   because the views read `world` each frame without interpolation it would
   move every parasite only ~3.6 times a second. A step costs ≈0.04 ms (p99
   ≈0.2 ms with the scene full), so the finer step is free. A frame is capped
   at 48 steps (the longest legal frame — 0.1 s at the 6× maximum — owes 36);
   beyond that time is dropped, so a slow device plays in slow motion rather
   than falling behind. The objective is judged after every step, so a win or
   a loss lands on the same step whatever the frame rate.
7. **The overflow pool is drawn from in whole parasites.** Immunity eats a
   *fraction* of the aggregate per step, so the refill loop's `overflow > 0`
   handed a scene slot to 0.3 of a parasite and left the pool negative. It is
   `>= 1` now, and `parasiteExtinct` reads a pool under 1 as empty.
8. **`stepWorld` is pure, including the RNG.** `nextFloat` mutates its `Rng` in
   place, and the step used to draw from `world.rng` directly — so it changed
   the world it was given, and stepping the same world twice gave different
   answers. It now draws from a fork and returns it as the new `rng`. The
   sequence of draws in a linear run is unchanged, so seeded outcomes did not
   move.

---

## 6. Traceability

Every parameter in the sim carries a comment pointing at its section of the
research doc. The mapping:

| Module | Research |
|---|---|
| `stages.ts` | §2 morphology, §12.2 timers |
| `glideosome.ts` | §5, §12.4 |
| `invasion.ts` | §6, §12.5 |
| `egress.ts` | §10, §12.6 |
| `bfdSwitch.ts` | §9, §12.3 |
| `hostImmunity.ts` | §2.2 tropism, §7 effectors |
| `lifeCycleGraph.ts` | §12.1 |
| `modifiers.ts` | §11 comparative species |
| `objectives.ts` | §12.7 |

Numbers that are *tuned for play* rather than measured — the two gears, the
oocyst ageing multiplier, scene caps, hazard rates — are named constants with a
comment saying so.
