/**
 * UCI persistence bridge for the EQ page.
 *
 * Live tuning talks to CamillaDSP directly over the websocket; making a
 * change persistent means writing it into the protected pipeline's UCI
 * slots through the daemon (`dsp.save_filters`). The daemon owns three
 * validation layers (allow list / max_steps / locked subchains, a genconf
 * dry-run, and the camilladsp manifest). This module adds the client-side
 * mapping and pre-validation so refusals are explained before a round trip.
 */

import type { EqBand } from './filterResponse'

export type PipelineStageKind = 'free' | 'mixer' | 'locked' | 'editable'

export interface PipelineStage {
  index: number
  kind: PipelineStageKind
  label: string
  channels?: number
  filters?: number
  max_steps?: number
}

export interface EditableSlot {
  policy: string
  channels: number
  allow: string[]
  max_steps: number
  filters: Array<Record<string, any>>
}

export interface FiltersSchema {
  editable: Record<string, EditableSlot>
  locked: Record<string, string[]>
  user_gains: string[]
}

/** CamillaDSP biquad subtype -> uci filter type. Null = no UCI equivalent.
 * Mirrors genconf's emit_filter_yaml case list one-to-one (peak/hs/ls/
 * hp/lp/bp/notch/ap + gain); anything not here cannot be persisted. */
const UCI_TYPE_BY_BAND: Partial<Record<EqBand['type'], string>> = {
  Peaking: 'peak',
  LowShelf: 'ls',
  HighShelf: 'hs',
  HighPass: 'hp',
  LowPass: 'lp',
  BandPass: 'bp',
  Notch: 'notch',
  AllPass: 'ap',
}

/** uci params accepted per filter type (mirrors the filters page schema). */
const UCI_PARAMS: Record<string, string[]> = {
  peak: ['f', 'gain', 'q'],
  ls: ['f', 'gain', 'q'],
  hs: ['f', 'gain', 'q'],
  hp: ['f', 'q'],
  lp: ['f', 'q'],
  bp: ['f', 'q'],
  notch: ['f', 'q'],
  ap: ['f', 'q'],
  gain: ['gain'],
}

export function uciTypeOf(band: EqBand): string | null {
  return UCI_TYPE_BY_BAND[band.type] ?? null
}

/** Map one live band to its uci params (null when the type is unmappable). */
export function bandToUciFilter(band: EqBand): Record<string, unknown> | null {
  const type = uciTypeOf(band)
  if (!type) return null

  const out: Record<string, unknown> = { type }
  for (const param of UCI_PARAMS[type] ?? []) {
    if (param === 'f') out.f = Math.round(band.freq * 10) / 10
    else if (param === 'gain') out.gain = Math.round(band.gain * 100) / 100
    else if (param === 'q') out.q = Math.round(band.q * 100) / 100
  }
  return out
}

export interface SlotSavePlan {
  /**
   * 'slot': write into the named UCI subchain slot (policy-checked).
   * 'free': write into the raw pipeline step (no policy metadata, or the
   *         slot schema is unavailable) — "free edit".
   */
  mode: 'slot' | 'free'
  /** UCI slot name (slot mode), if known. */
  slot: string | null
  /** Runtime pipeline index being saved. */
  pipelineIndex: number | null
  steps: Array<Record<string, unknown>>
  errors: string[]
}

/**
 * Build the `save_filters` payload for one pipeline block.
 *
 * Policy handling is deliberately forgiving:
 *  - locked blocks are refused (protected chains are never overridden)
 *  - mixer blocks have no filter list to save
 *  - editable slots enforce allow/max_steps ONLY when the policy sets them;
 *    an empty/unset allow list means "free edit"
 *  - free blocks (or unavailable policy info) save into the raw pipeline
 *    step without policy constraints
 * The daemon re-validates everything and dry-runs genconf before commit.
 */
export function planSlotSave(
  stages: PipelineStage[],
  schema: FiltersSchema | null,
  pipelineIndex: number | null,
  bands: EqBand[]
): SlotSavePlan {
  if (pipelineIndex === null) {
    return { mode: 'slot', slot: null, pipelineIndex: null, steps: [], errors: ['Select a filter block first.'] }
  }

  const errors: string[] = []
  const steps: Array<Record<string, unknown>> = []

  bands.forEach((band, i) => {
    // Muted bands are absent from the running pipeline: keep them out of
    // the saved list so UCI mirrors what is actually heard.
    if (!band.enabled) return

    const mapped = bandToUciFilter(band)
    if (!mapped) {
      errors.push(
        `Filter ${i + 1} (${band.type}) has no UCI equivalent (peak/ls/hs/hp/lp/bp/notch/ap).`
      )
      return
    }
    steps.push(mapped)
  })

  const refuse = (message: string): SlotSavePlan => ({
    mode: 'slot',
    slot: null,
    pipelineIndex,
    steps: [],
    errors: [message],
  })

  const stage = stages.find((s) => s.index === pipelineIndex) ?? null
  if (stage?.kind === 'locked') {
    return refuse(`Block is a protected chain (${stage.label}): saving to UCI is disabled.`)
  }
  if (stage?.kind === 'mixer') {
    return refuse(`${stage.label}: mixers have no filter list to save.`)
  }

  if (stage?.kind === 'editable') {
    const slot = schema?.editable[stage.label]
    if (!slot) {
      // Slot schema unavailable: fall back to free edit on this step.
      return { mode: 'free', slot: stage.label, pipelineIndex, steps, errors }
    }

    // Empty/unset allow list = unrestricted ("policies not set").
    if (slot.allow.length > 0) {
      for (const step of steps) {
        if (!slot.allow.includes(String(step.type))) {
          errors.push(
            `Filter (${step.type}) is not allowed in "${stage.label}" (allow: ${slot.allow.join(' ')}).`
          )
        }
      }
    }
    if (slot.max_steps > 0 && steps.length > slot.max_steps) {
      errors.push(`"${stage.label}": ${steps.length} filters exceed max_steps=${slot.max_steps}.`)
    }
    return { mode: 'slot', slot: stage.label, pipelineIndex, steps, errors }
  }

  // Free block, or policy info unavailable entirely: free edit.
  return { mode: 'free', slot: stage?.label ?? null, pipelineIndex, steps, errors }
}
