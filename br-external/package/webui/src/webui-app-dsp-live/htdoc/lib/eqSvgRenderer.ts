/**
 * EQ curve SVG path generation
 * Converts filter frequency response to SVG path strings
 * (ported from CamillaEQ src/ui/rendering/EqSvgRenderer.ts)
 */

import type { EqBand } from './filterResponse'
import { DEFAULT_SAMPLE_RATE, sumResponseDb, generateLogFrequencies } from './filterResponse'

export interface CurveOptions {
  width: number
  height: number
  numPoints?: number
  freqMin?: number
  freqMax?: number
  gainMin?: number
  gainMax?: number
  /** DSP sample rate: the response is only defined up to Nyquist. */
  sampleRate?: number
}

/**
 * Map frequency to X coordinate (log scale)
 */
export function freqToX(freq: number, width: number, freqMin = 10, freqMax = 30000): number {
  const logMin = Math.log10(freqMin)
  const logMax = Math.log10(freqMax)
  const xNorm = (Math.log10(freq) - logMin) / (logMax - logMin)
  return xNorm * width
}

/**
 * Map gain (dB) to Y coordinate (linear scale, inverted for SVG)
 */
export function gainToY(gainDb: number, height: number, gainMin = -24, gainMax = 24): number {
  const gainRange = gainMax - gainMin
  const normalized = (gainMax - gainDb) / gainRange
  return normalized * height
}

/**
 * Generate SVG path for EQ sum curve
 */
export function generateCurvePath(bands: EqBand[], options: CurveOptions): string {
  if (bands.length === 0) {
    return ''
  }

  const {
    width,
    height,
    numPoints = 256,
    freqMin = 10,
    freqMax = 30000,
    gainMin = -24,
    gainMax = 24,
    sampleRate = DEFAULT_SAMPLE_RATE,
  } = options

  // A digital biquad response is only defined up to Nyquist. Evaluating the
  // coefficients above sampleRate/2 mirrors/aliases the curve (the false
  // downturn seen near the right edge at 48 kHz). End the path there while
  // keeping freqMax for X mapping so the endpoint stays correctly placed.
  const responseMax = Math.min(freqMax, sampleRate / 2)
  const frequencies = generateLogFrequencies(freqMin, responseMax, numPoints)

  const points: Array<{ x: number; y: number }> = []
  for (const freq of frequencies) {
    const gainDb = sumResponseDb(freq, bands, sampleRate)
    const clampedGain = Math.max(gainMin, Math.min(gainMax, gainDb))

    const x = freqToX(freq, width, freqMin, freqMax)
    const y = gainToY(clampedGain, height, gainMin, gainMax)

    points.push({ x, y })
  }

  if (points.length === 0) {
    return ''
  }

  let path = `M ${points[0].x} ${points[0].y}`
  for (let i = 1; i < points.length; i++) {
    path += ` L ${points[i].x} ${points[i].y}`
  }

  return path
}

/**
 * Generate SVG path for a single band's response curve
 */
export function generateBandCurvePath(band: EqBand, options: CurveOptions): string {
  return generateCurvePath([band], options)
}
