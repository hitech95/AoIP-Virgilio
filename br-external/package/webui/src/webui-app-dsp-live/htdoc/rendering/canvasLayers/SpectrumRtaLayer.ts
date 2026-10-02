/**
 * Spectrum RTA Layer
 *
 * Renders the spectrum graph as BARS: one solid bar per FFT bucket,
 * the whole bar colored by its level (no vertical gradient).
 *
 * - heatmap ON  -> the shared blue->green->orange->red level scale
 *                  (red = last ~3 dB below clipping, plan D3)
 * - heatmap OFF -> the tap color family (pre = blues, post = greens)
 *
 * Bars are placed through the daemon-reported bin center frequencies on the
 * plot's log axis; width = 0.9 x the smallest gap to the adjacent centers
 * (log-domain midpoints). A baseline stroke plus bin-center ticks (when the
 * bucket count is readable) keep the bars visually aligned with the X axis.
 * Peak crests are independent of the bar gate and decay to the plot floor.
 */

import type { CanvasVisualizationLayer, SpectrumVizMode } from './types'
import type { SpectrumFreqAxis } from './freqAxis'
import { binToX, binToXWithFreqs, freqToLogX } from './freqAxis'
import {
  BAR_RAMP,
  TAP_RAMPS,
  sampleRamp,
  rgba,
  clamp01,
  displayNormToColorNorm,
  DEFAULT_HEATMAP_ALPHA_TUNING,
  SCALE_SPAN_DB,
  windowBottomDbfs,
  type HeatmapAlphaTuning,
} from './palette'

export interface RtaLayerConfig {
  enabled: boolean
  /** heatmap active: bars use the level scale instead of the tap family */
  heatmapActive: boolean
  offsetDb: number
  /** peak envelope of the selected series (normalized like the bars) */
  peakSeries: number[] | null
  /** draw the peak crest markers */
  showPeak: boolean
  /** gate shared with the heatmap tuning */
  tuning: HeatmapAlphaTuning
}

const BAR_FILL = 0.9
const CREST_HEIGHT = 2

export class SpectrumRtaLayer implements CanvasVisualizationLayer {
  public readonly id = 'spectrum-rta'
  private config: RtaLayerConfig

  constructor(config: Partial<RtaLayerConfig> = {}) {
    this.config = {
      enabled: false,
      heatmapActive: true,
      offsetDb: 0,
      peakSeries: null,
      showPeak: true,
      tuning: DEFAULT_HEATMAP_ALPHA_TUNING,
      ...config,
    }
  }

  setConfig(config: Partial<RtaLayerConfig>): void {
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

    const { ctx, width, height, binsNormalized, freqAxis, binFreqs } = args
    if (!binsNormalized || binsNormalized.length === 0) return

    const n = binsNormalized.length
    const ramp = this.config.heatmapActive ? BAR_RAMP : TAP_RAMPS[args.mode]
    const gate = this.config.tuning.gateThreshold
    const dark = typeof document !== 'undefined' &&
      document.documentElement.classList.contains('dark')
    const crestColor = dark ? 'rgba(255, 228, 160, 1)' : 'rgba(116, 65, 0, 1)'
    const crestOutline = dark ? 'rgba(30, 35, 45, 0.95)' : 'rgba(255, 255, 255, 0.95)'

    const xOf = (i: number): number =>
      freqAxis && binFreqs
        ? binToXWithFreqs(i, binFreqs, width, freqAxis)
        : freqAxis
          ? binToX(i, n, width, freqAxis)
          : (i / Math.max(1, n - 1)) * width

    for (let i = 0; i < n; i++) {
      /* skip bins outside the visible axis span (clipped display range) */
      if (freqAxis && binFreqs) {
        const f = binFreqs[i]
        if (f == null || f < freqAxis.minHz || f > freqAxis.maxHz) continue
      }

      const x = xOf(i)
      const gapL = i > 0 ? x - xOf(i - 1) : n > 1 ? xOf(1) - x : 8
      const gapR = i < n - 1 ? xOf(i + 1) - x : gapL
      const bw = Math.max(1, Math.min(gapL, gapR) * BAR_FILL)
      const bx = x - bw / 2

      const mag = clamp01(binsNormalized[i])
      const db = windowBottomDbfs(this.config.offsetDb) + binsNormalized[i] * SCALE_SPAN_DB
      if (mag > 0 && db >= gate) {
        const bh = mag * height
        const intensity = this.config.heatmapActive
          ? clamp01(displayNormToColorNorm(binsNormalized[i], this.config.offsetDb)
              * this.config.tuning.magnitudeGain)
          : mag
        // Gain controls palette sensitivity relative to neutral 1×.
        // Max alpha independently controls uniform opacity; height is untouched.
        const alpha = this.config.heatmapActive
          ? clamp01(this.config.tuning.maxAlpha)
          : 0.95
        ctx.fillStyle = rgba(sampleRamp(ramp, intensity), alpha)
        ctx.fillRect(bx, height - bh, bw, bh)
      }

      if (this.config.showPeak && this.config.peakSeries) {
        const pm = clamp01(this.config.peakSeries[i] ?? 0)
        // Hold/decay survives a gated or silent live bin. Hide only when
        // the envelope reaches the floor, not when it crosses the bar gate.
        if (pm > 0 && pm >= mag) {
          const y = Math.max(0, height - pm * height - CREST_HEIGHT)
          ctx.fillStyle = crestOutline
          ctx.fillRect(bx - 1, Math.max(0, y - 1), bw + 2, CREST_HEIGHT + 2)
          ctx.fillStyle = crestColor
          ctx.fillRect(bx, y, bw, CREST_HEIGHT)
        }
      }
    }

    this.drawBaseline(ctx, width, height, n, freqAxis, binFreqs)
  }

  /** baseline + bin-center ticks so the bars read as anchored to the X axis */
  private drawBaseline(
    ctx: CanvasRenderingContext2D,
    width: number,
    height: number,
    n: number,
    freqAxis?: SpectrumFreqAxis,
    binFreqs?: number[]
  ): void {
    ctx.strokeStyle = 'rgba(140, 150, 160, 0.55)'
    ctx.lineWidth = 1
    ctx.beginPath()
    ctx.moveTo(0, height - 0.5)
    ctx.lineTo(width, height - 0.5)
    ctx.stroke()

    /* tick each bar center only while the count stays readable */
    if (n > 64 || !freqAxis || !binFreqs) return
    ctx.strokeStyle = 'rgba(140, 150, 160, 0.8)'
    ctx.beginPath()
    for (let i = 0; i < n; i++) {
      const f = binFreqs[i]
      if (f == null || f < freqAxis.minHz || f > freqAxis.maxHz) continue
      const x = Math.round(freqToLogX(f, width, freqAxis)) + 0.5
      ctx.moveTo(x, height - 1)
      ctx.lineTo(x, height - 5)
    }
    ctx.stroke()
  }
}
