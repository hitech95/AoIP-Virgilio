/**
 * Fractional-Octave Smoothing
 * Applies frequency-domain smoothing to reduce comb artifacts.
 * The kernel width is derived from the requested octave fraction and the
 * actual bin width (log-spaced bins: ~1/3 oct at 32 buckets, ~1/11 at 128)
 * — a fixed bins-count kernel would over-smooth coarse buckets and
 * under-smooth fine ones.
 */

export type SmoothingMode = 'off' | '1/12' | '1/6' | '1/3'

const MODE_OCTAVES: Record<Exclude<SmoothingMode, 'off'>, number> = {
  '1/12': 1 / 12,
  '1/6': 1 / 6,
  '1/3': 1 / 3,
}

/** fallback bin width when no bin frequencies are available (the daemon
 * maps ~11 octaves into the buckets) */
const SPAN_OCTAVES_FALLBACK = 11

/**
 * Apply fractional-octave smoothing to dB spectrum bins.
 *
 * @param binOctaves width of one bucket in octaves; when omitted it is
 *        approximated from the bucket count (log-spaced over ~11 octaves)
 */
export function smoothDbBins(binsDb: number[], mode: SmoothingMode, binOctaves?: number): number[] {
  if (mode === 'off' || binsDb.length === 0) {
    return binsDb
  }

  const binOct = binOctaves ?? SPAN_OCTAVES_FALLBACK / Math.max(1, binsDb.length - 1)
  const windowSize = kernelHalfWidth(mode, binOct)

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
 * Kernel half-width in BINS for a smoothing mode at a given bin width.
 * The octave math is exact on fine buckets (128 bins: 1/12->k1, 1/6->k2,
 * 1/3->k4); on coarse buckets (32 bins ~1/3 oct each) the exact result
 * would collapse every mode to the same no-op kernel, so a floor ladder
 * keeps the three modes visually distinct (1/2/4 bins = ~0.3/0.7/1.4 oct).
 */
const KERNEL_FLOOR: Record<Exclude<SmoothingMode, 'off'>, number> = {
  '1/12': 1,
  '1/6': 2,
  '1/3': 4,
}

export function kernelHalfWidth(mode: SmoothingMode, binOctaves: number): number {
  if (mode === 'off') return 0
  const exact = Math.round(MODE_OCTAVES[mode] / Math.max(1e-6, binOctaves))
  return Math.max(KERNEL_FLOOR[mode], exact)
}
