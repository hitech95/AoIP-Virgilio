/**
 * Viz Options Persistence
 * UI-only state for spectrum analyzer, EQ view, and heatmap settings
 * Persists in localStorage to survive browser reload
 * (ported from CamillaEQ src/lib/vizOptionsPersistence.ts; storage key scoped to dante)
 */

import type { SmoothingMode } from './fractionalOctaveSmoothing'
import type { HeatmapFillMode } from '../rendering/canvasLayers/SpectrumHeatmapLayer'
import type { SpectrumSeries } from '../rendering/spectrumVizController'

const STORAGE_KEY = 'dante.eq.vizOptions'
const STORAGE_VERSION = 4

export interface VizOptionsState {
  version: number

  // Spectrum/analyzer settings
  /** Master switch: enables/disables the FFT spectrum entirely.
   * NOT persisted: the FFT is computation heavy and always starts
   * disabled on every page load. */
  spectrumEnabled: boolean
  spectrumMode: 'pre' | 'post'
  /** displayed series: RTA bars of the instantaneous spectrum, or the
   * STA/LTA averaged curve (replaces the old showSTA/showLTA toggles) */
  spectrumSeries: SpectrumSeries
  /** Curve smoothing on/off; the mode is remembered while off */
  smoothingEnabled: boolean
  smoothingMode: SmoothingMode
  /** peak envelope of the selected series (dashed curve / bar crests) */
  showPeak: boolean
  /** user FFT window offset (dB): window = +6+offset … −60+offset over 66 dB */
  spectrumTrimDb: number

  // EQ view options
  showPerBandCurves: boolean
  showBandwidthMarkers: boolean
  bandFillOpacity: number
  soloWhileEditing: boolean

  // Heatmap settings
  heatmapEnabled: boolean
  heatmapFillMode: HeatmapFillMode
  heatmapHighPrecision: boolean
  heatmapAlphaGamma: number
  /** Relative visual gain; 1 preserves the default palette/opacity response. */
  heatmapMagnitudeGain: number
  /** Absolute visual gate threshold in dBFS. */
  heatmapGateThreshold: number
  heatmapMaxAlpha: number
}

/**
 * Default viz options
 */
export const DEFAULT_VIZ_OPTIONS: VizOptionsState = {
  version: STORAGE_VERSION,

  spectrumEnabled: false,
  spectrumMode: 'pre',
  spectrumSeries: 'rta',
  smoothingEnabled: true,
  smoothingMode: '1/6',
  showPeak: true,
  spectrumTrimDb: 0,

  showPerBandCurves: false,
  showBandwidthMarkers: true,
  bandFillOpacity: 0.4,
  soloWhileEditing: false,

  heatmapEnabled: false,
  heatmapFillMode: 'under',
  heatmapHighPrecision: false,
  heatmapAlphaGamma: 2.8,
  heatmapMagnitudeGain: 1,
  heatmapGateThreshold: -57,
  heatmapMaxAlpha: 0.95,
}

function clampValue(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value))
}

/**
 * Validate and clamp viz options state
 */
