<template>
  <div class="eq-plot-area">
    <div ref="plotEl" class="eq-plot" @click="handlePlotBackgroundClick">
      <canvas
        ref="canvasEl"
        class="eq-spectrum-canvas"
        :style="{ opacity: String(spectrumOpacity), transition: 'opacity 0.2s ease' }"
      ></canvas>

      <svg class="eq-plot-svg" viewBox="0 0 1000 400" preserveAspectRatio="none">
        <!-- Grid: Horizontal lines (dB scale) -->
        <g class="grid-horizontal">
          <template v-for="gain in gainTicks" :key="`h${gain}`">
            <line
              v-if="gain !== 0"
              :x1="0"
              :y1="200 - (gain / (GAIN_MAX - GAIN_MIN)) * 400"
              :x2="1000"
              :y2="200 - (gain / (GAIN_MAX - GAIN_MIN)) * 400"
              stroke="var(--eq-grid-line)"
              stroke-width="1"
            />
          </template>
        </g>

        <!-- Grid: Vertical lines (log scale, minors) -->
        <g class="grid-vertical">
          <line
            v-for="freq in minorTicks"
            :key="`vm${freq}`"
            :x1="freqToX(freq, 1000, plotFreqMax)"
            y1="0"
            :x2="freqToX(freq, 1000, plotFreqMax)"
            y2="400"
            stroke="var(--eq-grid-line)"
            stroke-width="1"
            opacity="0.7"
          />
        </g>

        <!-- Grid: Vertical lines (log scale, majors) -->
        <g class="grid-vertical">
          <line
            v-for="freq in majorTicks"
            :key="`vM${freq}`"
            :x1="freqToX(freq, 1000, plotFreqMax)"
            y1="0"
            :x2="freqToX(freq, 1000, plotFreqMax)"
            y2="400"
            stroke="var(--eq-grid-line-major)"
            stroke-width="1"
          />
        </g>

        <!-- 0 dB line (moves with preamp gain) -->
        <g class="zero-line">
          <line
            :x1="0"
            :y1="gainToY(eq.preampGain)"
            :x2="1000"
            :y2="gainToY(eq.preampGain)"
            stroke="var(--eq-zero-line)"
            stroke-width="1"
          />
        </g>

        <!-- Focus mode area-of-effect -->
        <g v-if="focusMode && selectedBand && eq.selectedBandIndex !== null" class="focus-area" :opacity="vizOptions.bandFillOpacity">
          <path
            v-if="focusAreaPath"
            :d="focusAreaPath"
            :fill="`var(--band-${(eq.selectedBandIndex % 10) + 1})`"
            opacity="0.3"
            class="focus-area-path"
          />

          <rect
            v-if="focusAreaRect"
            :x="focusAreaRect.x"
            :y="focusAreaRect.y"
            :width="focusAreaRect.width"
            :height="focusAreaRect.height"
            :fill="`var(--band-${(eq.selectedBandIndex % 10) + 1})`"
            opacity="0.2"
            class="focus-area-rect"
          />

          <path
            v-if="selectedBand.type === 'Notch' && focusAreaPath"
            :d="focusAreaPath"
            fill="none"
            :stroke="`var(--band-${(eq.selectedBandIndex % 10) + 1})`"
            stroke-width="8"
            opacity="0.25"
            class="focus-notch-halo"
          />
        </g>

        <!-- Curves: Per-band -->
        <g v-if="vizOptions.showPerBandCurves" class="curves-per-band">
          <path
            v-for="(path, i) in perBandCurvePaths"
            :key="`curve${i}`"
            :d="path"
            fill="none"
            :stroke="`var(--band-${(i % 10) + 1})`"
            stroke-width="1.25"
            :opacity="eq.soloActiveBandIndex !== null && eq.soloActiveBandIndex !== i ? 0.08 : 0.4"
            class="eq-curve-band"
          />
        </g>

        <!-- Curves: Sum curve -->
        <g class="curves-sum">
          <path
            :d="sumCurvePath"
            fill="none"
            stroke="var(--eq-sum-curve)"
            :stroke-width="focusMode ? '1.5' : '2.25'"
            stroke-dasharray="8 4"
            stroke-linecap="round"
            :opacity="focusMode ? '0.6' : '1'"
            class="eq-curve-sum"
            :class="{ focused: focusMode }"
          />
        </g>

        <!-- Selected band curve -->
        <g v-if="focusMode && selectedBandCurvePath && eq.selectedBandIndex !== null" class="curves-selected">
          <path
            :d="selectedBandCurvePath"
            fill="none"
            :stroke="`var(--band-${(eq.selectedBandIndex % 10) + 1})`"
            stroke-width="2.75"
            opacity="0.95"
            class="eq-curve-selected"
          />
        </g>

        <!-- Bandwidth markers -->
        <g
          v-if="vizOptions.showBandwidthMarkers && bandwidthMarkers.leftFreq && bandwidthMarkers.rightFreq && eq.selectedBandIndex !== null"
          class="bandwidth-markers"
        >
          <line
            :x1="freqToX(bandwidthMarkers.leftFreq, 1000, plotFreqMax)"
            y1="395"
            :x2="freqToX(bandwidthMarkers.leftFreq, 1000, plotFreqMax)"
            y2="400"
            :stroke="`var(--band-${(eq.selectedBandIndex % 10) + 1})`"
            stroke-width="2"
            opacity="0.8"
            class="bandwidth-marker"
          />
          <line
            :x1="freqToX(bandwidthMarkers.rightFreq, 1000, plotFreqMax)"
            y1="395"
            :x2="freqToX(bandwidthMarkers.rightFreq, 1000, plotFreqMax)"
            y2="400"
            :stroke="`var(--band-${(eq.selectedBandIndex % 10) + 1})`"
            stroke-width="2"
            opacity="0.8"
            class="bandwidth-marker"
          />
        </g>

        <!-- Tokens Layer -->
        <EqTokensLayer
          :bands="eq.bands"
          :band-order-numbers="eq.bandOrderNumbers"
          :selected-band-index="eq.selectedBandIndex"
          :solo-active-band-index="eq.soloActiveBandIndex"
          :plot-width="plotWidth"
          :plot-height="plotHeight"
          :freq-max="plotFreqMax"
          :shift-pressed="shiftPressed"
          :focus-mode="focusMode"
          @token-pointer-down="(p) => handleTokenPointerDown(p.event, p.bandIndex)"
          @token-pointer-move="(p) => handleTokenPointerMove(p.event)"
          @token-pointer-up="() => (dragState = null)"
          @token-wheel="(p) => handleTokenWheel(p.event, p.bandIndex)"
        />
      </svg>
    </div>

    <!-- Gain Scale Column -->
    <div class="eq-gainscale">
      <span
        v-for="gain in gainLabelTicks"
        :key="`g${gain}`"
        class="gain-label"
        :class="{ 'gain-label-zero': gain === 0 }"
        :style="{ top: `${gainToYPercent(gain)}%` }"
      >
        {{ gain > 0 ? '+' : '' }}{{ gain }}
      </span>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import {
  eq,
  perBandCurvePaths,
  sumCurvePath,
  setBandFreq,
  setBandGain,
  setBandQ,
  selectBand,
  startSoloSession,
  endSoloSession,
} from '../../stores/eqStore'
import { vizOptions, resetAveragesTick, spectrumVizEnabled, effectiveSmoothingMode } from '../../stores/vizOptions'
import { createSpectrumVizController, type SpectrumVizController } from '../../rendering/spectrumVizController'
import * as dsp from '../../dsp'
import EqTokensLayer from './EqTokensLayer.vue'
import { calculateBandwidthMarkers } from '../../lib/bandwidthMarkers'
import {
  generatePeakingFillPath,
  generateShelfTintRect,
  generatePassFilterTint,
  generateBandPassTintRect,
  generateNotchHaloPath,
} from '../../lib/eqFocusViz'
import { generateBandCurvePath } from '../../lib/eqSvgRenderer'
import {
  freqToX,
  xToFreq,
  gainToY,
  yToGain,
  gainToYPercent,
  generateFrequencyTicks,
} from '../../lib/eqPlotMath'

