import { useParasiteStore } from '../stores/parasiteStore'
import {
  PARASITE_SPECIES,
  PARASITE_SPECIES_IDS,
} from '../simulation/parasite/modifiers'

const ICONS: Record<string, string> = {
  tgondii: '🐈',
  ncaninum: '🐕',
  hhammondi: '🐁',
  bbesnoiti: '🪰',
}

/** Header species picker — the parasite-mode sibling of `SpeciesSelector`. */
export function ParasiteSelector() {
  const species = useParasiteStore((s) => s.config.species)
  const setSpecies = useParasiteStore((s) => s.setSpecies)

  return (
    <div className="species-selector">
      {PARASITE_SPECIES_IDS.map((id) => {
        const def = PARASITE_SPECIES[id]
        return (
          <button
            key={id}
            className={`species-btn ${species === id ? 'active' : ''}`}
            onClick={() => setSpecies(id)}
            title={`${def.name} — ${def.mechanic}`}
          >
            <span className="emoji">{ICONS[id]}</span>
            <span className="label">{def.short}</span>
          </button>
        )
      })}
    </div>
  )
}
