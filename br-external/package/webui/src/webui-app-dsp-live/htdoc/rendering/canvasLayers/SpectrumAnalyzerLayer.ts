/**
 * Spectrum Analyzer Layer
 * Renders multiple analyzer series: Live, STA, LTA, Peak Hold
 * (ported from CamillaEQ src/ui/rendering/canvasLayers/SpectrumAnalyzerLayer.ts)
 */

import type { CanvasVisualizationLayer, SpectrumVizMode } from './types'
import type { SpectrumFreqAxis } from './freqAxis'
import { binToX, binToXWithFreqs } from './freqAxis'

export interface AnalyzerSeries {
  liveNorm: number[] | null
  staNorm: number[] | null
  ltaNorm: number[] | null
  peakNorm: number[] | null
}

export interface AnalyzerLayerConfig {
  showLive: boolean
  showSTA: boolean
  showLTA: boolean
  showPeak: boolean
}

export class SpectrumAnalyzerLayer implements CanvasVisualizationLayer {
  public readonly id = 'spectrum-analyzer'
  private config: AnalyzerLayerConfig
  private series: AnalyzerSeries

  // Colors for pre/post modes. The peak hold uses the warning orange of
  // its chip so the dashed line stays readable against the blue/green
  // averages (it used to be a faint blue dash hugging the STA curve).
  private readonly colors = {
    pre: {
      live: { stroke: 'rgba(120, 160, 255, 0.35)', width: 1.0 },
      sta: { stroke: 'rgba(140, 180, 255, 0.85)', width: 2.0 },
      lta: { stroke: 'rgba(160, 200, 255, 0.65)', width: 1.5 },
      peak: { stroke: 'rgba(255, 176, 32, 0.95)', width: 1.6, dash: [5, 4] },
    },
    post: {
      live: { stroke: 'rgba(120, 255, 190, 0.30)', width: 1.0 },
      sta: { stroke: 'rgba(150, 255, 210, 0.80)', width: 2.0 },
      lta: { stroke: 'rgba(170, 255, 220, 0.60)', width: 1.5 },
      peak: { stroke: 'rgba(255, 176, 32, 0.95)', width: 1.6, dash: [5, 4] },
    },
  }

  constructor(config: Partial<AnalyzerLayerConfig> = {}) {
    this.config = {
      showLive: false,
      showSTA: true, // Default ON per spec
      showLTA: false,
      showPeak: false,
      ...config,
    }
    this.series = {
      liveNorm: null,
      staNorm: null,
      ltaNorm: null,
      peakNorm: null,
    }
  }

  setSeries(series: Partial<AnalyzerSeries>): void {
    this.series = { ...this.series, ...series }
  }

  setConfig(config: Partial<AnalyzerLayerConfig>): void {
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
    const { ctx, width, height, mode, freqAxis, binFreqs } = args
    const colors = this.colors[mode]

    // Draw in order: Live (faintest) -> LTA -> STA (brightest) -> Peak (dotted)
    if (this.config.showLive && this.series.liveNorm) {
      this.drawLine(ctx, this.series.liveNorm, width, height, colors.live.stroke, colors.live.width, undefined, freqAxis, binFreqs)
    }

    if (this.config.showLTA && this.series.ltaNorm) {
      this.drawLine(ctx, this.series.ltaNorm, width, height, colors.lta.stroke, colors.lta.width, undefined, freqAxis, binFreqs)
    }

    if (this.config.showSTA && this.series.staNorm) {
      this.drawLine(ctx, this.series.staNorm, width, height, colors.sta.stroke, colors.sta.width, undefined, freqAxis, binFreqs)
    }

    if (this.config.showPeak && this.series.peakNorm) {
      this.drawLine(
        ctx,
        this.series.peakNorm,
        width,
        height,
        colors.peak.stroke,
        colors.peak.width,
        colors.peak.dash,
        freqAxis,
        binFreqs
      )
    }
  }

  private drawLine(
    ctx: CanvasRenderingContext2D,
    bins: number[],
    width: number,
    height: number,
    strokeColor: string,
    lineWidth: number,
    dash?: number[],
    freqAxis?: SpectrumFreqAxis,
    binFreqs?: number[]
  ): void {
    if (!bins || bins.length === 0) return

    ctx.strokeStyle = strokeColor
    ctx.lineWidth = lineWidth

    if (dash) {
      ctx.setLineDash(dash)
    } else {
      ctx.setLineDash([])
    }

    ctx.beginPath()

    let started = false
    for (let i = 0; i < bins.length; i++) {
      /* on the log axis, bins past the right edge (Nyquist above the
       * axis max) and below its left edge (DC) have no column: skip
       * them instead of clamping into a pile-up */
      if (freqAxis) {
        const f = binFreqs
          ? binFreqs[i]
          : (i / Math.max(1, bins.length - 1)) * freqAxis.nyquistHz
        if (f == null || f > freqAxis.maxHz) break
        if (f < freqAxis.minHz) continue
      }
      const magnitude = Math.max(0, Math.min(1, bins[i]))
      /* the plot X axis is log-frequency: map the bin through it (from
       * the daemon-reported center frequency when available) so the
       * curves line up with the grid -- uniform-in-index drawing
       * stretches the log-spaced bins and shifts mid-band content */
      const x = freqAxis
        ? (binFreqs ? binToXWithFreqs(i, binFreqs, width, freqAxis)
                    : binToX(i, bins.length, width, freqAxis))
        : (i / (bins.length - 1)) * width
      const y = height - magnitude * height

      if (!started) {
        ctx.moveTo(x, y)
        started = true
      } else {
        ctx.lineTo(x, y)
      }
    }

    ctx.stroke()
    ctx.setLineDash([])
  }
}
