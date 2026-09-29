/**
 * Canvas visualization layer contract
 * (inferred from CamillaEQ usage; original was a type-only file)
 */

import type { SpectrumFreqAxis } from './freqAxis'

export type SpectrumVizMode = 'pre' | 'post'

export interface CanvasRenderArgs {
  ctx: CanvasRenderingContext2D
  width: number
  height: number
  binsNormalized: number[]
  mode: SpectrumVizMode
  /** log-frequency axis of the plot; absent = legacy linear-in-bin drawing */
  freqAxis?: SpectrumFreqAxis
  /** daemon-reported center frequency per bin (log-spaced bins); when
   * present it supersedes the uniform-bin assumption of freqAxis */
  binFreqs?: number[]
}

export interface CanvasVisualizationLayer {
  readonly id: string
  render(args: CanvasRenderArgs): void
}
