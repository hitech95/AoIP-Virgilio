/**
 * Visualization options store (Vue port of CamillaEQ vizOptionsStore)
 * All settings live in a single reactive object for template-safe access,
 * with automatic localStorage persistence.
 */

import { computed, reactive, watch, type WatchStopHandle } from 'vue'
import type { SmoothingMode } from '../lib/fractionalOctaveSmoothing'
import { loadVizOptions, saveVizOptions, type VizOptionsState } from '../lib/vizOptionsPersistence'

export const vizOptions = reactive<VizOptionsState>(loadVizOptions())

// Derived: a curve is the primary display unless the RTA bars own the plot
export const curveModeActive = computed(() => vizOptions.spectrumSeries !== 'rta')

// The mode applied by the spectrum pipeline: 'off' while the smoothing
// toggle in the section header is disabled
export const effectiveSmoothingMode = computed(
   () => (vizOptions.smoothingEnabled && vizOptions.spectrumSeries !== 'rta' ? vizOptions.smoothingMode : 'off') as SmoothingMode
)

// Master gate: the FFT spectrum runs only when enabled.
// Curves/heatmap visibility is configured by their own toggles.
export const spectrumVizEnabled = computed(() => vizOptions.spectrumEnabled)

// Counter the plot area watches to reset STA/LTA/Peak averages
export const resetAveragesTick = reactive({ count: 0 })

/**
 * Initialize viz options from localStorage
 */
export function initializeVizOptions(): void {
  Object.assign(vizOptions, loadVizOptions())
}

let stopPersistence: WatchStopHandle | null = null

/**
 * Persist changes to localStorage. Call once on page init; returns cleanup.
 */
export function setupVizOptionsPersistence(): () => void {
  stopPersistence?.()
  stopPersistence = watch(
    vizOptions,
    (state) => {
      saveVizOptions({ ...state })
    },
    { deep: true }
  )
  return () => {
    stopPersistence?.()
    stopPersistence = null
  }
}
