/**
 * spectrumVizController
 * Factory for creating a spectrum visualization controller that manages:
 * - Spectrum analysis (STA/LTA/Peak tracking)
 * - Canvas rendering (analyzer lines + heatmap)
 * - Polling lifecycle (start/stop based on readiness)
 * (ported from CamillaEQ src/pages/eq/spectrum/spectrumVizController.ts;
 *  the DSP source is reduced to the minimal interface the controller needs)
 */

import { SpectrumCanvasRenderer } from './SpectrumCanvasRenderer'
import { SpectrumAnalyzerLayer } from './canvasLayers/SpectrumAnalyzerLayer'
import {
  SpectrumHeatmapLayer,
  type HeatmapMaskMode,
} from './canvasLayers/SpectrumHeatmapLayer'
import { parseSpectrumData, dbArrayToNormalized } from '../lib/spectrumParser'
import { SpectrumAnalyzer } from '../lib/spectrumAnalyzer'
import { smoothDbBins } from '../lib/fractionalOctaveSmoothing'
import {
  selectPrimarySeries,
  getEffectiveSmoothing,
  getEffectivePollInterval,
  getEffectiveAnalyzerTau,
} from '../lib/heatmapSeries'

export type SmoothingMode = 'off' | '1/12' | '1/6' | '1/3'
export type SpectrumMode = 'pre' | 'post'

/** Minimal DSP surface needed by the controller */
export interface SpectrumSource {
  isSpectrumSocketOpen(): boolean
  getSpectrumData(): Promise<number[] | null>
}

export interface SpectrumVizControllerConfig {
  canvas: HTMLCanvasElement
  getPlotSize: () => { width: number; height: number }
  getDsp: () => SpectrumSource | null

  peakHoldTimeSec?: number
  peakDecayRateDbPerSec?: number
  heatmapMinDb?: number
  heatmapMaxDb?: number
  staleThresholdMs?: number
}

export interface AnalyzerVisibility {
  showSTA: boolean
  showLTA: boolean
  showPeak: boolean
}

export interface HeatmapConfig {
  enabled: boolean
  maskMode: HeatmapMaskMode
  highPrecision: boolean
  alphaGamma: number
  magnitudeGain: number
  gateThreshold: number
  maxAlpha: number
}

/**
 * Create a spectrum visualization controller
 */
