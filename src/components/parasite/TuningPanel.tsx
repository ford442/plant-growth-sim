/**
 * Leva debug panel for the objective thresholds (`?debug=1`).
 *
 * The win/lose numbers are the one part of parasite mode with no biological
 * anchor — they are a difficulty curve (`simulation/parasite/tuning.ts`) — so
 * they are the part worth retuning against a live run rather than by editing a
 * constant and reloading. Everything here writes straight into
 * `config.tuning`, which `evaluateObjective` reads, so a change lands on the
 * next step and the objective is re-judged immediately.
 *
 * Default-export + lazy-loaded from `App`, so `leva` is only fetched when the
 * switch is on and never ships in the default bundle.
 */

import { useControls } from 'leva'
import { TUNING_RANGE } from '../../simulation/parasite/tuning'
import { useParasiteStore } from '../../stores/parasiteStore'

export default function TuningPanel() {
  // read once for the initial values; `onChange` is transient, so leva drives
  // the store rather than this component re-rendering per tick
  const tuning = useParasiteStore.getState().config.tuning
  const setTuning = useParasiteStore.getState().setTuning

  useControls('Objective thresholds', () => ({
    latentTarget: {
      label: 'cysts',
      value: tuning.latentTarget,
      ...TUNING_RANGE.latentTarget,
      hint: 'Cysts of the target diameter, in CNS or muscle, needed to win.',
      onChange: (v: number) => setTuning({ latentTarget: v }),
    },
    matureDiameterUm: {
      label: 'mature µm',
      value: tuning.matureDiameterUm,
      ...TUNING_RANGE.matureDiameterUm,
      hint: 'Cyst diameter that counts. Research anchors: 5 µm at 2 bradyzoites, ~70 µm past 1000.',
      onChange: (v: number) => setTuning({ matureDiameterUm: v }),
    },
    holdDays: {
      label: 'window d',
      value: tuning.holdDays,
      ...TUNING_RANGE.holdDays,
      hint: 'Sim days the host must carry the cysts for. The objective is judged at the end of it.',
      onChange: (v: number) => setTuning({ holdDays: v }),
    },
    hostFloor: {
      label: 'floor',
      value: tuning.hostFloor,
      ...TUNING_RANGE.hostFloor,
      hint: 'Host health at or below which the run is lost.',
      onChange: (v: number) => setTuning({ hostFloor: v }),
    },
  }))

  return null
}
