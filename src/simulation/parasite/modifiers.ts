/**
 * Challenge modifiers and comparative Sarcocystidae presets.
 *
 * Research §11 (comparative table) and §12.7 (objective seeds 5–7). Each
 * modifier switches off one real gene product and the sim follows the published
 * phenotype rather than inventing a penalty.
 */

export interface Modifiers {
  /** ΔBFD1 — no bradyzoite switch: cannot encyst, tachyzoites run away. */
  deltaBfd1: boolean
  /** Δplp1 — no perforin: egress only via host inflammatory destruction. */
  deltaPlp1: boolean
  /** ΔMIC2 — adhesin coat gone: traction slips, invasion stalls in the ring. */
  deltaMic2: boolean
  /** Terminal latency (*Hammondia*-style): cysts never reactivate. */
  lockedLatency: boolean
}

export const DEFAULT_MODIFIERS: Modifiers = {
  deltaBfd1: false,
  deltaPlp1: false,
  deltaMic2: false,
  lockedLatency: false,
}

export interface ModifierDef {
  id: keyof Modifiers
  name: string
  gene: string
  effect: string
}

export const MODIFIER_DEFS: ModifierDef[] = [
  {
    id: 'deltaBfd1',
    name: 'ΔBFD1',
    gene: 'BFD1 (Myb-like TF)',
    effect: 'No cyst can form. Tachyzoite load is unbounded and the host usually dies.',
  },
  {
    id: 'deltaPlp1',
    name: 'Δplp1',
    gene: 'TgPLP1 (MACPF perforin)',
    effect: 'Acidification and Ca²⁺ still fire, but no pores: trapped until the host lyses the cell.',
  },
  {
    id: 'deltaMic2',
    name: 'ΔMIC2',
    gene: 'MIC2 (adhesin)',
    effect: 'Motor runs without grip — the glide degenerates and the junction cannot be crossed.',
  },
  {
    id: 'lockedLatency',
    name: 'Terminal latency',
    gene: '— (Hammondia-like)',
    effect: 'The BFD1 latch never releases. Cysts are a one-way trip, even if immunity collapses.',
  },
]

// ---------------------------------------------------------------------------
// Comparative species (research §11)
// ---------------------------------------------------------------------------

export type ParasiteSpeciesId = 'tgondii' | 'ncaninum' | 'hhammondi' | 'bbesnoiti'

export interface ParasiteSpeciesDef {
  id: ParasiteSpeciesId
  name: string
  short: string
  definitiveHost: string
  intermediateHost: string
  vertical: string
  mechanic: string
  /** Modifier overlay applied when this preset is selected. */
  modifiers: Partial<Modifiers>
  /** Can the sexual cycle run at all in this sim? */
  felidCycle: boolean
}

export const PARASITE_SPECIES: Record<ParasiteSpeciesId, ParasiteSpeciesDef> = {
  tgondii: {
    id: 'tgondii',
    name: 'Toxoplasma gondii',
    short: 'T. gondii',
    definitiveHost: 'Felids',
    intermediateHost: 'All warm-blooded vertebrates',
    vertical: 'Mainly acute primary infection in pregnancy',
    mechanic: 'Extra-intestinal stages in cats; reactivates readily when immunity fails.',
    modifiers: {},
    felidCycle: true,
  },
  ncaninum: {
    id: 'ncaninum',
    name: 'Neospora caninum',
    short: 'N. caninum',
    definitiveHost: 'Canids',
    intermediateHost: 'Cattle and other ruminants',
    vertical: 'Highly efficient across multiple generations',
    mechanic: 'Abortion storms; no feline sexual cycle to complete.',
    modifiers: {},
    felidCycle: false,
  },
  hhammondi: {
    id: 'hhammondi',
    name: 'Hammondia hammondi',
    short: 'H. hammondi',
    definitiveHost: 'Felids',
    intermediateHost: 'Rodents',
    vertical: 'Unknown / none',
    mechanic: 'Obligate heteroxenous. Cysts are terminal — no reactivation, ever.',
    modifiers: { lockedLatency: true },
    felidCycle: true,
  },
  bbesnoiti: {
    id: 'bbesnoiti',
    name: 'Besnoitia besnoiti',
    short: 'B. besnoiti',
    definitiveHost: 'Unknown',
    intermediateHost: 'Cattle, ungulates',
    vertical: 'Unknown',
    mechanic: 'Mechanically vectored by biting insects rather than by ingestion.',
    modifiers: {},
    felidCycle: false,
  },
}

export const PARASITE_SPECIES_IDS: ParasiteSpeciesId[] = ['tgondii', 'ncaninum', 'hhammondi', 'bbesnoiti']

/** Merge a species' phenotype overlay onto the player's modifier choices. */
export function resolveModifiers(species: ParasiteSpeciesId, chosen: Modifiers): Modifiers {
  return { ...chosen, ...PARASITE_SPECIES[species].modifiers }
}
