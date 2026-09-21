<template>
  <!-- Tokens (band handles) - compensated ellipses to remain circular when stretched -->
  <g class="tokens">
    <g
      v-for="(t, i) in tokenData"
      :key="i"
      class="token-group"
      :class="{ dimmed: t.shouldDim }"
      :style="{ '--band-color': `var(--band-${(i % 10) + 1})` }"
      :transform="t.tokenTransform"
    >
      <!-- Selection halo (only when selected, 20% bigger = 1.8x) -->
      <circle
        v-if="selectedBandIndex === i"
        :r="TOKEN_RADIUS * 1.8"
        fill="none"
        stroke="var(--band-color)"
        stroke-width="2"
        opacity="0.3"
        class="token-halo"
        pointer-events="none"
        filter="url(#halo-blur)"
      />

      <!-- Q arc indicator (6px wide, outside token, butt caps) -->
      <path
        :d="t.arcPath"
        fill="none"
        stroke="var(--band-color)"
        :stroke-width="t.arcStrokeWidth"
        stroke-linecap="butt"
        opacity="0.85"
        class="token-arc"
        pointer-events="none"
      />

      <!-- Transparent center (17px radius) -->
      <circle
        :r="t.centerRadius"
        style="fill: color-mix(in srgb, var(--band-color) 35%, var(--eq-token-fill) 65%)"
        fill-opacity="0.85"
        pointer-events="none"
      />

      <!-- Invisible hit area (full 20px radius for easy grabbing) -->
      <circle
        :r="TOKEN_RADIUS"
        fill="transparent"
        class="band-token-hitarea"
        :class="{ 'shift-mode': shiftPressed }"
        :data-band-index="i"
        :data-selected="selectedBandIndex === i"
        @pointerdown="(e) => onPointerDown(e, i)"
        @pointermove="onPointerMove"
        @pointerup="onPointerUp"
        @wheel="(e) => onWheel(e, i)"
      />

      <!-- Token ring (visible 3px ring: 20px outer, 17px inner) -->
      <circle
        :r="t.ringCenterRadius"
        fill="none"
        stroke="var(--band-color)"
        :stroke-width="t.ringStrokeWidth"
        class="band-token-ring"
        pointer-events="none"
      />

      <!-- Center index number -->
      <text
        x="0"
        y="0"
        text-anchor="middle"
        dominant-baseline="central"
        class="token-index"
        pointer-events="none"
      >
        {{ bandOrderNumbers[i] ?? i + 1 }}
      </text>

      <!-- Labels group with smooth boundary-aware positioning -->
      <g
        v-if="t.showLabels"
        class="token-labels"
        :transform="`translate(${t.labelTranslateX} ${t.labelTranslateY})`"
      >
        <!-- Frequency label -->
        <text
          :x="0"
          :y="t.hzLabelY"
          text-anchor="middle"
          dominant-baseline="hanging"
          class="token-label-freq"
          pointer-events="none"
        >
          <tspan class="freq-number">{{ t.freqNum }}</tspan>
          <tspan class="freq-unit" dx="2"> Hz</tspan>
        </text>

        <!-- Q label -->
        <text
          :x="0"
          :y="t.qLabelY"
          text-anchor="middle"
          dominant-baseline="hanging"
          class="token-label-q"
          pointer-events="none"
        >
          {{ t.qLabel }}
        </text>
      </g>
    </g>
  </g>

  <!-- SVG filter definitions for halo blur -->
  <defs>
    <filter id="halo-blur">
      <feGaussianBlur in="SourceGraphic" stdDeviation="2" />
    </filter>
  </defs>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import type { EqBand } from '../../lib/filterResponse'
import {
  formatTokenFrequency,
  formatTokenQ,
  qToSweepDeg,
  describeEllipseArcPath,
  labelShiftFactor,
} from '../../lib/tokenUtils'
import { freqToX, gainToY } from '../../lib/eqPlotMath'

const props = withDefaults(
  defineProps<{
    bands: EqBand[]
    /** Pipeline-relative position (1-based) for each band */
    bandOrderNumbers?: number[]
    selectedBandIndex: number | null
    plotWidth: number
    plotHeight: number
    freqMax?: number
    shiftPressed: boolean
    /** dim unselected tokens in focus mode */
    focusMode?: boolean
    /** dim non-active tokens during solo */
    soloActiveBandIndex?: number | null
  }>(),
  { bandOrderNumbers: () => [], freqMax: 30000, focusMode: false, soloActiveBandIndex: null }
)

