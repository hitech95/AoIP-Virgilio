/**
 * Type definitions for CamillaDSP configuration structures
 * (ported from CamillaEQ src/lib/camillaTypes.ts, extended with the
 * loose config shapes used by the EQ editor)
 */

/** Parameters for biquad filters (the EQ types we support) */
export interface BiquadParams {
  freq: number
  q: number
  gain?: number
  bypassed?: boolean
  [key: string]: any
}

/** Biquad subtypes we support for EQ */
export type BiquadType =
  | 'Peaking'
  | 'Highshelf'
  | 'Lowshelf'
  | 'Highpass'
  | 'Lowpass'
  | 'Notch'
  | 'Bandpass'
  | 'Allpass'

/** Filter types that support gain parameter */
export const GAIN_CAPABLE_TYPES: BiquadType[] = [
  'Peaking',
  'Highshelf',
  'Lowshelf',
  'Notch',
]

/** Loose filter definition shape (subset manipulated by the EQ editor) */
export interface FilterDef {
  type: string
  description?: string
  parameters?: any
  [key: string]: any
}

/** Loose mixer definition shape */
export interface MixerDef {
  description?: string
  channels?: { in: number; out: number }
  mapping?: any[]
  labels?: any
  [key: string]: any
}

/** Raw pipeline step (any format version) */
export interface PipelineStepRaw {
  type: string
  [key: string]: any
}

/** Full CamillaDSP config (loose — we only manipulate a subset) */
export interface CamillaDSPConfig {
  title?: any
  description?: any
  devices?: any
  filters?: Record<string, FilterDef>
  mixers?: Record<string, MixerDef>
  processors?: Record<string, any>
  pipeline?: PipelineStepRaw[]
  [key: string]: any
}

/** Normalized pipeline step (v3 format only) */
export interface PipelineStepNormalized {
  type: 'Filter' | 'Mixer' | 'Processor'
  channels?: number[]
  channel?: never
  names?: string[]
  name?: string
  bypassed?: boolean
}

/** Type guard: check if a biquad type supports gain parameter */
export function isGainCapable(biquadType: BiquadType): boolean {
  return GAIN_CAPABLE_TYPES.includes(biquadType)
}

/**
 * Normalize a pipeline step to v3 format
 * Converts v2 `channel: number` to v3 `channels: number[]`
 * Returns null if the step is malformed
 */
export function normalizePipelineStep(step: any): PipelineStepNormalized | null {
  if (!step || typeof step !== 'object') {
    return null
  }

  const normalized: PipelineStepNormalized = {
    type: step.type,
    bypassed: step.bypassed,
  }

  if (step.channel !== undefined && step.channels === undefined) {
    normalized.channels = [step.channel]
  } else if (step.channels !== undefined) {
    normalized.channels = step.channels
  }

  if (step.type === 'Filter' && step.names) {
    normalized.names = step.names
  } else if (step.name) {
    normalized.name = step.name
  }

  return normalized
}
