/**
 * Bandwidth marker calculation
 * Computes -3 dB half-power frequencies for selected band
 * (ported from CamillaEQ src/dsp/bandwidthMarkers.ts)
 */

import type { EqBand } from './filterResponse'

export interface BandwidthMarkers {
  leftFreq: number | null
  rightFreq: number | null
}

/**
 * Calculate constant-Q bandwidth markers for a band.
 *
 * Searching for `gain - 3 dB` fails for cuts and 0 dB peaking filters.
 * Q defines the bandwidth independently of gain, so derive the endpoints
 * directly while preserving f0 as their geometric mean.
 * Only applicable for Peaking and Notch
 */
export function calculateBandwidthMarkers(band: EqBand): BandwidthMarkers {
  if (band.type !== 'Peaking' && band.type !== 'Notch') {
    return { leftFreq: null, rightFreq: null }
  }

  const f0 = Math.max(10, Math.min(30000, band.freq))
  const bandwidth = f0 / Math.max(0.1, band.q)
  const leftFreq = (Math.sqrt(bandwidth * bandwidth + 4 * f0 * f0) - bandwidth) / 2
  const rightFreq = leftFreq + bandwidth

  return {
    leftFreq: Math.max(10, leftFreq),
    rightFreq: Math.min(30000, rightFreq),
  }
}