export function validateVizOptions(state: Partial<VizOptionsState>): VizOptionsState {
  const validated: VizOptionsState = { ...DEFAULT_VIZ_OPTIONS }

  if (state.spectrumMode === 'pre' || state.spectrumMode === 'post') {
    validated.spectrumMode = state.spectrumMode
  }

  const validSeries: SpectrumSeries[] = ['rta', 'sta', 'lta']
  if (state.spectrumSeries && validSeries.includes(state.spectrumSeries)) {
    validated.spectrumSeries = state.spectrumSeries
  }
  if (typeof state.spectrumTrimDb === 'number') {
    validated.spectrumTrimDb = clampValue(state.spectrumTrimDb, -12, 12)
  }

  const validSmoothingModes: SmoothingMode[] = ['off', '1/12', '1/6', '1/3']
  if (state.smoothingMode && validSmoothingModes.includes(state.smoothingMode)) {
    validated.smoothingMode = state.smoothingMode
  }
  // legacy migration: the on/off used to live inside the mode ('off')
  if (typeof state.smoothingEnabled === 'boolean') {
    validated.smoothingEnabled = state.smoothingEnabled
  } else {
    validated.smoothingEnabled = validated.smoothingMode !== 'off'
  }
  if (validated.smoothingEnabled && validated.smoothingMode === 'off') {
    validated.smoothingMode = '1/6'
  }

  /* the FFT enable flag is deliberately not restored: computation heavy */
  validated.spectrumEnabled = false
  if (typeof state.showPeak === 'boolean') validated.showPeak = state.showPeak
  if (typeof state.showPerBandCurves === 'boolean')
    validated.showPerBandCurves = state.showPerBandCurves
  if (typeof state.showBandwidthMarkers === 'boolean')
    validated.showBandwidthMarkers = state.showBandwidthMarkers
  if (typeof state.soloWhileEditing === 'boolean')
    validated.soloWhileEditing = state.soloWhileEditing
  if (typeof state.heatmapEnabled === 'boolean') validated.heatmapEnabled = state.heatmapEnabled
  if (typeof state.heatmapHighPrecision === 'boolean')
    validated.heatmapHighPrecision = state.heatmapHighPrecision

  const validFillModes: HeatmapFillMode[] = ['under', 'above', 'background']
  if (state.heatmapFillMode && validFillModes.includes(state.heatmapFillMode)) {
    validated.heatmapFillMode = state.heatmapFillMode
  } else {
    /* migration: the fill styles replaced the old mask modes */
    const legacy = (state as Record<string, unknown>).heatmapMaskMode
    if (legacy === 'top') validated.heatmapFillMode = 'above'
    else if (legacy === 'bottom') validated.heatmapFillMode = 'under'
    else if (legacy === 'full') validated.heatmapFillMode = 'background'
  }

  if (typeof state.bandFillOpacity === 'number') {
    validated.bandFillOpacity = clampValue(state.bandFillOpacity, 0, 1)
  }
  if (typeof state.heatmapAlphaGamma === 'number') {
    validated.heatmapAlphaGamma = clampValue(state.heatmapAlphaGamma, 0.8, 4.0)
  }
  if (typeof state.heatmapMagnitudeGain === 'number') {
    validated.heatmapMagnitudeGain = clampValue(state.heatmapMagnitudeGain, 0.25, 4.0)
  }
  if (typeof state.heatmapGateThreshold === 'number') {
    validated.heatmapGateThreshold = clampValue(state.heatmapGateThreshold, -90, 0)
  }
  if (typeof state.heatmapMaxAlpha === 'number') {
    validated.heatmapMaxAlpha = clampValue(state.heatmapMaxAlpha, 0.2, 1.0)
  }

  return validated
}

/**
 * Load viz options from localStorage with migration
 */
export function loadVizOptions(): VizOptionsState {
  try {
    const stored = localStorage.getItem(STORAGE_KEY)
    if (!stored) {
      return { ...DEFAULT_VIZ_OPTIONS }
    }

    const parsed = JSON.parse(stored)
    if (parsed.version === 3) {
      if (typeof parsed.heatmapMagnitudeGain === 'number') parsed.heatmapMagnitudeGain /= 2.5
      if (typeof parsed.heatmapGateThreshold === 'number') parsed.heatmapGateThreshold = -60 + 66 * parsed.heatmapGateThreshold
      parsed.version = STORAGE_VERSION
    }

    if (parsed.version !== STORAGE_VERSION) {
      console.warn('Viz options version mismatch, resetting to defaults')
      return { ...DEFAULT_VIZ_OPTIONS }
    }

    return validateVizOptions(parsed)
  } catch (error) {
    console.error('Error loading viz options:', error)
    return { ...DEFAULT_VIZ_OPTIONS }
  }
}

/**
 * Save viz options to localStorage
 */
export function saveVizOptions(state: VizOptionsState): void {
  try {
    const validated = validateVizOptions(state)
    localStorage.setItem(STORAGE_KEY, JSON.stringify(validated))
  } catch (error) {
    console.error('Error saving viz options:', error)
  }
}

/**
 * Clear viz options (reset to defaults)
 */
export function clearVizOptions(): void {
  try {
    localStorage.removeItem(STORAGE_KEY)
  } catch (error) {
    console.error('Error clearing viz options:', error)
  }
}
