import { useSimStore, type SpeciesId } from '../stores/simStore'

const SPECIES: { id: SpeciesId; label: string; emoji: string }[] = [
  { id: 'sunflower', label: 'Sunflower', emoji: '🌻' },
  { id: 'oak', label: 'Oak', emoji: '🌳' },
  { id: 'rose', label: 'Rose', emoji: '🌹' },
  { id: 'fern', label: 'Fern', emoji: '🪴' },
  { id: 'bamboo', label: 'Bamboo', emoji: '🎍' },
  { id: 'ivy', label: 'Ivy', emoji: '🌿' },
]

export function SpeciesSelector() {
  const species = useSimStore((s) => s.species)
  const setSpecies = useSimStore((s) => s.setSpecies)
  const reset = useSimStore((s) => s.reset)

  return (
    <div className="species-selector">
      {SPECIES.map((sp) => (
        <button
          key={sp.id}
          className={`species-btn ${species === sp.id ? 'active' : ''}`}
          onClick={() => {
            setSpecies(sp.id)
            reset()
          }}
          title={sp.label}
        >
          <span className="emoji">{sp.emoji}</span>
          <span className="label">{sp.label}</span>
        </button>
      ))}
    </div>
  )
}
