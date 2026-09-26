/**
 * Viz Options Persistence
 * UI-only state for spectrum analyzer, EQ view, and heatmap settings
 * Persists in localStorage to survive browser reload
 * (ported from CamillaEQ src/lib/vizOptionsPersistence.ts; storage key scoped to dante)
 */

import type { SmoothingMode } from './fractionalOctaveSmoothing'
import type { HeatmapMaskMode } from '../rendering/canvasLayers/SpectrumHeatmapLayer'

const STORAGE_KEY = 'dante.eq.vizOptions'
const STORAGE_VERSION = 1

export interface VizOptionsState {
  version: number

  // Spectrum/analyzer settings
  /** Master switch: enables/disables the FFT spectrum entirely */
  spectrumEnabled: boolean
  spectrumMode: 'pre' | 'post'
  /** Curve smoothing on/off; the mode is remembered while off */
  smoothingEnabled: boolean
  smoothingMode: SmoothingMode
  showSTA: boolean
  showLTA: boolean
  showPeak: boolean

  // EQ view options
  showPerBandCurves: boolean
  showBandwidthMarkers: boolean
  bandFillOpacity: number
  soloWhileEditing: boolean

  // Heatmap settings
  heatmapEnabled: boolean
  heatmapMaskMode: HeatmapMaskMode
  heatmapHighPrecision: boolean
  heatmapAlphaGamma: number
  heatmapMagnitudeGain: number
  heatmapGateThreshold: number
  heatmapMaxAlpha: number
}

/**
 * Default viz options
 */
export const DEFAULT_VIZ_OPTIONS: VizOptionsState = {
  version: STORAGE_VERSION,

  spectrumEnabled: true,
  spectrumMode: 'pre',
  smoothingEnabled: true,
  smoothingMode: '1/6',
  showSTA: true,
  showLTA: false,
  showPeak: false,

  showPerBandCurves: false,
  showBandwidthMarkers: true,
  bandFillOpacity: 0.4,
  soloWhileEditing: false,

  heatmapEnabled: false,
  heatmapMaskMode: 'full',
  heatmapHighPrecision: false,
  heatmapAlphaGamma: 2.8,
  heatmapMagnitudeGain: 2.5,
  heatmapGateThreshold: 0.05,
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

  if (typeof state.spectrumEnabled === 'boolean') validated.spectrumEnabled = state.spectrumEnabled
  if (typeof state.showSTA === 'boolean') validated.showSTA = state.showSTA
  if (typeof state.showLTA === 'boolean') validated.showLTA = state.showLTA
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

  const validMaskModes: HeatmapMaskMode[] = ['full', 'top', 'bottom']
  if (state.heatmapMaskMode && validMaskModes.includes(state.heatmapMaskMode)) {
    validated.heatmapMaskMode = state.heatmapMaskMode
  }

  if (typeof state.bandFillOpacity === 'number') {
    validated.bandFillOpacity = clampValue(state.bandFillOpacity, 0, 1)
  }
  if (typeof state.heatmapAlphaGamma === 'number') {
    validated.heatmapAlphaGamma = clampValue(state.heatmapAlphaGamma, 0.8, 4.0)
  }
  if (typeof state.heatmapMagnitudeGain === 'number') {
    validated.heatmapMagnitudeGain = clampValue(state.heatmapMagnitudeGain, 0.5, 4.0)
  }
  if (typeof state.heatmapGateThreshold === 'number') {
    validated.heatmapGateThreshold = clampValue(state.heatmapGateThreshold, 0.0, 0.2)
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
