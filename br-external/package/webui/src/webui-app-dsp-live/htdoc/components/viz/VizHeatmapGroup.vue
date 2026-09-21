<template>
  <div
    class="groupContainer expanded"
    data-group="heatmap"
    :data-power="vizOptions.heatmapEnabled ? 'on' : 'off'"
    style="--expandedWidth: 210px"
  >
    <div class="stubGlyph">
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
    </div>

    <div class="groupStub" role="button" tabindex="0" :aria-label="$t('Heatmap')"></div>

    <div class="groupExpanded">
      <div class="groupTitle">{{ $t('Heatmap') }}</div>
      <div class="row">
        <VizChip
          class="heatmapToggle"
          :active="vizOptions.heatmapEnabled"
          type="danger"
          @click="vizOptions.heatmapEnabled = !vizOptions.heatmapEnabled"
        >
          <div class="halo">
            <svg width="30" height="30" viewBox="0 0 64 64">
              <defs>
                <radialGradient id="eqMetalGrad" cx="28%" cy="22%" r="72%" fx="28%" fy="22%">
                  <stop offset="0%" stop-color="#8a96a3" stop-opacity=".55" />
                  <stop offset="30%" stop-color="#5a6370" stop-opacity=".38" />
                  <stop offset="70%" stop-color="#2e343c" stop-opacity=".28" />
                  <stop offset="100%" stop-color="#1c2028" stop-opacity=".22" />
                </radialGradient>
                <linearGradient id="eqNeonGrad" x1="0" y1="0" x2="1" y2="1">
                  <stop class="stop" offset="0%" />
                  <stop class="stop" offset="50%" />
                  <stop class="stop" offset="100%" />
                </linearGradient>
                <radialGradient id="eqBloomGrad" cx="50%" cy="50%" r="50%">
                  <stop class="stop" offset="0%" stop-opacity=".22" />
                  <stop class="stop" offset="55%" stop-opacity=".07" />
                  <stop class="stop" offset="100%" stop-opacity="0" />
                </radialGradient>
                <filter id="eqNeonGlow" x="-30%" y="-30%" width="160%" height="160%">
                  <feGaussianBlur stdDeviation="1.5" result="blur" />
                  <feMerge>
                    <feMergeNode in="blur" />
                    <feMergeNode in="SourceGraphic" />
                  </feMerge>
                </filter>
              </defs>
              <circle class="bloom" cx="32" cy="32" r="28" fill="url(#eqBloomGrad)" />
              <circle class="ring-metal" cx="32" cy="32" r="18" stroke="url(#eqMetalGrad)" stroke-width="1.8" fill="none" />
              <circle class="ring-neon" cx="32" cy="32" r="18" stroke="url(#eqNeonGrad)" stroke-width="1.4" fill="none" filter="url(#eqNeonGlow)" />
              <circle class="dot" cx="32" cy="32" r="3.5" />
            </svg>
          </div>
          <span class="powerLabel">{{ $t('On / Off') }}</span>
        </VizChip>

        <el-popover
          v-model:visible="prefsOpen"
          placement="top-start"
          :width="270"
          trigger="click"
          :disabled="!vizOptions.heatmapEnabled"
        >
          <template #reference>
            <VizChip
              class="disclosureChip"
              :active="prefsOpen"
              :disabled="!vizOptions.heatmapEnabled"
              :title="$t('Heatmap settings')"
              :aria-label="$t('Heatmap settings')"
            >
              <span>{{ $t('Prefs') }}</span>
              <span class="arrow">▲</span>
            </VizChip>
          </template>
          <HeatmapSettings
            :mask-mode="vizOptions.heatmapMaskMode"
            :high-precision="vizOptions.heatmapHighPrecision"
            :alpha-gamma="vizOptions.heatmapAlphaGamma"
            :magnitude-gain="vizOptions.heatmapMagnitudeGain"
            :gate-threshold="vizOptions.heatmapGateThreshold"
            :max-alpha="vizOptions.heatmapMaxAlpha"
            @change="applyHeatmapChange"
          />
        </el-popover>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import { vizOptions } from '../../stores/vizOptions'
import HeatmapSettings from '../HeatmapSettings.vue'
import VizChip from '../VizChip.vue'
import type { HeatmapMaskMode } from '../../rendering/canvasLayers/SpectrumHeatmapLayer'

const prefsOpen = ref(false)

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
