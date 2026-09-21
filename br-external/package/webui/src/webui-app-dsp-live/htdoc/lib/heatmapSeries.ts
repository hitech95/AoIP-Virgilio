/**
 * Heatmap Series Helpers
 * Logic for selecting primary series for heatmap masking and computing effective settings
 * (ported from CamillaEQ src/dsp/heatmapSeries.ts)
 */

import type { SmoothingMode } from './fractionalOctaveSmoothing'

export interface AnalyzerVisibility {
  showSTA: boolean
  showLTA: boolean
  showPeak: boolean
}

export interface AnalyzerSeriesData {
  staNorm: number[] | null
  ltaNorm: number[] | null
  peakNorm: number[] | null
}

/**
 * Select the primary series for heatmap masking
 * Priority: LTA -> STA -> Peak -> fallback to STA
 */
export function selectPrimarySeries(
  visibility: AnalyzerVisibility,
  series: AnalyzerSeriesData
): number[] | null {
  if (visibility.showLTA && series.ltaNorm) {
    return series.ltaNorm
  }

  if (visibility.showSTA && series.staNorm) {
    return series.staNorm
  }

  if (visibility.showPeak && series.peakNorm) {
    return series.peakNorm
  }

  return series.staNorm
}

/**
 * Get effective smoothing mode for high precision
 */
export function getEffectiveSmoothing(
  userSmoothing: SmoothingMode,
  highPrecision: boolean
): SmoothingMode {
  if (highPrecision) {
    return 'off'
  }
  return userSmoothing
}

/**
 * Get effective poll interval for high precision
 */
export function getEffectivePollInterval(highPrecision: boolean): number {
  return highPrecision ? 250 : 100 // ms
}

/**
 * Get effective analyzer time constants for high precision
 */
export function getEffectiveAnalyzerTau(highPrecision: boolean): {
  tauShort: number
  tauLong: number
} {
  if (highPrecision) {
    return { tauShort: 2.0, tauLong: 16.0 }
  }

  return { tauShort: 0.8, tauLong: 8.0 }
}