export function createSpectrumVizController(config: SpectrumVizControllerConfig) {
  const peakHoldTime = config.peakHoldTimeSec ?? 2.0
  const peakDecayRate = config.peakDecayRateDbPerSec ?? 12
  const heatmapMinDb = config.heatmapMinDb ?? -85
  const heatmapMaxDb = config.heatmapMaxDb ?? -10
  const staleThreshold = config.staleThresholdMs ?? 500

  const analyzer = new SpectrumAnalyzer({
    holdTimeMs: peakHoldTime * 1000,
    decayRateDbPerSec: peakDecayRate,
  })

  const heatmapLayer = new SpectrumHeatmapLayer({
    enabled: false,
    maskMode: 'full',
    primarySeries: null,
  })

  const analyzerLayer = new SpectrumAnalyzerLayer({
    showSTA: true,
    showLTA: false,
    showPeak: false,
  })

  const renderer = new SpectrumCanvasRenderer(config.canvas, [heatmapLayer, analyzerLayer])
  const { width, height } = config.getPlotSize()
  renderer.resize(width, height)

  // Polling state
  let pollingInterval: number | null = null
  let lastFrameTime = 0
  let currentSmoothingMode: SmoothingMode = 'off'
  let currentSpectrumMode: SpectrumMode = 'pre'
  let currentHeatmapConfig: HeatmapConfig = {
    enabled: false,
    maskMode: 'full',
    highPrecision: false,
    alphaGamma: 1.8,
    magnitudeGain: 1.0,
    gateThreshold: 0.05,
    maxAlpha: 0.85,
  }
  let currentAnalyzerVisibility: AnalyzerVisibility = {
    showSTA: true,
    showLTA: false,
    showPeak: false,
  }

  /**
   * Poll spectrum data and render
   */
  async function pollSpectrum(): Promise<void> {
    const dsp = config.getDsp()
    if (!dsp?.isSpectrumSocketOpen()) {
      return
    }

    try {
      const rawData = await dsp.getSpectrumData()
      const spectrumData = parseSpectrumData(rawData)

      if (spectrumData) {
        const nowMs = Date.now()
        lastFrameTime = nowMs

        const effectiveSmoothing = getEffectiveSmoothing(
          currentSmoothingMode,
          currentHeatmapConfig.highPrecision
        )
        const smoothedDb = smoothDbBins(spectrumData.binsDb, effectiveSmoothing)

        /* STA/LTA run on the smoothed frame; the peak hold takes the RAW
         * frame -- smoothing shaves transients and the hold would lag */
        analyzer.update(smoothedDb, nowMs, spectrumData.binsDb)

        const state = analyzer.getState()

        const staNorm = state.staDb ? dbArrayToNormalized(state.staDb) : null
        const ltaNorm = state.ltaDb ? dbArrayToNormalized(state.ltaDb) : null
        const peakNorm = state.peakDb ? dbArrayToNormalized(state.peakDb) : null

        // For heatmap: use custom dB range
        const staHeatNorm = state.staDb
          ? dbArrayToNormalized(state.staDb, heatmapMinDb, heatmapMaxDb)
          : null

        analyzerLayer.setSeries({
          liveNorm: null,
          staNorm,
          ltaNorm,
          peakNorm,
        })

        const primarySeries = selectPrimarySeries(currentAnalyzerVisibility, {
          staNorm,
          ltaNorm,
          peakNorm,
        })
        heatmapLayer.setConfig({ primarySeries })

        /* stale feed: draw the last frame dimmed (the renderer clears
         * each pass, so a fixed alpha here does not accumulate) */
        if (Date.now() - lastFrameTime > staleThreshold) renderer.fadeOut(0.3)
        else renderer.resetOpacity()
        renderer.render(staHeatNorm || staNorm || [], { mode: currentSpectrumMode })
      }
    } catch (error) {
      console.error('Spectrum poll error:', error)
    }
  }

  /**
   * Start polling
   */
  function startPolling(): void {
    if (pollingInterval !== null) {
      return
    }

    const pollInterval = getEffectivePollInterval(currentHeatmapConfig.highPrecision)

    pollingInterval = window.setInterval(() => {
      pollSpectrum()
    }, pollInterval)
  }

  /**
   * Stop polling
   */
  function stopPolling(): void {
    if (pollingInterval !== null) {
      clearInterval(pollingInterval)
      pollingInterval = null
      renderer.clear()
    }
  }

  // Public API
  return {
    setEnabled(enabled: boolean): void {
      if (enabled && pollingInterval === null) {
        startPolling()
      } else if (!enabled && pollingInterval !== null) {
        stopPolling()
      }
    },

    setSpectrumMode(mode: SpectrumMode): void {
      currentSpectrumMode = mode
    },

    setSmoothingMode(mode: SmoothingMode): void {
      currentSmoothingMode = mode
    },

    setAnalyzerVisibility(visibility: AnalyzerVisibility): void {
      currentAnalyzerVisibility = visibility
      analyzerLayer.setConfig({
        showLive: false,
        showSTA: visibility.showSTA,
        showLTA: visibility.showLTA,
        showPeak: visibility.showPeak,
      })
    },

    setHeatmapConfig(cfg: HeatmapConfig): void {
      currentHeatmapConfig = { ...cfg }

      const tau = getEffectiveAnalyzerTau(cfg.highPrecision)
      analyzer.updateConfig({
        ...analyzer.getConfig(),
        tauShort: tau.tauShort,
        tauLong: tau.tauLong,
      })

      heatmapLayer.setConfig({
        enabled: cfg.enabled,
        maskMode: cfg.maskMode,
        primarySeries: null, // Updated during polling
        visualTuning: {
          minAlpha: 0.0,
          maxAlpha: cfg.maxAlpha,
          alphaGamma: cfg.alphaGamma,
          colorGamma: 1.2,
          gateThreshold: cfg.gateThreshold,
          gateSoftness: 0.03,
          magnitudeGain: cfg.magnitudeGain,
          darkOrange: { r: 180, g: 80, b: 20 },
          brightOrange: { r: 255, g: 140, b: 40 },
        },
      })

      // Restart polling if needed to update interval
      if (pollingInterval !== null) {
        stopPolling()
        startPolling()
      }
    },

    resize(width: number, height: number): void {
      renderer.resize(width, height)
    },

    resetAverages(): void {
      analyzer.resetAverages()
    },

    destroy(): void {
      stopPolling()
    },
  }
}

export type SpectrumVizController = ReturnType<typeof createSpectrumVizController>
