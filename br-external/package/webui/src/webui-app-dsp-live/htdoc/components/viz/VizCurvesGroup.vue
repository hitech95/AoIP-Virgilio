<template>
  <VizSection
    group-id="curves"
    :title="$t('Spectrum')"
    toggle
    :toggle-value="vizOptions.spectrumEnabled"
    :toggle-title="$t('Enables the FFT spectrum analysis (computation heavy)')"
    :body-dimmed="!vizOptions.spectrumEnabled"
    :data-rta="vizOptions.spectrumSeries === 'rta' ? 'on' : 'off'"
    :data-lta="vizOptions.spectrumSeries === 'lta' ? 'on' : 'off'"
    :data-sta="vizOptions.spectrumSeries === 'sta' ? 'on' : 'off'"
    :data-peak="vizOptions.showPeak ? 'on' : 'off'"
    body-align="start"
    body-justify="space-evenly"
    @update:toggle-value="(v) => (vizOptions.spectrumEnabled = v)"
  >
    <template #header-actions>
      <el-tooltip :content="$t('Reset STA/LTA/Peak averages')" placement="top">
        <el-button size="small" :aria-label="$t('Reset averages')" @click="resetAveragesTick.count++">
          <svg viewBox="0 0 24 24" width="12" height="12" aria-hidden="true">
            <path d="M20 12a8 8 0 1 1-2.1-5.4" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" />
            <path d="M19.8 3.8v3.9h-3.9" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" />
          </svg>
        </el-button>
      </el-tooltip>
    </template>
    <template #glyph>
      <svg width="22" height="22" viewBox="0 0 24 24" aria-hidden="true">
        <line class="glyphPeak" x1="4" y1="7" x2="20" y2="7" />
        <line class="glyphSta" x1="4" y1="12" x2="20" y2="12" />
        <line class="glyphLta" x1="4" y1="17" x2="20" y2="17" />
      </svg>
    </template>

    <div class="row series-row">
      <el-button-group :aria-label="$t('Spectrum')">
        <el-tooltip :content="$t('Bars of the instantaneous spectrum')" placement="top">
          <el-button size="small" type="primary" :plain="vizOptions.spectrumSeries !== 'rta'"
            :aria-pressed="vizOptions.spectrumSeries === 'rta'" @click="vizOptions.spectrumSeries = 'rta'">RTA</el-button>
        </el-tooltip>
        <el-tooltip :content="$t('Short-term average (fast)')" placement="top">
          <el-button size="small" type="success" :plain="vizOptions.spectrumSeries !== 'sta'"
            :aria-pressed="vizOptions.spectrumSeries === 'sta'" @click="vizOptions.spectrumSeries = 'sta'">STA</el-button>
        </el-tooltip>
        <el-tooltip :content="$t('Long-term average (slow)')" placement="top">
          <el-button size="small" type="primary" :plain="vizOptions.spectrumSeries !== 'lta'"
            :aria-pressed="vizOptions.spectrumSeries === 'lta'" @click="vizOptions.spectrumSeries = 'lta'">LTA</el-button>
        </el-tooltip>
      </el-button-group>
      <span class="series-spacer" aria-hidden="true"></span>
      <VizChip :active="vizOptions.showPeak" type="warning" :title="$t('Peak hold')"
        @click="vizOptions.showPeak = !vizOptions.showPeak">Peak</VizChip>
    </div>
    <div v-show="false" class="row offset-row">
      <el-tooltip :content="$t('Shifts the displayed dBFS window; does not change audio gain or level colors.')" placement="top">
        <span class="offset-label" tabindex="0">{{ $t('Offset') }}</span>
      </el-tooltip>
      <el-slider size="small" class="offset-slider" :model-value="vizOptions.spectrumTrimDb"
        :min="-12" :max="12" :step="1"
        :format-tooltip="(v: number) => `${v > 0 ? '+' : ''}${v} dB`"
        @update:model-value="(v: number) => (vizOptions.spectrumTrimDb = Math.round(v))" />
      <el-tooltip :content="$t('Reset offset to 0 dB')" placement="top">
        <el-button size="small" text class="offset-val" :aria-label="$t('Reset offset to 0 dB')"
          @click="vizOptions.spectrumTrimDb = 0">{{ vizOptions.spectrumTrimDb > 0 ? '+' : '' }}{{ vizOptions.spectrumTrimDb }} dB</el-button>
      </el-tooltip>
    </div>
    <div class="row">
      <el-tooltip :content="$t('High precision (slower, more stable)')" placement="top">
        <el-switch size="small" v-model="vizOptions.heatmapHighPrecision"
          :active-text="$t('High precision')" :aria-label="$t('High precision')" />
      </el-tooltip>
    </div>
  </VizSection>
</template>

<script setup lang="ts">
import { vizOptions, resetAveragesTick } from '../../stores/vizOptions'
import VizChip from '../VizChip.vue'
import VizSection from './VizSection.vue'
</script>

<style scoped lang="scss">
.viz-section {
  --expandedWidth: 280px;

  .series-row { width: 100%; flex-wrap: nowrap; }
  .series-spacer { flex: 1; }

  .offset-row {
    display: flex;
    align-items: center;
    gap: 8px;
    width: 100%;
    min-width: 0;

    .offset-label { color: var(--el-text-color-secondary); flex-shrink: 0; }
    .offset-slider { flex: 1; min-width: 0; }
    .offset-val {
      min-width: 38px;
      padding: 0 2px;
      text-align: right;
      font-variant-numeric: tabular-nums;
      color: var(--el-text-color-secondary);
      flex-shrink: 0;
    }
  }

  .glyphLta, .glyphSta, .glyphPeak { opacity: 0.25; transition: opacity 0.2s ease; }
  .glyphLta { stroke: var(--el-color-primary); }
  .glyphSta { stroke: var(--el-color-success); }
  .glyphPeak { stroke: var(--el-color-warning); }
  &[data-lta='on'] .glyphLta,
  &[data-sta='on'] .glyphSta,
  &[data-peak='on'] .glyphPeak { opacity: 1; }
}
</style>

<i18n src="../../locale.json"/>
