/**
 * Shared parameter clamping and rounding utilities for EQ editing
 * (ported from CamillaEQ src/lib/eqParamClamp.ts)
 */

/**
 * Clamp and round frequency to nearest Hz (0 decimals)
 * Range: 10-30000 Hz
 */
export function clampFreqHz(freq: number): number {
  return Math.round(Math.max(10, Math.min(30000, freq)))
}

/**
 * Clamp and round gain to 1 decimal
 * Range: -24 to +24 dB
 */
export function clampGainDb(gain: number): number {
  return Math.round(Math.max(-24, Math.min(24, gain)) * 10) / 10
}

/**
 * Clamp Q to range [0.1, 10] with 1 decimal precision
 */
export function clampQ(q: number): number {
  return Math.round(Math.max(0.1, Math.min(10, q)) * 10) / 10
}
