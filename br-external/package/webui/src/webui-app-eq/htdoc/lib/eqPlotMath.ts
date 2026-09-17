/**
 * EQ Plot Math Utilities
 * Shared coordinate mapping, tick generation, and formatting for the EQ plot
 * (ported from CamillaEQ src/pages/eq/plot/eqPlotMath.ts)
 */

// ===== COORDINATE MAPPING =====

/**
 * Map frequency to X coordinate (base-10 logarithmic)
 */
export function freqToX(freq: number, width: number): number {
  const fMin = 10
  const fMax = 30000
  const xNorm = (Math.log10(freq) - Math.log10(fMin)) / (Math.log10(fMax) - Math.log10(fMin))
  return xNorm * width
}

/**
 * Map X coordinate to frequency (inverse of freqToX)
 */
export function xToFreq(x: number, width: number): number {
  const fMin = 10
  const fMax = 30000
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
export function generateFrequencyTicks(): { majors: number[]; minors: number[] } {
  const majors: number[] = []
  const minors: number[] = []

  for (let exp = 1; exp <= 4; exp++) {
    const decade = Math.pow(10, exp)
    for (let k = 1; k <= 9; k++) {
      const freq = k * decade
      if (freq >= 10 && freq <= 30000) {
        if (k === 1 || k === 2 || k === 5) {
          majors.push(freq)
        } else {
          minors.push(freq)
        }
      }
    }
  }
  // Add 10 as starting major and 30k as closing major
  if (!majors.includes(10)) majors.unshift(10)
  if (!majors.includes(30000)) majors.push(30000)

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

// ===== OCTAVE/REGION WIDTHS =====

/**
 * Calculate octave column widths (musical C starting frequencies)
 * Pre-C1 spacer (10->32.70), C1...C9, Post-C9 spacer (8372.02->30000)
 */
export function calcOctaveWidths(): number[] {
  const octaveFreqs = [32.7, 65.41, 130.81, 261.63, 523.25, 1046.5, 2093.0, 4186.01, 8372.02]
  const widths: number[] = []
  widths.push(Math.log10(octaveFreqs[0]) - Math.log10(10)) // pre-spacer
  for (let i = 0; i < octaveFreqs.length; i++) {
    const end = i < octaveFreqs.length - 1 ? octaveFreqs[i + 1] : octaveFreqs[i] * 2
    widths.push(Math.log10(end) - Math.log10(octaveFreqs[i]))
  }
  widths.push(Math.log10(30000) - Math.log10(octaveFreqs[octaveFreqs.length - 1] * 2)) // post-spacer
  return widths
}

/**
 * Calculate region column widths (explicit frequency boundaries)
 */
export function calcRegionWidths(): number[] {
  const regionBoundaries = [10, 60, 250, 500, 2000, 4000, 6000, 30000]
  const widths: number[] = []
  for (let i = 0; i < regionBoundaries.length - 1; i++) {
    widths.push(Math.log10(regionBoundaries[i + 1]) - Math.log10(regionBoundaries[i]))
  }
  return widths
}
