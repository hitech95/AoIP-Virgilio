/**
 * Shared palette + scale mapping for the spectrum visualization layers.
 *
 * - BAR_RAMP: absolute dBFS level colors for RTA bars (heatmap on),
 *   independent of window offset; red starts around −3 dBFS.
 * - TAP_RAMPS: pre/post color families (heatmap off, and the curve-mode fill).
 * - toDisplayNorm: the single Y mapping shared by bars, curves,
 *   fill and crest markers (fixed absolute dBFS scale).
 * - heatmapAlpha: original CamillaEQ opacity chain (verified against the
 *   camillaeq-0.1.5 sources): magnitude gain, soft-knee gate, gamma, max alpha.
 */

export type ColorStop = [number, [number, number, number]]

export const BAR_RAMP: ColorStop[] = [
  [0.0, [22, 58, 180]], // −60 dBFS deep blue
  [0.5, [35, 65, 235]], // −30 dBFS blue
  [0.6, [25, 170, 225]], // −24 dBFS cyan
  [0.7, [35, 205, 85]], // −18 dBFS green
  [0.85, [80, 220, 40]], // −9 dBFS still green
  [0.9, [250, 150, 40]], // −6 dBFS orange
  [0.95, [235, 60, 45]], // −3 dBFS red
  [1.0, [190, 25, 25]], // 0 dBFS deep red
]

export const TAP_RAMPS: Record<'pre' | 'post', ColorStop[]> = {
  pre: [
    [0, [22, 42, 74]],
    [1, [140, 180, 255]],
  ],
  post: [
    [0, [22, 64, 36]],
    [1, [118, 224, 134]],
  ],
}

export function clamp01(v: number): number {
  return Math.max(0, Math.min(1, v))
}

/** sample a color ramp at t in [0..1] (linear between stops) */
export function sampleRamp(stops: ColorStop[], t: number): [number, number, number] {
  t = clamp01(t)
  for (let i = 1; i < stops.length; i++) {
    if (t <= stops[i][0]) {
      const [t0, c0] = stops[i - 1]
      const [t1, c1] = stops[i]
      const k = (t - t0) / Math.max(1e-6, t1 - t0)
      return [
        c0[0] + k * (c1[0] - c0[0]),
        c0[1] + k * (c1[1] - c0[1]),
        c0[2] + k * (c1[2] - c0[2]),
      ]
    }
  }
  return [...stops[stops.length - 1][1]]
}

export function rgba(c: [number, number, number], alpha: number): string {
  return `rgba(${Math.round(c[0])}, ${Math.round(c[1])}, ${Math.round(c[2])}, ${alpha})`
}

/* ── Static Y mapping (plan D9, rev 12): the full plot height is a fixed
 * 66 dB window. At offset 0 it spans +6 dBFS (top) … −60 dBFS (bottom)
 * — 6 dB of headroom above full scale and room for real program material.
 * The user Scale/OFFSET slider (−12…+12 dB) moves the whole window and
 * with it the 0 dBFS reference line, up or down; the axis never moves on
 * its own. Absolute reading: dBFS = windowBottom + magnitude · 66. ── */

export const SCALE_SPAN_DB = 66
export const SCALE_HEADROOM_DB = 6
export const SCALE_OFFSET_MIN = -12
export const SCALE_OFFSET_MAX = 12

/** dBFS -> normalized bar/curve magnitude over the window.
 * CONVENTION: 1 = top of the window (loudest visible), 0 = bottom —
 * the loud-up convention every layer draws with (bar height, curve y,
 * crest, fill extent all do `height - mag*height`). Values above 1 sit
 * above the window top, below 0 under the floor; callers clamp. */
export function toDisplayNorm(db: number, offsetDb: number): number {
  return (db - windowBottomDbfs(offsetDb)) / SCALE_SPAN_DB
}

/** Absolute intensity for bar colors, independent of display offset. */
export function displayNormToColorNorm(magnitude: number, offsetDb: number): number {
  const db = windowBottomDbfs(offsetDb) + magnitude * SCALE_SPAN_DB
  return clamp01((db + 60) / 60)
}

/** dBFS at the top edge of the window for a given offset */
export function windowTopDbfs(offsetDb: number): number {
  return SCALE_HEADROOM_DB + offsetDb
}

export function windowBottomDbfs(offsetDb: number): number {
  return SCALE_HEADROOM_DB - SCALE_SPAN_DB + offsetDb
}

/* ── Heatmap opacity chain (original CamillaEQ, plan D3/V4) ─────────────── */

export interface HeatmapAlphaTuning {
  /** Relative visual gain (1 = neutral). */
  magnitudeGain: number
  /** Absolute visual threshold in dBFS. */
  gateThreshold: number
  gateSoftness: number
  /** opacity gamma (slider "Contrast", default 2.8) */
  alphaGamma: number
  /** maximum opacity (slider "Max α", default 0.95) */
  minAlpha: number
  maxAlpha: number
}

export const DEFAULT_HEATMAP_ALPHA_TUNING: HeatmapAlphaTuning = {
  magnitudeGain: 1,
  gateThreshold: -57,
  gateSoftness: 2,
  alphaGamma: 2.8,
  minAlpha: 0,
  maxAlpha: 0.95,
}

/**
 * Uniform per-column opacity from the bucket strength (normalized [0..1]).
 * The column's alpha is constant over its whole extent — vertical position
 * carries no opacity information (original renderFullHeatmap model).
 */
export function heatmapAlpha(strengthNorm: number, tuning: HeatmapAlphaTuning, offsetDb = 0): number {
  const db = windowBottomDbfs(offsetDb) + strengthNorm * SCALE_SPAN_DB
  const softness = Math.max(0, tuning.gateSoftness)
  if (db < tuning.gateThreshold - softness) return tuning.minAlpha
  const knee = softness > 0
    ? clamp01((db - tuning.gateThreshold + softness) / (2 * softness))
    : db >= tuning.gateThreshold ? 1 : 0
  // Preserve the original default 2.5 opacity multiplier behind neutral 1×.
  const m = clamp01(toDisplayNorm(db, 0) * tuning.magnitudeGain * 2.5) * knee
  return tuning.minAlpha + Math.pow(m, tuning.alphaGamma) * (tuning.maxAlpha - tuning.minAlpha)
}
