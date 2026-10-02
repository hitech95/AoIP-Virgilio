/**
 * Spectrum Heatmap Layer (curve modes)
 *
 * Renders the spectrum fill as one column per pixel-x with UNIFORM
 * color+alpha derived from the strength of the bucket under that column
 * (original CamillaEQ renderFullHeatmap model: a single fillRect per
 * column — vertical position carries no opacity information).
 *
 * Color comes from the tap family (pre = blues, post = greens); opacity
 * follows the bucket strength through the original tuning chain
 * (see palette.heatmapAlpha). Fill styles:
 * - 'under': from the curve down to the baseline (default)
 * - 'above': fill from the top down to the curve
 * - 'background': full-height column
 */

import type { CanvasVisualizationLayer, SpectrumVizMode } from './types'
import type { SpectrumFreqAxis } from './freqAxis'
import { binAtX, binAtXWithFreqs } from './freqAxis'
import {
  TAP_RAMPS,
  sampleRamp,
  rgba,
  clamp01,
  heatmapAlpha,
  DEFAULT_HEATMAP_ALPHA_TUNING,
  type HeatmapAlphaTuning,
} from './palette'

export type HeatmapFillMode = 'under' | 'above' | 'background'

/** @deprecated legacy name (persisted values are migrated to fill modes) */
export type HeatmapMaskMode = HeatmapFillMode

export interface HeatmapLayerConfig {
  enabled: boolean
  fillMode: HeatmapFillMode
  tuning: HeatmapAlphaTuning
  offsetDb: number
}

export class SpectrumHeatmapLayer implements CanvasVisualizationLayer {
  public readonly id = 'spectrum-heatmap'
  private config: HeatmapLayerConfig

  constructor(config: Partial<HeatmapLayerConfig> = {}) {
    this.config = {
      enabled: false,
      fillMode: 'under',
      tuning: DEFAULT_HEATMAP_ALPHA_TUNING,
      offsetDb: 0,
      ...config,
    }
  }

  setConfig(config: Partial<HeatmapLayerConfig>): void {
    this.config = { ...this.config, ...config }
  }

  render(args: {
    ctx: CanvasRenderingContext2D
    width: number
    height: number
    binsNormalized: number[]
    mode: SpectrumVizMode
    freqAxis?: SpectrumFreqAxis
    binFreqs?: number[]
  }): void {
    if (!this.config.enabled) return

    const { ctx, width, height, binsNormalized, mode, freqAxis, binFreqs } = args
    if (!binsNormalized || binsNormalized.length === 0) return

    const ramp = TAP_RAMPS[mode]
    const tuning = this.config.tuning

    for (let x = 0; x < width; x++) {
      /* bin (float) under this pixel column, from the daemon-reported
       * frequencies when available; the inverse mapping keeps the log-spaced
       * bins glued to the plot's log axis. Fallbacks assume a uniform-log
       * bin grid (legacy) so the layer still draws without them. */
      const f =
        freqAxis && binFreqs
          ? binAtXWithFreqs(x, binFreqs, width, freqAxis)
          : freqAxis
            ? binAtX(x, binsNormalized.length, width, freqAxis)
            : (x / Math.max(1, width - 1)) * (binsNormalized.length - 1)

      const i0 = Math.floor(f)
      const i1 = Math.min(binsNormalized.length - 1, i0 + 1)
      const t = f - i0
      const rawStrength = binsNormalized[i0] * (1 - t) + binsNormalized[i1] * t
      const strength = clamp01(rawStrength)

      const alpha = heatmapAlpha(rawStrength, tuning, this.config.offsetDb)
      if (alpha <= 0) continue

      const color = sampleRamp(ramp, Math.pow(strength, 1.2))
      const curveY = height - strength * height
      // Fill mode changes geometry only, never the column color/opacity.
      ctx.fillStyle = rgba(color, alpha)

      if (this.config.fillMode === 'background') {
        ctx.fillRect(x, 0, 1, height)
      } else if (this.config.fillMode === 'under') {
        ctx.fillRect(x, curveY, 1, height - curveY)
      } else {
        // 'above'
        ctx.fillRect(x, 0, 1, curveY)
      }
    }
  }
}
