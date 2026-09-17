/**
 * Bandwidth marker calculation
 * Computes -3 dB half-power frequencies for selected band
 * (ported from CamillaEQ src/dsp/bandwidthMarkers.ts)
 */

import type { EqBand } from './filterResponse'
import { bandResponseDb } from './filterResponse'

export interface BandwidthMarkers {
  leftFreq: number | null
  rightFreq: number | null
}

/**
 * Calculate -3 dB bandwidth markers for a band
 * Only applicable for Peaking and Notch
 */
export function calculateBandwidthMarkers(band: EqBand): BandwidthMarkers {
  if (band.type !== 'Peaking' && band.type !== 'Notch') {
    return { leftFreq: null, rightFreq: null }
  }

  const f0 = band.freq
  const Q = band.q

  const peakGain = band.type === 'Peaking' ? band.gain : 0
  const targetDb = peakGain - 3

  const approxBandwidth = f0 / Q
  const searchSpan = approxBandwidth * 3

  const fMin = Math.max(10, f0 - searchSpan)
  const fMax = Math.min(30000, f0 + searchSpan)

  const leftFreq = findCrossing(band, targetDb, fMin, f0)
  const rightFreq = findCrossing(band, targetDb, f0, fMax)

  return { leftFreq, rightFreq }
}

/**
 * Find frequency where band response crosses target dB in given range
 * Uses bisection search for accuracy
 */
function findCrossing(band: EqBand, targetDb: number, fStart: number, fEnd: number): number | null {
  const MAX_ITERATIONS = 30
  const TOLERANCE = 0.1

  const responseStart = bandResponseDb(fStart, band)
  const responseEnd = bandResponseDb(fEnd, band)

  const crossingExists =
    (responseStart > targetDb && responseEnd < targetDb) ||
    (responseStart < targetDb && responseEnd > targetDb)

  if (!crossingExists) {
    return null
  }

  let left = fStart
  let right = fEnd

  for (let i = 0; i < MAX_ITERATIONS; i++) {
    const mid = (left + right) / 2
    const responseMid = bandResponseDb(mid, band)

    if (Math.abs(responseMid - targetDb) < 0.01) {
      return mid
    }

    if (Math.abs(right - left) < TOLERANCE) {
      return mid
    }

    const responseLeft = bandResponseDb(left, band)
    if ((responseLeft > targetDb) === (responseMid > targetDb)) {
      left = mid
    } else {
      right = mid
    }
  }

  return (left + right) / 2
}
