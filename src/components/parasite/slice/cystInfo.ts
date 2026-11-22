/**
 * What the hover tooltip says about a cyst. Pure: formats numbers the sim already
 * computed, and adds no state of its own.
 */

import { NICHE_DEFS } from '../../../simulation/parasite/hostImmunity'
import { MATURE_CYST_BRADYZOITES, type Cyst } from '../../../simulation/parasite/world'
import { CYST_MAX_BRADYZOITES } from '../../../simulation/parasite/stages'

export type CystStageId = 'growing' | 'mature'

/** The two stages the sim itself distinguishes: the objectives count cysts at ≥ `MATURE_CYST_BRADYZOITES`. */
export function cystStage(bradyzoites: number): { id: CystStageId; label: string } {
  return bradyzoites >= MATURE_CYST_BRADYZOITES
    ? { id: 'mature', label: 'Mature tissue cyst' }
    : { id: 'growing', label: 'Growing tissue cyst' }
}

/** Lesion hours as the reader would say them: hours, then days, then months. */
export function formatAge(hours: number): string {
  if (hours < 24) return `${hours.toFixed(0)} h`
  if (hours < 24 * 90) return `${(hours / 24).toFixed(1)} d`
  return `${(hours / (24 * 30)).toFixed(1)} mo`
}

export type CystInfoSource = Pick<Cyst, 'niche' | 'diameter' | 'wall' | 'bradyzoites' | 'ageHours'>

export interface CystInfo {
  stage: CystStageId
  title: string
  rows: [label: string, value: string][]
}

export function describeCyst(c: CystInfoSource): CystInfo {
  const stage = cystStage(c.bradyzoites)
  return {
    stage: stage.id,
    title: stage.label,
    rows: [
      ['Age', formatAge(c.ageHours)],
      ['Bradyzoites', c.bradyzoites >= CYST_MAX_BRADYZOITES ? `${c.bradyzoites.toLocaleString()} (full)` : c.bradyzoites.toLocaleString()],
      ['Diameter', `${c.diameter.toFixed(1)} µm`],
      ['Wall', `${c.wall.toFixed(2)} µm`],
      ['Niche', NICHE_DEFS[c.niche].name],
    ],
  }
}
