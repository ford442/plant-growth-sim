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
  // replants the focused slot only; the rest of the bed keeps growing
  const replantFocus = useSimStore((s) => s.replantFocus)

  return (
    <div className="species-selector">
      {SPECIES.map((sp) => (
        <button
          key={sp.id}
          className={`species-btn ${species === sp.id ? 'active' : ''}`}
          onClick={() => {
            replantFocus(sp.id)
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
