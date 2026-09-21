/**
 * Fractional-Octave Smoothing
 * Applies frequency-domain smoothing to reduce comb artifacts
 * (ported from CamillaEQ src/dsp/fractionalOctaveSmoothing.ts)
 */

export type SmoothingMode = 'off' | '1/12' | '1/6' | '1/3'

/**
 * Apply fractional-octave smoothing to dB spectrum bins
 */
export function smoothDbBins(binsDb: number[], mode: SmoothingMode): number[] {
  if (mode === 'off' || binsDb.length === 0) {
    return binsDb
  }

  const windowSize = getWindowSize(mode)

  const power = binsDb.map((db) => Math.pow(10, db / 10))

  const smoothedPower: number[] = []

  for (let i = 0; i < binsDb.length; i++) {
    let sumWeighted = 0
    let sumWeights = 0

    // Triangular window centered at i
    for (let j = -windowSize; j <= windowSize; j++) {
      const idx = i + j
      if (idx >= 0 && idx < binsDb.length) {
        const weight = 1 - Math.abs(j) / (windowSize + 1)
        sumWeighted += power[idx] * weight
        sumWeights += weight
      }
    }

    smoothedPower.push(sumWeighted / sumWeights)
  }

  return smoothedPower.map((p) => 10 * Math.log10(Math.max(p, 1e-10)))
}

/**
 * Get kernel window size (half-width) for smoothing mode
 */
function getWindowSize(mode: SmoothingMode): number {
  switch (mode) {
    case '1/12':
      return 2
    case '1/6':
      return 4
    case '1/3':
      return 8
    default:
      return 0
  }
}
