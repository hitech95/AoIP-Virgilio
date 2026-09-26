<template>
  <div class="heatmap-settings" :class="{ compact }">
    <div class="section labelled" :class="{ span2: compact }">
      <span class="label">{{ $t('Mask') }}</span>
      <el-radio-group
        size="small"
        :model-value="maskMode"
        @update:model-value="(m: HeatmapMaskMode) => emit('change', { maskMode: m })"
      >
        <el-radio-button value="top">{{ $t('Top') }}</el-radio-button>
        <el-radio-button value="bottom">{{ $t('Bottom') }}</el-radio-button>
        <el-radio-button value="full">{{ $t('Full') }}</el-radio-button>
      </el-radio-group>
      <el-checkbox
        v-if="compact"
        size="small"
        :model-value="highPrecision"
        @update:model-value="(v: boolean) => emit('change', { highPrecision: v })"
      >
        {{ $t('High precision (slower, more stable)') }}
      </el-checkbox>
    </div>

    <div v-if="!compact" class="section">
      <el-checkbox
        size="small"
        :model-value="highPrecision"
        @update:model-value="(v: boolean) => emit('change', { highPrecision: v })"
      >
        {{ $t('High precision (slower, more stable)') }}
      </el-checkbox>
    </div>

    <div v-for="p in params" :key="p.key" class="section labelled knob-row">
      <span class="label">{{ $t(p.label) }}</span>
      <el-slider
        class="knob-slider"
        size="small"
        :model-value="props[p.key]"
        :min="p.min"
        :max="p.max"
        :step="p.step"
        :format-tooltip="p.fmt"
        @update:model-value="(v: number) => emit('change', { [p.key]: p.round(v) })"
      />
      <span class="val">{{ p.fmt(props[p.key]) }}</span>
    </div>
  </div>
</template>

<script setup lang="ts">
import type { HeatmapMaskMode } from '../rendering/canvasLayers/SpectrumHeatmapLayer'

const props = defineProps<{
  /** two-column dense layout for inline (non-popover) use */
  compact?: boolean
  maskMode: HeatmapMaskMode
  highPrecision: boolean
  alphaGamma: number
  magnitudeGain: number
  gateThreshold: number
  maxAlpha: number
}>()

const emit = defineEmits<{
  (e: 'change', changes: {
    maskMode?: HeatmapMaskMode
    highPrecision?: boolean
    alphaGamma?: number
    magnitudeGain?: number
    gateThreshold?: number
    maxAlpha?: number
  }): void
}>()

const params = [
  {
    key: 'alphaGamma' as const,
    label: 'Contrast',
    min: 0.8,
    max: 4.0,
    step: 0.1,
    round: (v: number) => Math.round(v * 10) / 10,
    fmt: (v: number) => v.toFixed(1),
  },
  {
    key: 'magnitudeGain' as const,
    label: 'Gain',
    min: 0.5,
    max: 4.0,
    step: 0.1,
    round: (v: number) => Math.round(v * 10) / 10,
    fmt: (v: number) => v.toFixed(1),
  },
  {
    key: 'gateThreshold' as const,
    label: 'Gate',
    min: 0.0,
    max: 0.2,
    step: 0.01,
    round: (v: number) => Math.round(v * 100) / 100,
    fmt: (v: number) => v.toFixed(2),
  },
  {
    key: 'maxAlpha' as const,
    label: 'Max α',
    min: 0.2,
    max: 1.0,
    step: 0.05,
    round: (v: number) => Math.round(v * 100) / 100,
    fmt: (v: number) => v.toFixed(2),
  },
]
</script>

<i18n src="../locale.json"/>

<style scoped>
/* inline (compact) layout: dense two-column grid that fits the viz bar */
.heatmap-settings.compact {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 1px 14px;
  align-items: center;
}

.heatmap-settings.compact .section {
  line-height: 1.2;
}

.heatmap-settings.compact .knob-row {
  height: 24px;
}

.heatmap-settings.compact .section {
  margin: 0;
}

.heatmap-settings.compact .section.labelled {
  display: flex;
  align-items: center;
  gap: 6px;
}

.heatmap-settings.compact .section.span2 {
  grid-column: 1 / -1;
}

.heatmap-settings.compact .section.span2 .el-checkbox {
  height: 24px;
  margin-left: auto;
  margin-right: 0;
}

.heatmap-settings.compact .knob-slider {
  flex: 1;
  min-width: 0;
}

.heatmap-settings.compact .knob-slider {
  flex: 1;
  min-width: 0;
}
</style>
