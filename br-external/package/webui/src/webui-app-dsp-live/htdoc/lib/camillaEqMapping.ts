/**
 * Mapping layer between CamillaDSP config and EqBand representation
 *
 * dante distinction: unlike CamillaEQ (which extracts the union of ALL Filter
 * steps and edits them together), the EQ editor here works on ONE pipeline
 * Filter block at a time. Extraction, parameter writes and mute/unmute are all
 * scoped to the selected step index.
 */

import type { EqBand } from './filterResponse'
import type { CamillaDSPConfig, PipelineStepNormalized } from './camillaTypes'
import { normalizePipelineStep, isGainCapable, type BiquadType } from './camillaTypes'
import { getStepKey, getDisabledFiltersForStep } from './disabledFiltersOverlay'

export interface ExtractedEqData {
  bands: EqBand[]
  filterNames: string[]
  channels: number[]
  /** Gain of the selected block's first mapped channel. */
  preampGain: number
  /** True only when the existing preamp mixer maps every selected channel. */
  preampAvailable: boolean
  orderNumbers: number[] // Position (1-based) within the selected block
}

/** Editable (non-bypassed) Filter step in the pipeline */
export interface FilterStepInfo {
  index: number // index within config.pipeline
  position: number // 1-based among Filter steps (for display)
  channels: number[]
  names: string[] // enabled filter names
  bypassed: boolean
}

/**
 * List the pipeline Filter steps that can be edited in the EQ page.
 * Bypassed steps are excluded (out of the signal path).
 */
export function listFilterSteps(config: CamillaDSPConfig): FilterStepInfo[] {
  const steps: FilterStepInfo[] = []
  const pipeline = config.pipeline || []

  for (let i = 0; i < pipeline.length; i++) {
    const step = normalizePipelineStep(pipeline[i])
    if (!step || step.type !== 'Filter' || !step.channels) continue
    if (step.bypassed) continue

    steps.push({
      index: i,
      position: steps.length + 1,
      channels: [...step.channels],
      names: [...(step.names || [])],
      bypassed: false,
    })
  }

  return steps
}

/**
 * Map CamillaDSP biquad subtype to EqBand type
 */
function mapCamillaBiquadType(camillaType: string): EqBand['type'] | null {
  switch (camillaType) {
    case 'Highpass':
      return 'HighPass'
    case 'Lowpass':
      return 'LowPass'
    case 'Peaking':
      return 'Peaking'
    case 'Highshelf':
      return 'HighShelf'
    case 'Lowshelf':
      return 'LowShelf'
    case 'Bandpass':
      return 'BandPass'
    case 'Notch':
      return 'Notch'
    case 'Allpass':
      return 'AllPass'
    default:
      return null
  }
}

/**
 * Map EqBand type to CamillaDSP biquad subtype
 */
export function mapEqBandTypeToCamilla(type: EqBand['type']): string {
  switch (type) {
    case 'HighPass':
      return 'Highpass'
    case 'LowPass':
      return 'Lowpass'
    case 'Peaking':
      return 'Peaking'
    case 'HighShelf':
      return 'Highshelf'
    case 'LowShelf':
      return 'Lowshelf'
    case 'BandPass':
      return 'Bandpass'
    case 'Notch':
      return 'Notch'
    case 'AllPass':
      return 'Allpass'
  }
}

/**
 * Extract the EQ bands of ONE Filter step (selected block).
 * Disabled filters (from the overlay) are included to keep the band list stable.
 */
