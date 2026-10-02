<template>
  <VizSection
    group-id="heatmap"
    :title="$t('Heatmap')"
    dense
    toggle
    :toggle-value="vizOptions.heatmapEnabled"
    :toggle-title="$t('Enables the spectrum heatmap display')"
    @update:toggle-value="(v) => (vizOptions.heatmapEnabled = v)"
    :disabled="!vizOptions.spectrumEnabled"
    :disabled-tooltip="$t('Enable the FFT spectrum to configure the analyzer')"
    :body-dimmed="!vizOptions.heatmapEnabled"
    :data-power="vizOptions.heatmapEnabled ? 'on' : 'off'"
  >
    <template #header-actions>
      <el-popover trigger="click" placement="bottom-end" :width="320" :title="$t('Heatmap settings')">
        <template #reference>
          <el-button size="small" :aria-label="$t('Heatmap settings')" :title="$t('Heatmap settings')">
            <el-icon><Setting /></el-icon>
          </el-button>
        </template>
        <HeatmapSettings
          :rta-mode="vizOptions.spectrumSeries === 'rta'"
          :fill-mode="vizOptions.heatmapFillMode"
          :alpha-gamma="vizOptions.heatmapAlphaGamma"
          :magnitude-gain="vizOptions.heatmapMagnitudeGain"
          :gate-threshold="vizOptions.heatmapGateThreshold"
          :max-alpha="vizOptions.heatmapMaxAlpha"
          @change="applyHeatmapChange"
        />
      </el-popover>
    </template>
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

  </VizSection>
</template>

<script setup lang="ts">
import { vizOptions } from '../../stores/vizOptions'
import { Setting } from '@element-plus/icons-vue'
import HeatmapSettings from '../HeatmapSettings.vue'
import VizSection from '../viz/VizSection.vue'
import type { HeatmapFillMode } from '../../rendering/canvasLayers/SpectrumHeatmapLayer'

function applyHeatmapChange(changes: {
  fillMode?: HeatmapFillMode
  alphaGamma?: number
  magnitudeGain?: number
  gateThreshold?: number
  maxAlpha?: number
}) {
  if (changes.fillMode !== undefined) vizOptions.heatmapFillMode = changes.fillMode
  if (changes.alphaGamma !== undefined) vizOptions.heatmapAlphaGamma = changes.alphaGamma
  if (changes.magnitudeGain !== undefined) vizOptions.heatmapMagnitudeGain = changes.magnitudeGain
  if (changes.gateThreshold !== undefined) vizOptions.heatmapGateThreshold = changes.gateThreshold
  if (changes.maxAlpha !== undefined) vizOptions.heatmapMaxAlpha = changes.maxAlpha
}
</script>

<style scoped lang="scss">
.viz-section {
  .glyphHeatmap {
    opacity: 0.3;
    transition: opacity 0.28s ease;
  }

  &[data-power='on'] .glyphHeatmap {
    opacity: 1;
  }
}

</style>

<i18n src="../../locale.json"/>
