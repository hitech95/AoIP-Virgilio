<template>
  <div class="heatmap-settings" :class="{ compact }">
    <div class="section labelled stacked" :class="{ span2: compact }">
      <span class="label">{{ $t('Fill') }}</span>
      <el-radio-group
        size="small"
        :model-value="fillMode"
        :disabled="rtaMode"
        @update:model-value="(m: HeatmapFillMode) => emit('change', { fillMode: m })"
      >
        <el-radio-button value="under">{{ $t('Under') }}</el-radio-button>
        <el-radio-button value="above">{{ $t('Above') }}</el-radio-button>
        <el-radio-button value="background">{{ $t('Background') }}</el-radio-button>
      </el-radio-group>
    </div>

    <!-- Tuning disclosure: collapsed by default, reveals the opacity chain
         sliders (Contrast/Gain/Gate/Max α drive the fill live) -->
    <div v-if="compact" class="section labelled span2 tuning-toggle">
      <button
        type="button"
        class="tuning-btn"
        :aria-expanded="tuningOpen"
        @click="tuningOpen = !tuningOpen"
      >
        <svg
          viewBox="0 0 24 24"
          width="11"
          height="11"
          aria-hidden="true"
          :style="{ transform: tuningOpen ? 'rotate(90deg)' : 'none' }"
        >
          <path d="M8 5l8 7-8 7" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" />
        </svg>
        {{ $t('Tuning') }}
      </button>
    </div>

    <div v-for="p in params" v-show="!compact || tuningOpen" :key="p.key" class="section labelled knob-row">
      <el-tooltip v-if="p.key === 'gateThreshold'" :content="$t('Visual threshold in dBFS; independent of Offset and Gain. Does not affect audio.')" placement="top">
        <span class="label" tabindex="0">{{ $t(p.label) }}</span>
      </el-tooltip>
      <el-tooltip v-else-if="p.key === 'magnitudeGain' && rtaMode" :content="$t('Color sensitivity: 1.0 is neutral; higher values make quieter bars reach red sooner.')" placement="top">
        <span class="label" tabindex="0">{{ $t(p.label) }}</span>
      </el-tooltip>
      <span v-else class="label">{{ $t(p.label) }}</span>
      <el-slider
        class="knob-slider"
        size="small"
        :model-value="p.key === 'magnitudeGain' ? Math.log2(props[p.key]) : props[p.key]"
        :disabled="rtaMode && p.key === 'alphaGamma'"
        :min="p.min"
        :max="p.max"
        :step="p.step"
        :format-tooltip="(v: number) => p.fmt(p.key === 'magnitudeGain' ? 2 ** v : v)"
        @update:model-value="(v: number) => emit('change', { [p.key]: p.round(p.key === 'magnitudeGain' ? 2 ** v : v) })"
      />
      <span class="val">{{ p.fmt(props[p.key]) }}</span>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import type { HeatmapFillMode } from '../rendering/canvasLayers/SpectrumHeatmapLayer'

const props = defineProps<{
  /** two-column dense layout for inline (non-popover) use */
  compact?: boolean
  rtaMode?: boolean
  fillMode: HeatmapFillMode
  alphaGamma: number
  magnitudeGain: number
  gateThreshold: number
  maxAlpha: number
}>()

const emit = defineEmits<{
  (e: 'change', changes: {
    fillMode?: HeatmapFillMode
    alphaGamma?: number
    magnitudeGain?: number
    gateThreshold?: number
    maxAlpha?: number
  }): void
}>()

const tuningOpen = ref(false)

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
    min: -2,
    max: 2,
    step: 0.05,
    round: (v: number) => Math.round(v * 100) / 100,
    fmt: (v: number) => `${v.toFixed(2)}×`,
  },
  {
    key: 'gateThreshold' as const,
    label: 'Gate',
    min: -90,
    max: 0,
    step: 1,
    round: (v: number) => Math.round(v),
    fmt: (v: number) => `${v.toFixed(0)} dBFS`,
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

<style scoped lang="scss">
.heatmap-settings:not(.compact) {
  display: flex;
  flex-direction: column;
  gap: 14px;

  .labelled {
    display: flex;
    align-items: center;
    gap: 10px;
  }

  .stacked {
    flex-direction: column;
    align-items: flex-start;
  }

  .knob-row .label { min-width: 65px; }
  .knob-slider { flex: 1; }
  .val { min-width: 64px; text-align: right; font-variant-numeric: tabular-nums; }
}
/* inline (compact) layout: fits the viz bar. Label-above-control rows;
 * Element Plus components keep their default styling here. */
.heatmap-settings.compact {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 2px 14px;
  align-items: center;
  min-width: 0;

  .section {
    margin: 0;
    line-height: 1.2;

    &.labelled {
      display: flex;
      align-items: center;
      gap: 6px;
    }

    &.stacked {
      flex-direction: column;
      align-items: flex-start;

      .label {
        color: var(--el-text-color-secondary);
      }
    }

    &.span2 {
      grid-column: 1 / -1;
    }

    &.tuning-toggle {
      .tuning-btn {
        display: inline-flex;
        align-items: center;
        gap: 5px;
        background: none;
        border: none;
        padding: 2px 0;
        color: var(--el-text-color-secondary);
        font: inherit;
        font-size: 12px;
        cursor: pointer;

        &:hover {
          color: var(--el-text-color-primary);
        }

        svg {
          transition: transform 0.18s ease;
        }
      }
    }

    &.knob-row {
      .knob-slider {
        flex: 1;
        min-width: 0;
      }

      .val {
        min-width: 30px;
        text-align: right;
        font-variant-numeric: tabular-nums;
        color: var(--el-text-color-secondary);
      }
    }
  }
}
</style>
