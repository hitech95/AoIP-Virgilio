/**
 * spectrumVizController
 * Factory for creating a spectrum visualization controller that manages:
 * - Series selection (RTA bars / STA / LTA curves) + Peak envelope
 * - Spectrum analysis and the shared static dBFS->display mapping (palette)
 * - Canvas rendering (heatmap fill + RTA bars + analyzer lines)
 * - Polling lifecycle + client-side display interpolation (rAF)
 */

import { SpectrumCanvasRenderer } from './SpectrumCanvasRenderer'
import { SpectrumAnalyzerLayer } from './canvasLayers/SpectrumAnalyzerLayer'
import { SpectrumRtaLayer } from './canvasLayers/SpectrumRtaLayer'
import { ScaleReferenceLayer } from './canvasLayers/ScaleReferenceLayer'
import { SpectrumHeatmapLayer, type HeatmapFillMode } from './canvasLayers/SpectrumHeatmapLayer'
import { toDisplayNorm, type HeatmapAlphaTuning } from './canvasLayers/palette'
import { parseSpectrumData } from '../lib/spectrumParser'
import { SpectrumAnalyzer } from '../lib/spectrumAnalyzer'
import { smoothDbBins } from '../lib/fractionalOctaveSmoothing'
import type { SpectrumFreqAxis } from './canvasLayers/freqAxis'
import {
  getEffectiveSmoothing,
  getEffectivePollInterval,
  getEffectiveAnalyzerTau,
} from '../lib/heatmapSeries'

export type SmoothingMode = 'off' | '1/12' | '1/6' | '1/3'
export type SpectrumMode = 'pre' | 'post'
export type SpectrumSeries = 'rta' | 'sta' | 'lta'

/** Minimal DSP surface needed by the controller */
export interface SpectrumTapPayload {
  levels: number[] | null
  /** daemon-reported center frequency per bin (log-spaced) */
  frequencies: number[]
  samplerate: number
}

export interface SpectrumSource {
  isSpectrumSocketOpen(): boolean
  getSpectrumData(): Promise<SpectrumTapPayload | null>
}

export interface SpectrumVizControllerConfig {
  canvas: HTMLCanvasElement
  getPlotSize: () => { width: number; height: number }
  getDsp: () => SpectrumSource | null

  /** log-frequency axis of the surrounding plot: the (log-spaced) bins
   * must be placed on it through their reported center frequencies --
   * uniform-in-index drawing stretches their narrower span onto the
   * whole axis and shifts mid-band content */
  getFreqAxis?: () => SpectrumFreqAxis | null

  staleThresholdMs?: number
  /** display interpolation time constant (client-side frame blending) */
  displayTauMs?: number
}

export interface HeatmapConfig {
  enabled: boolean
  fillMode: HeatmapFillMode
  highPrecision: boolean
  alphaGamma: number
  magnitudeGain: number
  gateThreshold: number
  maxAlpha: number
}

export interface SeriesSelection {
  series: SpectrumSeries
  showPeak: boolean
  /** window offset (dB): +6+offset … −60+offset dBFS */
  trimDb: number
}

/** display-interpolation: exponential approach toward the polled target */
const DISPLAY_TAU_MS = 80

/**
 * Create a spectrum visualization controller
 */