const emit = defineEmits<{
  (e: 'tokenPointerDown', payload: { bandIndex: number; event: PointerEvent }): void
  (e: 'tokenPointerMove', payload: { event: PointerEvent }): void
  (e: 'tokenPointerUp', payload: { event: PointerEvent }): void
  (e: 'tokenWheel', payload: { bandIndex: number; event: WheelEvent }): void
}>()

const TOKEN_RADIUS = 20
const CENTER_RADIUS = 17
const ARC_STROKE_WIDTH = 6
const ARC_GAP = 3

// Pointer capture is handled here so the parent only deals with drag logic.
function onPointerDown(event: PointerEvent, bandIndex: number) {
  const el = event.currentTarget as SVGElement
  el?.setPointerCapture(event.pointerId)
  emit('tokenPointerDown', { bandIndex, event })
}

function onPointerMove(event: PointerEvent) {
  emit('tokenPointerMove', { event })
}

function onPointerUp(event: PointerEvent) {
  const el = event.currentTarget as SVGElement
  try {
    el?.releasePointerCapture(event.pointerId)
  } catch {
    // capture already released
  }
  emit('tokenPointerUp', { event })
}

function onWheel(event: WheelEvent, bandIndex: number) {
  emit('tokenWheel', { bandIndex, event })
}

interface TokenDatum {
  tokenTransform: string
  arcPath: string
  arcStrokeWidth: number
  centerRadius: number
  ringCenterRadius: number
  ringStrokeWidth: number
  shouldDim: boolean
  showLabels: boolean
  hzLabelY: number
  qLabelY: number
  freqNum: string
  qLabel: string
  labelTranslateX: number
  labelTranslateY: number
}

const tokenData = computed<TokenDatum[]>(() => {
  const sx = props.plotWidth / 1000
  const sy = props.plotHeight / 400

  return props.bands.map((band, i) => {
    const cx = freqToX(band.freq, 1000, props.freqMax)
    const cy = gainToY(band.gain)

    const ringStrokeWidth = TOKEN_RADIUS - CENTER_RADIUS
    const ringCenterRadius = CENTER_RADIUS + ringStrokeWidth / 2

    const sweepDeg = qToSweepDeg(band.q)
    const arcCenterRadius = TOKEN_RADIUS + ARC_GAP + ARC_STROKE_WIDTH / 2
    const tokenTransform = `translate(${cx} ${cy}) scale(${1 / sx} ${1 / sy})`
    const arcPath = describeEllipseArcPath({
      cx: 0,
      cy: 0,
      rx: arcCenterRadius,
      ry: arcCenterRadius,
      startDeg: -sweepDeg / 2,
      endDeg: sweepDeg / 2,
    })

    const freqNum = formatTokenFrequency(band.freq)
    const qLabel = formatTokenQ(band.q)
    const hzLabelY = TOKEN_RADIUS + 10
    const qLabelY = hzLabelY + 14 + 5
    const labelBlockHeight = 14 + 5 + 14
    const shiftT = labelShiftFactor(cy, props.plotHeight)

    // Side placement logic: move labels to left/right based on X position
    const isLeftHalf = cx < 500
    const sideSign = isLeftHalf ? 1 : -1
    const sideDistance = 70
    const sideFreqY = -labelBlockHeight / 2

    // Interpolate from "below" (0,0) to "side" (sideDistance, sideFreqY)
    const targetDeltaX = sideSign * sideDistance
    const targetDeltaY = sideFreqY - hzLabelY
    const labelTranslateX = shiftT * targetDeltaX
    const labelTranslateY = shiftT * targetDeltaY

    const isSelected = props.selectedBandIndex === i
    const shouldDim =
      (props.focusMode && !isSelected) ||
      !band.enabled ||
      (props.soloActiveBandIndex !== null && props.soloActiveBandIndex !== i)
    const showLabels = !props.focusMode || isSelected

    return {
      tokenTransform,
      arcPath,
      arcStrokeWidth: ARC_STROKE_WIDTH,
      centerRadius: CENTER_RADIUS,
      ringCenterRadius,
      ringStrokeWidth,
      shouldDim,
      showLabels,
      hzLabelY,
      qLabelY,
      freqNum,
      qLabel,
      labelTranslateX,
      labelTranslateY,
    }
  })
})
</script>
