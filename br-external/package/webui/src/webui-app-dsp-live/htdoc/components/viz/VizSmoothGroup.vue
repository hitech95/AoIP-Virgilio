<template>
  <div
    class="groupContainer expanded"
    data-group="smooth"
    :data-smooth="smoothLevel"
    style="--expandedWidth: 190px"
  >
    <div class="stubGlyph">
      <svg width="22" height="22" viewBox="0 0 24 24" aria-hidden="true">
        <path class="gSmooth" data-level="0" d="M4 12 L7 8 L10 15 L13 8 L16 14 L20 12" />
        <path class="gSmooth" data-level="1" d="M4 14 C6 14 7 8 10 8 S14 14 17 14 S19 11 20 11" />
        <path class="gSmooth" data-level="2" d="M4 14 C7 14 8 7 12 7 S17 14 20 14" />
        <path class="gSmooth" data-level="3" d="M4 12 C9 5 15 18 20 12" />
      </svg>
    </div>

    <div class="groupStub" role="button" tabindex="0" :aria-label="$t('Curve smoothing')"></div>

    <div class="groupExpanded">
      <div class="groupTitle">{{ $t('Curve Smoothing') }}</div>
      <div class="row">
        <VizChip
          :class="{ active: vizOptions.smoothingMode === 'off' }"
          :active="vizOptions.smoothingMode === 'off'"
          :title="$t('No smoothing (raw spectrum)')"
          @click="vizOptions.smoothingMode = 'off'"
        >
          {{ $t('Off') }}
        </VizChip>
        <VizChip
          :class="{ active: vizOptions.smoothingMode === '1/12' }"
          :active="vizOptions.smoothingMode === '1/12'"
          :title="$t('1/12-octave smoothing (most detail)')"
          @click="vizOptions.smoothingMode = '1/12'"
        >
          1/12 Oct
        </VizChip>
        <VizChip
          :class="{ active: vizOptions.smoothingMode === '1/6' }"
          :active="vizOptions.smoothingMode === '1/6'"
          :title="$t('1/6-octave smoothing (balanced)')"
          @click="vizOptions.smoothingMode = '1/6'"
        >
          1/6 Oct
        </VizChip>
        <VizChip
          :class="{ active: vizOptions.smoothingMode === '1/3' }"
          :active="vizOptions.smoothingMode === '1/3'"
          :title="$t('1/3-octave smoothing (smoothest)')"
          @click="vizOptions.smoothingMode = '1/3'"
        >
          1/3 Oct
        </VizChip>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { vizOptions } from '../../stores/vizOptions'
import VizChip from '../VizChip.vue'

const smoothLevel = computed(() => {
  switch (vizOptions.smoothingMode) {
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

<i18n src="../../locale.json"/>
