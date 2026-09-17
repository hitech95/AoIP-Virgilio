/**
 * Canvas visualization layer contract
 * (inferred from CamillaEQ usage; original was a type-only file)
 */

export type SpectrumVizMode = 'pre' | 'post'

export interface CanvasRenderArgs {
  ctx: CanvasRenderingContext2D
  width: number
  height: number
  binsNormalized: number[]
  mode: SpectrumVizMode
}

export interface CanvasVisualizationLayer {
  readonly id: string
  render(args: CanvasRenderArgs): void
}
