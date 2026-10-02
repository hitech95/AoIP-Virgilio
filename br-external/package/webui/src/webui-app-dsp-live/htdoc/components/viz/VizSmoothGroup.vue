<template>
  <VizSection
    group-id="smooth"
    :title="$t('Curve Smoothing')"
    toggle
    :toggle-value="vizOptions.smoothingEnabled"
    :toggle-title="$t('Enables spectrum curve smoothing')"
    @update:toggle-value="(v) => (vizOptions.smoothingEnabled = v)"
    :disabled="!vizOptions.spectrumEnabled || vizOptions.spectrumSeries === 'rta'"
    :disabled-tooltip="!vizOptions.spectrumEnabled ? $t('Enable the FFT spectrum to configure the analyzer') : $t('Curve smoothing applies to STA/LTA only')"
    :body-dimmed="!vizOptions.smoothingEnabled"
    :data-smooth="smoothLevel"
  >
    <template #glyph>
      <svg width="22" height="22" viewBox="0 0 24 24" aria-hidden="true">
        <path class="gSmooth" data-level="0" d="M4 12 L7 8 L10 15 L13 8 L16 14 L20 12" />
        <path class="gSmooth" data-level="1" d="M4 14 C6 14 7 8 10 8 S14 14 17 14 S19 11 20 11" />
        <path class="gSmooth" data-level="2" d="M4 14 C7 14 8 7 12 7 S17 14 20 14" />
        <path class="gSmooth" data-level="3" d="M4 12 C9 5 15 18 20 12" />
      </svg>
    </template>

    <div class="row">
      <el-radio-group class="is-vertical-buttons" size="small"
        :model-value="vizOptions.smoothingMode"
        @update:model-value="(v) => (vizOptions.smoothingMode = v)"
      >
        <el-radio-button value="1/12" :title="$t('1/12-octave smoothing (most detail)')">1/12 Oct</el-radio-button>
        <el-radio-button value="1/6" :title="$t('1/6-octave smoothing (balanced)')">1/6 Oct</el-radio-button>
        <el-radio-button value="1/3" :title="$t('1/3-octave smoothing (smoothest)')">1/3 Oct</el-radio-button>
      </el-radio-group>
    </div>
  </VizSection>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { vizOptions, effectiveSmoothingMode } from '../../stores/vizOptions'
import VizSection from '../viz/VizSection.vue'

/* the stub glyph follows the effective smoothing: off when the toggle is */
const smoothLevel = computed(() => {
  switch (effectiveSmoothingMode.value) {
    case 'off':
      return '0'
    case '1/12':
      return '1'
    case '1/6':
      return '2'
    default:
      return '3'
  }
})

</script>

<style scoped lang="scss">
.viz-section {
  /* the stacked Oct buttons need less width than 220 */
  --expandedWidth: 170px;

  .gSmooth {
    fill: none;
    stroke: var(--el-color-success);
    stroke-width: 1.8;
    stroke-linecap: round;
    stroke-linejoin: round;
    opacity: 0;
    transition: opacity 0.2s ease;
  }

  &[data-smooth='0'] .gSmooth[data-level='0'],
  &[data-smooth='1'] .gSmooth[data-level='1'],
  &[data-smooth='2'] .gSmooth[data-level='2'],
  &[data-smooth='3'] .gSmooth[data-level='3'] {
    opacity: 0.85;
  }
}
</style>


<i18n src="../../locale.json"/>

<style scoped lang="scss">
.viz-section {
  /* the stacked Oct buttons need less width than 220 */
  --expandedWidth: 190px;
}
</style>
