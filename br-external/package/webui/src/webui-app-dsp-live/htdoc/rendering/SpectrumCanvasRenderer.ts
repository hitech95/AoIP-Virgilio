/**
 * Spectrum Canvas Renderer
 * High-frequency rendering (~10Hz) with zero DOM churn
 * (ported from CamillaEQ src/ui/rendering/SpectrumCanvasRenderer.ts)
 */

import type { CanvasVisualizationLayer, SpectrumVizMode } from './canvasLayers/types'

export interface SpectrumRenderOptions {
  mode: SpectrumVizMode
}

export class SpectrumCanvasRenderer {
  private canvas: HTMLCanvasElement
  private ctx: CanvasRenderingContext2D
  private dpr: number = 1
  private widthCss: number = 0
  private heightCss: number = 0
  private layers: CanvasVisualizationLayer[] = []

  constructor(canvas: HTMLCanvasElement, layers: CanvasVisualizationLayer[] = []) {
    this.canvas = canvas
    const ctx = canvas.getContext('2d')
    if (!ctx) {
      throw new Error('Failed to get 2D context')
    }
    this.ctx = ctx
    this.dpr = window.devicePixelRatio || 1
    this.layers = layers
  }

  setLayers(layers: CanvasVisualizationLayer[]): void {
    this.layers = layers
  }

  getLayers(): CanvasVisualizationLayer[] {
    return this.layers
  }

  /**
   * Resize canvas to match CSS dimensions with proper DPR scaling
   */
  resize(widthCss: number, heightCss: number): void {
    this.widthCss = widthCss
    this.heightCss = heightCss

    this.canvas.width = widthCss * this.dpr
    this.canvas.height = heightCss * this.dpr

    this.canvas.style.width = `${widthCss}px`
    this.canvas.style.height = `${heightCss}px`

    // Reset transform and scale context to match DPR (prevents accumulation)
    this.ctx.setTransform(1, 0, 0, 1, 0, 0)
    this.ctx.scale(this.dpr, this.dpr)
  }

  /**
   * Render spectrum using all active layers
   */
  render(binsNormalized: number[], options: SpectrumRenderOptions): void {
    if (!binsNormalized || binsNormalized.length === 0) {
      this.clear()
      return
    }

    const { mode } = options

    this.ctx.clearRect(0, 0, this.widthCss, this.heightCss)

    for (const layer of this.layers) {
      layer.render({
        ctx: this.ctx,
        width: this.widthCss,
        height: this.heightCss,
        binsNormalized,
        mode,
      })
    }
  }

  clear(): void {
    this.ctx.clearRect(0, 0, this.widthCss, this.heightCss)
  }

  /**
   * Fade out (for stale data indicator)
   */
  fadeOut(opacity: number = 0.5): void {
    this.ctx.globalAlpha = opacity
  }

  resetOpacity(): void {
    this.ctx.globalAlpha = 1.0
  }
}
