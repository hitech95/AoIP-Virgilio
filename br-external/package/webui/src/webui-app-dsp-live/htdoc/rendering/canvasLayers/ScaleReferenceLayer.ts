/**
 * Scale Reference Layer
 *
 * Absolute-amplitude references for the spectrum, drawn last so labels
 * stay readable. Line/labels use the TAP color family so they read as
 * part of the FFT graphics (pre = blues, post = greens); the window
 * label uses a theme-aware neutral tone.
 *
 * - "0 dBFS" dotted line: at offset 0 it sits near the top (6 dB of
 *   headroom above it). The Scale/OFFSET slider (−12…+12) moves the
 *   whole window — and this line — up or down. Pinned to an edge with
 *   an arrow when pushed outside.
 * - window label (top-left): the visible dBFS range, e.g. "+6…−60 dBFS",
 *   derived directly from the offset slider value.
 */

import type { CanvasVisualizationLayer, SpectrumVizMode } from './types'
import { toDisplayNorm, windowTopDbfs, windowBottomDbfs, clamp01 } from './palette'

export interface ScaleReferenceLayerConfig {
  enabled: boolean
  /** user FFT window offset (dB), as configured in the Spectrum section */
  scaleDb: number
}

const EDGE = 0.02

const TAP_COLORS: Record<SpectrumVizMode, { line: string; text: string }> = {
  pre: { line: 'rgba(140, 180, 255, 0.55)', text: 'rgba(150, 190, 255, 0.95)' },
  post: { line: 'rgba(150, 255, 210, 0.55)', text: 'rgba(160, 255, 215, 0.95)' },
}

function neutralText(): string {
  const dark = typeof document !== 'undefined'
    && document.documentElement.classList.contains('dark')
  return dark ? 'rgba(205, 212, 222, 0.75)' : 'rgba(52, 58, 68, 0.85)'
}

function fmtDb(v: number): string {
  return `${v > 0 ? '+' : ''}${Math.round(v)}`
}

export class ScaleReferenceLayer implements CanvasVisualizationLayer {
  public readonly id = 'spectrum-scale'
  private config: ScaleReferenceLayerConfig

  constructor(config: Partial<ScaleReferenceLayerConfig> = {}) {
    this.config = {
      enabled: true,
      scaleDb: 0,
      ...config,
    }
  }

  setConfig(config: Partial<ScaleReferenceLayerConfig>): void {
    this.config = { ...this.config, ...config }
  }

  render(args: {
    ctx: CanvasRenderingContext2D
    width: number
    height: number
    binsNormalized: number[]
    mode: SpectrumVizMode
  }): void {
    if (!this.config.enabled) return

    const { ctx, width, height, mode } = args
    const offset = this.config.scaleDb
    const tap = TAP_COLORS[mode] ?? TAP_COLORS.pre

    ctx.font = '12px system-ui'
    ctx.textAlign = 'left'

    /* window label: the visible dBFS range, straight from the offset value */
    ctx.fillStyle = neutralText()
    ctx.fillText(
      `${fmtDb(windowTopDbfs(offset))}\u2026${fmtDb(windowBottomDbfs(offset))} dBFS`,
      6,
      16
    )

    /* 0 dBFS dotted line — pinned to an edge (with an arrow) when the
     * offset pushes it outside the window */
    /* norm uses the loud-up convention (1 = window top): a norm > 1 means
     * the reference sits ABOVE the window, < 0 below the floor */
    const norm0 = toDisplayNorm(0, offset)
    let y0: number
    if (norm0 > 1 + EDGE) {
      y0 = 0.5
    } else if (norm0 < -EDGE) {
      y0 = height - 0.5
    } else {
      y0 = Math.round((1 - clamp01(norm0)) * height) + 0.5
    }
    const dark = typeof document !== 'undefined' && document.documentElement.classList.contains('dark')
    ctx.strokeStyle = dark ? tap.line : mode === 'post' ? 'rgba(24, 120, 82, 0.65)' : 'rgba(45, 99, 170, 0.65)'
    ctx.lineWidth = 1
    ctx.setLineDash([2, 3])
    ctx.beginPath()
    ctx.moveTo(0, y0)
    ctx.lineTo(width, y0)
    ctx.stroke()
    ctx.setLineDash([])
    // Inset ruler overlays the spectrum: it reserves no plot width and is
    // cleared with the canvas when the analyzer is disabled.
    ctx.save()
    ctx.textBaseline = 'middle'
    for (const db of [0, -12, -24, -36, -48, -60]) {
      const norm = toDisplayNorm(db, offset)
      if (db !== 0 && (norm < 0 || norm > 1)) continue
      const pinned = norm > 1 || norm < 0
      const tickY = (1 - clamp01(norm)) * height
      const label = db === 0 ? `0 dBFS${norm > 1 ? ' ↑' : norm < 0 ? ' ↓' : ''}` : `${db}`
      const labelY = pinned && norm > 1 ? 34 : Math.max(34, Math.min(height - 9, tickY))
      ctx.font = `${db === 0 ? '600 ' : ''}12px system-ui`
      const labelWidth = ctx.measureText(label).width
      // Small neutral backing keeps text legible over bars and any fill mode.
      ctx.fillStyle = dark ? 'rgba(30, 35, 45, 0.8)' : 'rgba(245, 247, 250, 0.85)'
      ctx.fillRect(4, labelY - 8, labelWidth + 6, 16)
      ctx.fillStyle = neutralText()
      ctx.fillText(label, 7, labelY)
      ctx.strokeStyle = db === 0
        ? dark ? tap.line : mode === 'post' ? 'rgba(24, 120, 82, 0.65)' : 'rgba(45, 99, 170, 0.65)'
        : dark ? 'rgba(205, 212, 222, 0.4)' : 'rgba(52, 58, 68, 0.35)'
      ctx.beginPath()
      ctx.moveTo(0, tickY)
      ctx.lineTo(4, tickY)
      ctx.stroke()
    }
    ctx.restore()
  }
}