export function extractEqBandsFromConfig(
  config: CamillaDSPConfig,
  stepIndex: number | null
): ExtractedEqData {
  const empty = { bands: [], filterNames: [], channels: [], preampGain: 0, preampAvailable: false, orderNumbers: [] }

  if (stepIndex === null) return empty

  const step = normalizePipelineStep(config.pipeline?.[stepIndex])
  if (!step || step.type !== 'Filter' || !step.channels) return empty

  // The preamp is optional. Never synthesize it: expose the control only
  // when the existing mixer has a direct mapping for every channel in this
  // Filter block. The UI value is the first channel; writes apply its delta
  // to every selected channel, preserving existing channel balance.
  const preampMixer = config.mixers?.preamp
  const mappings = Array.isArray(preampMixer?.mapping) ? preampMixer.mapping : []
  const preampSources = step.channels.map((channel) => {
    const route = mappings.find((mapping: any) => Number(mapping?.dest) === channel)
    return route?.sources?.find((source: any) => Number(source?.channel) === channel) ?? null
  })
  const preampAvailable = preampSources.length > 0 && preampSources.every((source) => source !== null)
  const preampGain = preampAvailable
    ? Math.max(-24, Math.min(24, Number(preampSources[0]?.gain) || 0))
    : 0

  const enabledNames = step.names || []
  const stepKey = getStepKey(step.channels, stepIndex)
  const disabledLocations = getDisabledFiltersForStep(stepKey)

  // Full ordered name list: enabled names + disabled filters at their original positions
  const fullNames: string[] = [...enabledNames]
  for (const loc of disabledLocations) {
    const insertIndex = Math.max(0, Math.min(fullNames.length, loc.index))
    fullNames.splice(insertIndex, 0, loc.filterName)
  }

  const bands: EqBand[] = []
  const filterNames: string[] = []
  const orderNumbers: number[] = []

  for (let refIndex = 0; refIndex < fullNames.length; refIndex++) {
    const filterName = fullNames[refIndex]
    const filterDef = config.filters?.[filterName]

    if (!filterDef) {
      console.warn(`Filter "${filterName}" referenced in pipeline but not found in config.filters`)
      continue
    }

    if (filterDef.type !== 'Biquad') continue

    const params = filterDef.parameters as any
    const bandType = mapCamillaBiquadType(params.type)
    if (!bandType) continue // Skip unsupported biquad subtypes (e.g., LinkwitzTransform)

    // A band is enabled when its filter is present in this step's names[]
    const enabled = enabledNames.includes(filterName)

    const freq = Number(params.freq || params.Frequency || 1000)
    const q = Number(params.q || params.Q || 1.41)
    const gain = Number(params.gain || params.Gain || 0)

    bands.push({
      enabled,
      type: bandType,
      freq: Math.max(10, Math.min(30000, freq)),
      gain: Math.max(-24, Math.min(24, gain)),
      q: Math.max(0.1, Math.min(10, q)),
    })

    filterNames.push(filterName)
    orderNumbers.push(refIndex + 1)
  }

  return { bands, filterNames, channels: [...step.channels], preampGain, preampAvailable, orderNumbers }
}

/**
 * Apply the EQ bands of the selected block to the config.
 * Only the filters of `stepIndex` are touched; the rest of the config is
 * preserved verbatim.
 */
export function applyEqBandsToConfig(
  config: CamillaDSPConfig,
  data: ExtractedEqData,
  stepIndex: number | null
): CamillaDSPConfig {
  const { bands, filterNames, preampGain } = data

  if (bands.length !== filterNames.length) {
    throw new Error('Band count and filter name count must match')
  }

  if (stepIndex === null) {
    throw new Error('No filter block selected')
  }

  const step = normalizePipelineStep(config.pipeline?.[stepIndex])
  if (!step || step.type !== 'Filter' || !step.channels) {
    throw new Error(`Pipeline step ${stepIndex} is not a Filter block`)
  }

  const updatedConfig = JSON.parse(JSON.stringify(config)) as CamillaDSPConfig

  // Adjust only the selected Filter step's mapped channels. A missing or
  // incomplete preamp mixer is intentionally left untouched: the control is
  // disabled in that case rather than silently adding a global mixer node.
  const selectedChannels = step.channels
  const preampMappings = updatedConfig.mixers?.preamp?.mapping
  if (Array.isArray(preampMappings) && selectedChannels.length > 0) {
    const sources = selectedChannels.map((channel) => {
      const route = preampMappings.find((mapping: any) => Number(mapping?.dest) === channel)
      return route?.sources?.find((source: any) => Number(source?.channel) === channel) ?? null
    })
    if (sources.every((source) => source !== null)) {
      const currentPrimaryGain = Number(sources[0]?.gain) || 0
      const delta = preampGain - currentPrimaryGain
      for (const source of sources) {
        source.gain = (Number(source?.gain) || 0) + delta
      }
    }
  }

  // Update each filter definition of this block
  for (let i = 0; i < bands.length; i++) {
    const band = bands[i]
    const filterName = filterNames[i]

    if (!updatedConfig.filters?.[filterName]) {
      console.warn(`Filter "${filterName}" not found in config, skipping`)
      continue
    }

    const filterDef = updatedConfig.filters[filterName]

    if (filterDef.type !== 'Biquad') {
      console.warn(`Filter "${filterName}" is not a Biquad, skipping`)
      continue
    }

    const params = filterDef.parameters as any

    params.type = mapEqBandTypeToCamilla(band.type)
    params.freq = band.freq
    params.q = band.q

    const camillaType = mapEqBandTypeToCamilla(band.type)
    const biquadType = camillaType.charAt(0).toUpperCase() + camillaType.slice(1)

    if (isGainCapable(biquadType as BiquadType)) {
      params.gain = band.gain
    } else {
      delete params.gain
    }

    // enabled/disabled state is managed by the overlay system and reflected
    // in this step's names[] (presence/absence of filter name)
  }

  return updatedConfig
}