// Focus mode and active editing state
let isActivelyEditing = false
let editingTimeoutId: number | null = null

// Spectrum analyzer + rendering
const canvasEl = ref<HTMLCanvasElement | null>(null)
const plotEl = ref<HTMLDivElement | null>(null)
let spectrumController: SpectrumVizController | null = null
let resizeObserver: ResizeObserver | null = null

// Token drag state
const dragState = ref<{
  bandIndex: number
  startX: number
  startY: number
  startFreq: number
  startGain: number
  startQ: number
  shiftKey: boolean
} | null>(null)

// Track global shift key state for cursor feedback
const shiftPressed = ref(false)

// Plot dimensions for responsive tokens
const plotWidth = ref(1000)
const plotHeight = ref(400)

// Spectrum precision: bucket count per mode (daemon range 8..256); the FFT
// size is derived from the sample rate (15 Hz base target) in dsp.ts
const spectrumBins = (highPrecision: boolean) => (highPrecision ? 128 : 32)

// Frequency ticks
const plotFreqMax = computed(() => Math.min(30000, eq.sampleRate / 2))
const majorTicks = computed(() => generateFrequencyTicks(plotFreqMax.value).majors)
const minorTicks = computed(() => generateFrequencyTicks(plotFreqMax.value).minors)

// Gain range
const GAIN_MIN = -24
const GAIN_MAX = 24
const GAIN_STEP = 6

