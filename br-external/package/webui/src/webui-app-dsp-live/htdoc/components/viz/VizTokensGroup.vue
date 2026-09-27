<template>
  <VizSection
    group-id="tokens"
    :title="$t('Token Visuals')"
    :data-curves="vizOptions.showPerBandCurves ? 'on' : 'off'"
    :data-bw="vizOptions.showBandwidthMarkers ? 'on' : 'off'"
    :data-solo="vizOptions.soloWhileEditing ? 'on' : 'off'"
    :style="{ '--tokenFill': String(vizOptions.bandFillOpacity) }"
  >
    <template #glyph>
      <svg width="22" height="22" viewBox="0 0 22 22" aria-hidden="true">
        <line class="tokGlyph-base" x1="2.01" y1="15.19" x2="20" y2="15.19" />

        <g transform="matrix(0.816941,0,0,1,2.00812,4.19545)">
          <path class="tokGlyph-shade" d="M0,11 C3.047,11 4.286,6 7.333,6 C9.754,6 11.11,11.01 14.028,10.997 C15.929,10.989 18.3,10.965 22,11 Z" />
        </g>

        <g transform="matrix(0.816941,0,0,1,2.00812,4.19545)">
          <path class="tokGlyph-curveB" d="M0,11 C1.083,11 1.583,2 2.666,2 C3.749,2 4.249,11 5.332,11 C6.415,11 6.915,2 7.998,2 C9.081,2 9.581,11 10.664,11 C11.747,11 12.247,2 13.33,2 C14.413,2 14.913,11 15.996,11 C17.079,11 17.579,2 18.662,2 C19.745,2 20.245,11 21.328,11" />
        </g>

        <g transform="matrix(0.816941,0,0,1,2.00812,4.19545)">
          <path class="tokGlyph-curveA" d="M0,11 C3.047,11 4.286,6 7.333,6 C9.754,6 11.11,11.01 14.028,10.997 C15.929,10.989 18.3,10.965 22,11" />
        </g>

        <circle class="tokGlyph-dot" cx="7.93" cy="8" r="3" />
      </svg>
    </template>

    <div class="row">
        <VizChip
          :active="vizOptions.showPerBandCurves"
          :aria-pressed="vizOptions.showPerBandCurves"
          :title="$t('Show per-band response curves')"
          @click="vizOptions.showPerBandCurves = !vizOptions.showPerBandCurves"
        >
          Per-band
        </VizChip>
        <VizChip
          :active="vizOptions.showBandwidthMarkers"
          :aria-pressed="vizOptions.showBandwidthMarkers"
          :title="$t('Show bandwidth (Q) markers')"
          @click="vizOptions.showBandwidthMarkers = !vizOptions.showBandwidthMarkers"
        >
          BW
        </VizChip>
        <VizChip
          :active="vizOptions.soloWhileEditing"
          :aria-pressed="vizOptions.soloWhileEditing"
          :title="$t('Solo the selected band while editing (mutes all others)')"
          @click="vizOptions.soloWhileEditing = !vizOptions.soloWhileEditing"
        >
          Solo
        </VizChip>
        <span
          class="opacity-slider-inline"
          :title="$t('Band fill opacity')"
          :aria-label="$t('Band fill opacity')"
        >
          <el-slider
            class="opacity-slider"
            size="small"
            :model-value="Math.round(vizOptions.bandFillOpacity * 100)"
            :min="0"
            :max="100"
            :step="1"
            :format-tooltip="(v) => `${v}%`"
            @update:model-value="(v) => (vizOptions.bandFillOpacity = Math.max(0, Math.min(1, v / 100)))"
          />
          <span class="opacity-val">{{ Math.round(vizOptions.bandFillOpacity * 100) }}%</span>
        </span>
      </div>
    </VizSection>
</template>

<script setup lang="ts">
import { vizOptions } from '../../stores/vizOptions'
import VizChip from '../VizChip.vue'
import VizSection from '../viz/VizSection.vue'
</script>

<style scoped lang="scss">
.viz-section {
  .tokGlyph-base {
    stroke: var(--el-border-color-darker);
    stroke-width: 1;
    stroke-linecap: round;
  }

  .tokGlyph-curveA,
  .tokGlyph-curveB {
    fill: none;
    stroke-linecap: round;
  }

  .tokGlyph-curveA {
    stroke: var(--el-color-primary);
    stroke-width: 1.6;
    opacity: 0.95;
  }

  .tokGlyph-curveB {
    stroke: var(--el-color-success);
    stroke-width: 1.3;
    opacity: 0;
    transition: opacity 0.18s ease;
  }

  .tokGlyph-shade {
    fill: var(--el-color-primary);
    fill-opacity: var(--tokenFill, 0.4);
    transition: fill-opacity 0.18s ease;
  }

  .tokGlyph-dot {
    fill: var(--el-fill-color-darker);
    stroke: var(--el-color-success);
    stroke-width: 0.8;
    opacity: 0;
    transition: opacity 0.18s ease;
  }

  &[data-curves='on'] .tokGlyph-curveB {
    opacity: 0.95;
  }

  &[data-solo='on'] .tokGlyph-dot {
    opacity: 1;
  }
}
</style>

<i18n src="../../locale.json"/>

<style scoped lang="scss">
.opacity-slider-inline {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}

.opacity-slider {
  width: 72px;
}

.opacity-val {
  font-size: var(--el-font-size-extra-small);
  color: var(--el-text-color-secondary);
  min-width: 32px;
  text-align: right;
}
</style>