export function createSpectrumVizController(config: SpectrumVizControllerConfig) {
  const staleThreshold = config.staleThresholdMs ?? 500
  const displayTau = config.displayTauMs ?? DISPLAY_TAU_MS

  const analyzer = new SpectrumAnalyzer()

  const heatmapLayer = new SpectrumHeatmapLayer({
    enabled: false,
    fillMode: 'under',
  })

  const rtaLayer = new SpectrumRtaLayer({
    enabled: false,
    heatmapActive: true,
  })

  const analyzerLayer = new SpectrumAnalyzerLayer({
    showSTA: false,
    showLTA: false,
    showPeak: false,
  })

  const scaleLayer = new ScaleReferenceLayer({})

  const renderer = new SpectrumCanvasRenderer(config.canvas, [
    heatmapLayer,
    rtaLayer,
    analyzerLayer,
    scaleLayer,
  ])
  const { width, height } = config.getPlotSize()
  renderer.resize(width, height)

  // Polling / render state
  let pollingInterval: number | null = null
  let rafId: number | null = null
  let lastDataMs = 0
  let lastFrameTs = 0
  let currentSmoothingMode: SmoothingMode = 'off'
  let currentSpectrumMode: SpectrumMode = 'pre'
  let currentSeries: SpectrumSeries = 'rta'
  let currentShowPeak = true
  let currentTrimDb = 0
  let currentHeatmapEnabled = false
  let currentHighPrecision = false
  let currentHeatmapTuning: HeatmapAlphaTuning = {
    magnitudeGain: 1,
    gateThreshold: -57,
    gateSoftness: 2,
    alphaGamma: 2.8,
    minAlpha: 0,
    maxAlpha: 0.95,
  }

  // Selected series (dB) and the interpolated display buffer
  let targetDb: number[] = []
  let dispDb: number[] = []
  let latestRawDb: number[] = []

  /** dB series of the selection (raw = smoothed daemon frame) */
  function selectedSeriesDb(): number[] | null {
    const st = analyzer.getState()
    if (currentSeries === 'sta') return st.staDb
    if (currentSeries === 'lta') return st.ltaDb
    return st.liveDb
  }

  /** peak envelope of the selection */
  function selectedPeakDb(): number[] | null {
    const st = analyzer.getState()
    if (currentSeries === 'sta') return st.peakStaDb
    if (currentSeries === 'lta') return st.peakLtaDb
    return st.peakDb
  }

  function syncLayerConfigs(): void {
    const peak = selectedPeakDb()
    rtaLayer.setConfig({
      enabled: currentSeries === 'rta',
      heatmapActive: currentHeatmapEnabled,
      offsetDb: currentTrimDb,
      showPeak: currentShowPeak,
      peakSeries: peak ? peak.map((db) => toDisplayNorm(db, currentTrimDb)) : null,
      tuning: currentHeatmapTuning,
    })
    heatmapLayer.setConfig({
      offsetDb: currentTrimDb,
      // in RTA mode the bars carry the palette: no full-height columns
      enabled: currentHeatmapEnabled && currentSeries !== 'rta',
      tuning: currentHeatmapTuning,
    })
    analyzerLayer.setConfig({
      showSTA: currentSeries === 'sta',
      showLTA: currentSeries === 'lta',
      showPeak: currentShowPeak && currentSeries !== 'rta',
    })
  }

  /**
   * Poll spectrum data and update the analysis targets
   */
  let pollInFlight = false
  let feedGeneration = 0
  async function pollSpectrum(): Promise<void> {
    if (pollInFlight) return
    const dsp = config.getDsp()
    if (!dsp?.isSpectrumSocketOpen()) {
      return
    }

    pollInFlight = true
    const generation = feedGeneration
    try {
      const tap = await dsp.getSpectrumData()
      if (generation !== feedGeneration) return
      const spectrumData = parseSpectrumData(tap?.levels ?? null)

      if (spectrumData) {
        lastDataMs = Date.now()

        /* the daemon reports the center frequency of every (log-spaced)
         * bin: pass them through so the layers place each bin at its
         * true position on the log axis */
        const binFreqs =
          Array.isArray(tap?.frequencies) &&
          tap!.frequencies.length === spectrumData.binsDb.length
            ? tap!.frequencies
            : undefined

        const effectiveSmoothing = getEffectiveSmoothing(
          currentSeries === 'rta' ? 'off' : currentSmoothingMode,
          currentHighPrecision
        )
        const binOct =
          binFreqs && binFreqs.length > 1
            ? Math.log2(binFreqs[binFreqs.length - 1] / binFreqs[0]) /
              (binFreqs.length - 1)
            : undefined
        // A changed frequency grid invalidates ALL historical averages even
        // when the bin count is unchanged (FFT size/sample-rate changes).
        const gridChanged = binFreqs?.length !== lastBinFreqs?.length ||
          !!binFreqs?.some((f, i) => f !== lastBinFreqs?.[i])
        if (gridChanged) {
          analyzer.reset()
          dispDb = []
        }
        const smoothedDb = smoothDbBins(spectrumData.binsDb, effectiveSmoothing, binOct)
        latestRawDb = [...spectrumData.binsDb]

        /* STA/LTA run on the smoothed frame; the peak hold takes the RAW
         * frame -- smoothing shaves transients and the hold would lag */
        analyzer.update(smoothedDb, lastDataMs, spectrumData.binsDb)

        const sel = selectedSeriesDb()
        if (sel) {
          if (dispDb.length !== sel.length) {
            // bucket count changed (precision switch): reseed the buffer
            dispDb = [...sel]
          }
          targetDb = [...sel]
        }

        syncLayerConfigs()
        scaleLayer.setConfig({ scaleDb: currentTrimDb })
        lastBinFreqs = binFreqs
      }
    } catch (error) {
      console.error('Spectrum poll error:', error)
    } finally {
      pollInFlight = false
    }
  }

  let lastBinFreqs: number[] | undefined

  /**
   * rAF render loop: interpolate the display buffer toward the polled
   * target and repaint (client-side frame blending between polls)
   */
  function renderLoop(now: number): void {
    rafId = requestAnimationFrame(renderLoop)

    if (targetDb.length === 0) return

    const dt = Math.min(100, lastFrameTs ? now - lastFrameTs : 16)
    lastFrameTs = now
    const k = 1 - Math.exp(-dt / displayTau)
    for (let i = 0; i < targetDb.length; i++) {
      dispDb[i] += (targetDb[i] - dispDb[i]) * k
    }

    /* stale feed: draw the last frame dimmed (the renderer clears each
     * pass, so a fixed alpha here does not accumulate) */
    if (Date.now() - lastDataMs > staleThreshold) renderer.fadeOut(0.3)
    else renderer.resetOpacity()

    // The curve and its fill must use the SAME interpolated frame. Mapping
    // each rAF also makes offset/series changes coherent immediately.
    const displayNorm = dispDb.map((db) => toDisplayNorm(db, currentTrimDb))
    const peak = selectedPeakDb()
    syncLayerConfigs()
    analyzerLayer.setSeries({
      liveNorm: null,
      staNorm: currentSeries === 'sta' ? displayNorm : null,
      ltaNorm: currentSeries === 'lta' ? displayNorm : null,
      peakNorm: peak ? peak.map((db) => toDisplayNorm(db, currentTrimDb)) : null,
    })
    scaleLayer.setConfig({ scaleDb: currentTrimDb })
    renderer.render(
      displayNorm,
      {
        mode: currentSpectrumMode,
        freqAxis: config.getFreqAxis?.() ?? undefined,
        binFreqs: lastBinFreqs,
      }
    )
  }

  /**
   * Start polling
   */
  function startPolling(): void {
    if (pollingInterval !== null) {
      return
    }

    const pollInterval = getEffectivePollInterval(currentSeries)

    pollingInterval = window.setInterval(() => {
      pollSpectrum()
    }, pollInterval)

    if (rafId === null) {
      lastFrameTs = 0
      rafId = requestAnimationFrame(renderLoop)
    }
  }

  /**
   * Stop polling
   */
  function stopPolling(): void {
    feedGeneration++
    if (pollingInterval !== null) {
      clearInterval(pollingInterval)
      pollingInterval = null
    }
    if (rafId !== null) {
      cancelAnimationFrame(rafId)
      rafId = null
    }
    targetDb = []
    dispDb = []
    latestRawDb = []
    lastBinFreqs = undefined
    analyzer.reset()
    renderer.clear()
  }

  /** restart the interval when the effective poll rate changes */
  function restartPolling(): void {
    if (pollingInterval !== null) {
      clearInterval(pollingInterval)
      pollingInterval = window.setInterval(() => {
        pollSpectrum()
      }, getEffectivePollInterval(currentSeries))
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
      if (mode !== currentSpectrumMode) {
        feedGeneration++
        analyzer.reset()
        targetDb = []
        dispDb = []
        latestRawDb = []
        renderer.clear()
      }
      currentSpectrumMode = mode
    },

    setSmoothingMode(mode: SmoothingMode): void {
      if (mode === currentSmoothingMode) return
      currentSmoothingMode = mode
      // Reprocess the latest frame immediately. Otherwise LTA can take
      // 8–16 seconds to shed the previous smoothing shape.
      if (latestRawDb.length) {
        const binOct = lastBinFreqs && lastBinFreqs.length > 1
          ? Math.log2(lastBinFreqs[lastBinFreqs.length - 1] / lastBinFreqs[0]) / (lastBinFreqs.length - 1)
          : undefined
        analyzer.reset()
        analyzer.update(smoothDbBins(latestRawDb, currentSeries === 'rta' ? 'off' : mode, binOct), Date.now(), latestRawDb)
        targetDb = [...selectedSeriesDb()!]
        syncLayerConfigs()
      }
    },

    setSeriesSelection(sel: SeriesSelection): void {
      const seriesChanged = sel.series !== currentSeries
      currentSeries = sel.series
      currentShowPeak = sel.showPeak
      currentTrimDb = sel.trimDb
      const selected = selectedSeriesDb()
      if (selected) targetDb = [...selected]
      syncLayerConfigs()
      if (seriesChanged) restartPolling()
    },

    setHeatmapConfig(cfg: HeatmapConfig): void {
      const hpChanged = cfg.highPrecision !== currentHighPrecision
      currentHeatmapEnabled = cfg.enabled
      currentHighPrecision = cfg.highPrecision
      currentHeatmapTuning = {
        magnitudeGain: cfg.magnitudeGain,
        gateThreshold: cfg.gateThreshold,
        gateSoftness: 2,
        alphaGamma: cfg.alphaGamma,
        minAlpha: 0,
        maxAlpha: cfg.maxAlpha,
      }
      heatmapLayer.setConfig({ fillMode: cfg.fillMode })
      syncLayerConfigs()
      if (hpChanged) {
        const tau = getEffectiveAnalyzerTau(cfg.highPrecision)
        analyzer.updateConfig({
          ...analyzer.getConfig(),
          tauShort: tau.tauShort,
          tauLong: tau.tauLong,
        })
      }
    },

    resize(width: number, height: number): void {
      renderer.resize(width, height)
    },

    resetAverages(): void {
      analyzer.resetAverages()
      const selected = selectedSeriesDb()
      if (selected) targetDb = [...selected]
      syncLayerConfigs()
    },

    destroy(): void {
      stopPolling()
    },
  }
}

export type SpectrumVizController = ReturnType<typeof createSpectrumVizController>