const gainTicks: number[] = []
for (let g = GAIN_MIN; g <= GAIN_MAX; g += GAIN_STEP) {
  gainTicks.push(g)
}

const gainLabelTicks = [-18, -12, -6, 0, 6, 12, 18]

// Lifecycle: Initialize spectrum controller
const onCleanupFns: Array<() => void> = []

onMounted(() => {
  if (canvasEl.value) {
    spectrumController = createSpectrumVizController({
      canvas: canvasEl.value,
      getPlotSize: () => ({ width: plotWidth.value, height: plotHeight.value }),
      getDsp: () => (dsp.isConnected() ? dsp.getSpectrumSource() : null),
      /* the spectrum bins are log-spaced with a narrower span than the
       * plot axis: hand the layers the axis so they place every bin at
       * its true frequency (from the daemon-reported center list) */
      getFreqAxis: () => ({
        minHz: 10,
        maxHz: plotFreqMax.value,
        nyquistHz: eq.sampleRate / 2,
      }),
      staleThresholdMs: 500,
    })

    applyVizConfig()
    spectrumController.setEnabled(spectrumVizEnabled.value && dsp.isConnected())
    syncSpectrumPipeline()
  }

  if (plotEl.value) {
    resizeObserver = new ResizeObserver((entries) => {
      for (const entry of entries) {
        plotWidth.value = entry.contentRect.width
        plotHeight.value = entry.contentRect.height

        spectrumController?.resize(plotWidth.value, plotHeight.value)
      }
    })
    resizeObserver.observe(plotEl.value)
  }

  const handleKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Shift') {
      shiftPressed.value = true
    } else if (e.key === 'Escape' && eq.selectedBandIndex !== null) {
      endSoloSession()
      selectBand(null)
    }
  }

  const handleKeyUp = (e: KeyboardEvent) => {
    if (e.key === 'Shift') {
      shiftPressed.value = false
    }
  }

  window.addEventListener('keydown', handleKeyDown)
  window.addEventListener('keyup', handleKeyUp)

  onCleanupFns.push(() => {
    window.removeEventListener('keydown', handleKeyDown)
    window.removeEventListener('keyup', handleKeyUp)
  })
})

onBeforeUnmount(() => {
  onCleanupFns.forEach((fn) => fn())

  spectrumController?.destroy()
  spectrumController = null

  resizeObserver?.disconnect()
  resizeObserver = null
})

// Apply current viz options to the controller (also used right after creation)
function applyVizConfig() {
  spectrumController?.setSeriesSelection({
    series: vizOptions.spectrumSeries,
    showPeak: vizOptions.showPeak,
    trimDb: vizOptions.spectrumTrimDb,
  })
  spectrumController?.setSpectrumMode(vizOptions.spectrumMode)
  spectrumController?.setSmoothingMode(effectiveSmoothingMode.value)
  spectrumController?.setHeatmapConfig({
    enabled: vizOptions.heatmapEnabled,
    fillMode: vizOptions.heatmapFillMode,
    highPrecision: vizOptions.heatmapHighPrecision,
    alphaGamma: vizOptions.heatmapAlphaGamma,
    magnitudeGain: vizOptions.heatmapMagnitudeGain,
    gateThreshold: vizOptions.heatmapGateThreshold,
    maxAlpha: vizOptions.heatmapMaxAlpha,
  })
}

