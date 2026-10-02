/**
 * Heatmap Series Helpers
 * Effective settings for the spectrum pipeline (the series selector made
 * selectPrimarySeries obsolete: the fill/bars always attach to the SELECTED
 * series).
 */

import type { SmoothingMode } from './fractionalOctaveSmoothing'
import type { SpectrumSeries } from '../rendering/spectrumVizController'

/**
 * Precision controls bucket count, not the user's smoothing selection.
 */
export function getEffectiveSmoothing(
  userSmoothing: SmoothingMode,
  _highPrecision: boolean
): SmoothingMode {
  return userSmoothing
}

/**
 * Effective poll interval: RTA mode polls at the daemon's fastest rate
 * (50 ms = 20 Hz) so the bars feel live; curve modes keep 100 ms.
 */
export function getEffectivePollInterval(series: SpectrumSeries): number {
  return series === 'rta' ? 50 : 100 // ms
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
