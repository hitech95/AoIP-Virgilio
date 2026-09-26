<template>
  <VizSection
    group-id="heatmap"
    :expanded-width="290"
    :title="$t('Heatmap')"
    dense
    toggle
    :toggle-value="vizOptions.heatmapEnabled"
    :toggle-title="$t('Enable or disable the heatmap')"
    @update:toggle-value="(v) => (vizOptions.heatmapEnabled = v)"
    :disabled="!vizOptions.spectrumEnabled"
    :disabled-tooltip="$t('Enable the FFT spectrum to configure the analyzer')"
    :data-power="vizOptions.heatmapEnabled ? 'on' : 'off'"
  >
    <template #glyph>
      <svg class="glyphHeatmap" width="22" height="22" viewBox="0 0 24 24" aria-hidden="true">
        <rect x="3" y="3" width="5" height="5" rx=".8" fill="var(--el-color-danger)" opacity=".12" />
        <rect x="10" y="3" width="5" height="5" rx=".8" fill="var(--el-color-danger)" opacity=".28" />
        <rect x="17" y="3" width="5" height="5" rx=".8" fill="var(--el-color-danger)" opacity=".5" />
        <rect x="3" y="10" width="5" height="5" rx=".8" fill="var(--el-color-danger)" opacity=".28" />
        <rect x="10" y="10" width="5" height="5" rx=".8" fill="var(--el-color-danger)" opacity=".55" />
        <rect x="17" y="10" width="5" height="5" rx=".8" fill="var(--el-color-danger)" opacity=".8" />
        <rect x="3" y="17" width="5" height="5" rx=".8" fill="var(--el-color-danger)" opacity=".5" />
        <rect x="10" y="17" width="5" height="5" rx=".8" fill="var(--el-color-danger)" opacity=".8" />
        <rect x="17" y="17" width="5" height="5" rx=".8" fill="var(--el-color-danger)" opacity="1" />
      </svg>
    </template>

    <div class="heatmap-inline" :class="{ 'heatmap-off': !vizOptions.heatmapEnabled }">
      <HeatmapSettings
        compact
        :mask-mode="vizOptions.heatmapMaskMode"
        :high-precision="vizOptions.heatmapHighPrecision"
        :alpha-gamma="vizOptions.heatmapAlphaGamma"
        :magnitude-gain="vizOptions.heatmapMagnitudeGain"
        :gate-threshold="vizOptions.heatmapGateThreshold"
        :max-alpha="vizOptions.heatmapMaxAlpha"
        @change="applyHeatmapChange"
      />
    </div>
  </VizSection>
</template>

<script setup lang="ts">
import { vizOptions } from '../../stores/vizOptions'
import HeatmapSettings from '../HeatmapSettings.vue'
import VizSection from '../viz/VizSection.vue'
import type { HeatmapMaskMode } from '../../rendering/canvasLayers/SpectrumHeatmapLayer'

function applyHeatmapChange(changes: {
  maskMode?: HeatmapMaskMode
  highPrecision?: boolean
  alphaGamma?: number
  magnitudeGain?: number
  gateThreshold?: number
  maxAlpha?: number
}) {
  if (changes.maskMode !== undefined) vizOptions.heatmapMaskMode = changes.maskMode
  if (changes.highPrecision !== undefined) vizOptions.heatmapHighPrecision = changes.highPrecision
  if (changes.alphaGamma !== undefined) vizOptions.heatmapAlphaGamma = changes.alphaGamma
  if (changes.magnitudeGain !== undefined) vizOptions.heatmapMagnitudeGain = changes.magnitudeGain
  if (changes.gateThreshold !== undefined) vizOptions.heatmapGateThreshold = changes.gateThreshold
  if (changes.maxAlpha !== undefined) vizOptions.heatmapMaxAlpha = changes.maxAlpha
}
</script>

<i18n src="../../locale.json"/>

<style scoped>
.heatmap-inline {
  min-width: 0;
  /* the settings body may exceed the fixed bar height: thin scroll */
  max-height: 100%;
  overflow-y: auto;
  scrollbar-width: thin;
}

/* settings are meaningless while the heatmap is off */
.heatmap-off {
  opacity: 0.5;
  pointer-events: none;
}
</style>