// Spectrum controller config updates
watch(
  () => [vizOptions.spectrumSeries, vizOptions.showPeak, vizOptions.spectrumTrimDb] as const,
  () => applyVizConfig()
)

watch(
  () => [vizOptions.spectrumMode, effectiveSmoothingMode.value] as const,
  () => applyVizConfig()
)

watch(
  () => [
    vizOptions.heatmapEnabled,
    vizOptions.heatmapFillMode,
    vizOptions.heatmapHighPrecision,
    vizOptions.heatmapAlphaGamma,
    vizOptions.heatmapMagnitudeGain,
    vizOptions.heatmapGateThreshold,
    vizOptions.heatmapMaxAlpha,
  ] as const,
  () => applyVizConfig()
)

watch(resetAveragesTick, () => {
  spectrumController?.resetAverages()
})

// Spectrum enable/disable: manage the daemon spectrum pipeline and select the
// signal tap matching the pre/post-EQ mode.
const tapForMode = (mode: 'pre' | 'post') => (mode === 'pre' ? 'capture' : 'playback') as const

function syncSpectrumPipeline() {
  if (!dsp.isConnected()) return
  if (spectrumVizEnabled.value) {
    dsp.setSpectrumEnabled(true).catch(() => {})
    dsp.setSpectrumTap(tapForMode(vizOptions.spectrumMode)).catch(() => {})
    // FFT size follows the sample rate (15 Hz base target); buckets follow
    // the precision mode; rate/smoothing follow the displayed series
    dsp.setSpectrumFftSize(dsp.fftForSampleRate(eq.sampleRate)).catch(() => {})
    dsp.setSpectrumBins(spectrumBins(vizOptions.heatmapHighPrecision)).catch(() => {})
    dsp.setSpectrumInterval(vizOptions.spectrumSeries === 'rta' ? 50 : 100).catch(() => {})
    dsp.setSpectrumSmoothing(vizOptions.spectrumSeries === 'rta' ? 0.45 : 0.7).catch(() => {})
  } else {
    dsp.setSpectrumEnabled(false).catch(() => {})
  }
}

watch(
  [
    spectrumVizEnabled,
    () => vizOptions.spectrumMode,
    () => vizOptions.spectrumSeries,
    () => vizOptions.heatmapHighPrecision,
    () => eq.sampleRate,
  ] as const,
  () => {
    syncSpectrumPipeline()
    spectrumController?.setEnabled(spectrumVizEnabled.value && dsp.isConnected())
  }
)

watch(
  () => dsp.connectionState.value,
  (state) => {
    if (state === 'connected') {
      syncSpectrumPipeline()
      spectrumController?.setEnabled(spectrumVizEnabled.value)
    } else {
      spectrumController?.setEnabled(false)
    }
  }
)

// Active editing tracking
function setActiveEditing() {
  isActivelyEditing = true
  if (editingTimeoutId !== null) {
    clearTimeout(editingTimeoutId)
  }
  editingTimeoutId = window.setTimeout(() => {
    isActivelyEditing = false
    editingTimeoutId = null
  }, 250)
}

// Deselect band on plot background click
function handlePlotBackgroundClick(event: MouseEvent) {
  const target = event.target as Element
  if (target.tagName === 'svg' || target.classList.contains('eq-plot')) {
    endSoloSession()
    selectBand(null)
  }
}

// Token interaction handlers
function handleTokenPointerDown(event: PointerEvent, bandIndex: number) {
  const band = eq.bands[bandIndex]
  if (!band.enabled) {
    event.preventDefault()
    event.stopPropagation()
    return
  }

  event.preventDefault()
  event.stopPropagation()

  dragState.value = {
    bandIndex,
    startX: event.clientX,
    startY: event.clientY,
    startFreq: band.freq,
    startGain: band.gain,
    startQ: band.q,
    shiftKey: event.shiftKey,
  }

  selectBand(bandIndex)
  startSoloSession(bandIndex, vizOptions.soloWhileEditing)
  setActiveEditing()
}

