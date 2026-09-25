/**
 * EQ Plot Math Utilities
 * Shared coordinate mapping, tick generation, and formatting for the EQ plot
 * (ported from CamillaEQ src/pages/eq/plot/eqPlotMath.ts)
 */

// ===== COORDINATE MAPPING =====

/**
 * Map frequency to X coordinate (base-10 logarithmic) over 10 Hz..fMax.
 */
export function freqToX(freq: number, width: number, fMax = 30000): number {
  const fMin = 10
  const xNorm = (Math.log10(freq) - Math.log10(fMin)) / (Math.log10(fMax) - Math.log10(fMin))
  return xNorm * width
}

/**
 * General form with an explicit frequency range (the SVG curve renderer
 * and the focus fills sample arbitrary ranges).
 */
export function freqToXRange(freq: number, width: number, freqMin = 10, freqMax = 30000): number {
  const xNorm = (Math.log10(freq) - Math.log10(freqMin)) / (Math.log10(freqMax) - Math.log10(freqMin))
  return xNorm * width
}

/**
 * Map gain (dB) to Y on an explicit range (linear scale, inverted for SVG).
 */
export function gainToYRange(gainDb: number, height: number, gainMin = -24, gainMax = 24): number {
  const gainRange = gainMax - gainMin
  const normalized = (gainMax - gainDb) / gainRange
  return normalized * height
}

/**
 * Map X coordinate to frequency (inverse of freqToX)
 */
export function xToFreq(x: number, width: number, fMax = 30000): number {
  const fMin = 10
  const xNorm = x / width
  const logFreq = xNorm * (Math.log10(fMax) - Math.log10(fMin)) + Math.log10(fMin)
  return Math.pow(10, logFreq)
}

/**
 * Map gain to Y coordinate (linear, inverted for SVG)
 */
export function gainToY(gain: number): number {
  const gainRange = 48 // -24 to +24
  return 200 - (gain / gainRange) * 400
}

/**
 * Map Y coordinate to gain (inverse of gainToY)
 */
export function yToGain(y: number): number {
  const gainRange = 48
  return ((200 - y) / 400) * gainRange
}

/**
 * Calculate Y position for gain labels as percentage
 */
export function gainToYPercent(gain: number): number {
  return (1 - (gain + 24) / 48) * 100
}

// ===== TICK GENERATION =====

/**
 * Generate decade-based frequency ticks per spec
 * For each decade 10^n, draw lines at k * 10^n for k in {1..9}
 * Treat k in {1,2,5} as "major", others as "minor"
 */
export function generateFrequencyTicks(fMax = 30000): { majors: number[]; minors: number[] } {
  const majors: number[] = []
  const minors: number[] = []

  for (let exp = 1; exp <= 4; exp++) {
    const decade = Math.pow(10, exp)
    for (let k = 1; k <= 9; k++) {
      const freq = k * decade
      if (freq >= 10 && freq <= fMax) {
        if (k === 1 || k === 2 || k === 5) {
          majors.push(freq)
        } else {
          minors.push(freq)
        }
      }
    }
  }
  // Add exact endpoints, including non-standard Nyquist values (e.g. 24k).
  if (!majors.includes(10)) majors.unshift(10)
  if (!majors.includes(fMax)) majors.push(fMax)

  return { majors, minors }
}

/**
 * Format frequency for display
 */
export function formatFreq(freq: number): string {
  if (freq >= 1000) {
    const k = freq / 1000
    return k % 1 === 0 ? `${k}k` : `${k.toFixed(1)}k`
  }
  return `${freq}`
}

// ===== OCTAVE/REGION STRIP SEGMENTS =====

export interface PlotSegment {
  label: string
  f1: number
  f2: number
  spacer?: boolean
}

const OCTAVE_FREQS = [32.7, 65.41, 130.81, 261.63, 523.25, 1046.5, 2093.0, 4186.01, 8372.02]

/**
 * Octave strip segments in frequency space: pre-C1 spacer (10->32.70),
 * C1..C9, post-C9 spacer down to fMax. Cells at or beyond fMax (Nyquist
 * at low sample rates) are dropped and the last one is clamped, so the
 * strip always ends exactly at the plot's right edge.
 */
export function octaveSegments(fMax = 30000): PlotSegment[] {
  if (fMax <= 10) return []
  const first = OCTAVE_FREQS[0]
  const segs: PlotSegment[] = []
  if (first > fMax) return [{ label: '', f1: 10, f2: fMax, spacer: true }]
  segs.push({ label: '', f1: 10, f2: first, spacer: true })
  for (let i = 0; i < OCTAVE_FREQS.length; i++) {
    const f1 = OCTAVE_FREQS[i]
    if (f1 >= fMax) break
    const end = i < OCTAVE_FREQS.length - 1 ? OCTAVE_FREQS[i + 1] : f1 * 2
    segs.push({ label: `C${i + 1}`, f1, f2: Math.min(end, fMax) })
  }
  const lastEnd = segs[segs.length - 1].f2
  if (lastEnd < fMax) segs.push({ label: '', f1: lastEnd, f2: fMax, spacer: true })
  return segs
}

/**
 * Frequency-region strip segments; the last boundary is fMax so the
 * TREBLE cell always ends with the plot.
 */
export function regionSegments(fMax = 30000): PlotSegment[] {
  const bounds = [10, 60, 250, 500, 2000, 4000, 6000, fMax]
  const labels = ['SUB', 'BASS', 'LOW MID', 'MID', 'HIGH MID', 'PRS', 'TREBLE']
  const segs: PlotSegment[] = []
  for (let i = 0; i < labels.length; i++) {
    if (bounds[i] >= fMax) break
    segs.push({ label: labels[i], f1: bounds[i], f2: Math.min(bounds[i + 1], fMax) })
  }
  return segs
}
