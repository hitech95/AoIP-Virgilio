/**
 * Frequency-axis mapping for the spectrum canvas layers.
 *
 * The plot X axis is LOGARITHMIC (10 Hz .. Nyquist-capped max, same
 * mapping as eqPlotMath.freqToX). The camilladsp analyzer serves
 * LOG-SPACED bins whose span is narrower than the axis (f_lo =
 * one FFT bin .. f_hi = Nyquist - bin/2): when the daemon-reported
 * center frequencies are available they are the authoritative
 * bin -> X mapping; the fallback is for linear FFT bins over
 * 0..Nyquist (the legacy linear-in-index drawing stretched the log span
 * onto the full axis and shifted mid-band content by up to an octave,
 * reading as bogus subsonic activity).
 */

export interface SpectrumFreqAxis {
  /** left edge of the plot axis (10 Hz) */
  minHz: number
  /** right edge of the plot axis (usually min(30 kHz, Nyquist)) */
  maxHz: number
  /** frequency of the LAST FFT bin (sample rate / 2) */
  nyquistHz: number
}

/** pixel X of an FFT bin index on the log axis */
export function binToX(i: number, numBins: number, width: number, axis: SpectrumFreqAxis): number {
  const freq = (i / Math.max(1, numBins - 1)) * axis.nyquistHz
  return freqToLogX(freq, width, axis)
}

/**
 * pixel X of FFT bin i when the daemon reports the bin center
 * frequencies (camilladsp GetSpectrumLevels: log-spaced bins whose span
 * is narrower than the plot axis -- placing them uniformly stretches
 * the spectrum and shifts mid-band content by up to an octave)
 */
export function binToXWithFreqs(
  i: number,
  binFreqs: number[],
  width: number,
  axis: SpectrumFreqAxis
): number {
  return freqToLogX(binFreqs[i] ?? axis.minHz, width, axis)
}

/** pixel X of a frequency on the log axis (clamped to [0, width]) */
export function freqToLogX(freq: number, width: number, axis: SpectrumFreqAxis): number {
  const lmin = Math.log(axis.minHz)
  const lmax = Math.log(axis.maxHz)
  const t = (Math.log(Math.max(freq, axis.minHz)) - lmin) / (lmax - lmin)
  return Math.max(0, Math.min(1, t)) * width
}

/** FFT bin index (float, interpolate between bins) under a pixel column */
export function binAtX(x: number, numBins: number, width: number, axis: SpectrumFreqAxis): number {
  const lmin = Math.log(axis.minHz)
  const lmax = Math.log(axis.maxHz)
  const t = Math.max(0, Math.min(1, x / width))
  const freq = Math.exp(lmin + t * (lmax - lmin))
  const i = (freq / axis.nyquistHz) * Math.max(1, numBins - 1)
  return Math.max(0, Math.min(numBins - 1, i))
}

/**
 * Inverse of binToXWithFreqs: the bin index (float) whose center
 * frequency falls under the pixel column. binFreqs must be ascending.
 */
export function binAtXWithFreqs(
  x: number,
  binFreqs: number[],
  width: number,
  axis: SpectrumFreqAxis
): number {
  const n = binFreqs.length
  if (!n) return 0
  const lmin = Math.log(axis.minHz)
  const lmax = Math.log(axis.maxHz)
  const t = Math.max(0, Math.min(1, x / width))
  const freq = Math.exp(lmin + t * (lmax - lmin))
  if (freq <= binFreqs[0]) return 0
  if (freq >= binFreqs[n - 1]) return n - 1
  let lo = 0
  let hi = n - 1
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1
    if (binFreqs[mid] <= freq) lo = mid
    else hi = mid
  }
  // Curves connect centers linearly in log-X. Use the same interpolation
  // for their fill so it does not bow away from the visible curve.
  const span = Math.log(binFreqs[hi] / binFreqs[lo])
  return span > 0 ? lo + Math.log(freq / binFreqs[lo]) / span : lo
}