function handleTokenPointerMove(event: PointerEvent) {
  const ds = dragState.value
  if (!ds || !plotEl.value) return

  const band = eq.bands[ds.bandIndex]
  const supportsGain = band.type === 'Peaking' || band.type === 'LowShelf' || band.type === 'HighShelf'

  const rect = plotEl.value.getBoundingClientRect()
  const deltaX = event.clientX - ds.startX
  const deltaY = event.clientY - ds.startY

  if (event.shiftKey) {
    const Q_MIN = 0.1
    const Q_MAX = 10

    const logMin = Math.log(Q_MIN)
    const logMax = Math.log(Q_MAX)
    const logRange = logMax - logMin
    const logPerPx = logRange / (window.innerHeight / 2)

    const startLogQ = Math.log(Math.max(Q_MIN, Math.min(Q_MAX, ds.startQ)))
    const newLogQ = startLogQ - deltaY * logPerPx
    const clampedLogQ = Math.max(logMin, Math.min(logMax, newLogQ))
    const newQ = Math.exp(clampedLogQ)

    setBandQ(ds.bandIndex, newQ)
  } else {
    const pixelToViewBoxX = 1000 / rect.width
    const deltaViewBoxX = deltaX * pixelToViewBoxX
    const currentX = freqToX(ds.startFreq, 1000, plotFreqMax.value)
    const newX = currentX + deltaViewBoxX
    const newFreq = xToFreq(newX, 1000, plotFreqMax.value)

    setBandFreq(ds.bandIndex, newFreq)

    if (supportsGain) {
      const pixelToViewBoxY = 400 / rect.height
      const deltaViewBoxY = deltaY * pixelToViewBoxY
      const currentY = gainToY(ds.startGain)
      const newY = currentY + deltaViewBoxY
      const newGain = yToGain(newY)

      setBandGain(ds.bandIndex, newGain)
    }
  }
}

function handleTokenWheel(event: WheelEvent, bandIndex: number) {
  const band = eq.bands[bandIndex]
  if (!band.enabled) {
    event.preventDefault()
    return
  }

  event.preventDefault()
  const delta = event.deltaY > 0 ? -0.1 : 0.1
  setBandQ(bandIndex, band.q + delta)
}

// Reactive computed values
const focusMode = computed(() => eq.selectedBandIndex !== null)
const selectedBand = computed(() =>
  eq.selectedBandIndex !== null ? eq.bands[eq.selectedBandIndex] : null
)

const spectrumOpacity = computed(() => {
  if (!focusMode.value) return 1.0
  if (isActivelyEditing || dragState.value !== null) return 0.4
  return 0.7
})

const selectedBandCurvePath = computed(() =>
  selectedBand.value
    ? generateBandCurvePath(selectedBand.value, {
        width: 1000,
        height: 400,
        numPoints: 128,
        sampleRate: eq.sampleRate,
        freqMax: plotFreqMax.value,
      })
    : ''
)

const focusAreaPath = computed(() => {
  if (!selectedBand.value) return ''
  const options = { width: 1000, height: 400, sampleRate: eq.sampleRate, freqMax: plotFreqMax.value }

  if (selectedBand.value.type === 'Peaking') {
    return generatePeakingFillPath(selectedBand.value, options)
  } else if (selectedBand.value.type === 'Notch') {
    return generateNotchHaloPath(selectedBand.value, options)
  }
  return ''
})

const focusAreaRect = computed(() => {
  if (!selectedBand.value) return null
  const options = { width: 1000, height: 400, sampleRate: eq.sampleRate, freqMax: plotFreqMax.value }

  if (selectedBand.value.type === 'LowShelf' || selectedBand.value.type === 'HighShelf') {
    return generateShelfTintRect(selectedBand.value, options)
  } else if (selectedBand.value.type === 'LowPass' || selectedBand.value.type === 'HighPass') {
    return generatePassFilterTint(selectedBand.value, options)
  } else if (selectedBand.value.type === 'BandPass') {
    return generateBandPassTintRect(selectedBand.value, options)
  }
  return null
})

const bandwidthMarkers = computed(() => {
  if (!vizOptions.showBandwidthMarkers || !selectedBand.value) {
    return { leftFreq: null, rightFreq: null }
  }
  return calculateBandwidthMarkers(selectedBand.value)
})
</script>
