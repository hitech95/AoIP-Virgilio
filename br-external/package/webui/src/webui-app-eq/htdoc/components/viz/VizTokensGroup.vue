<template>
  <div
    class="groupContainer expanded"
    data-group="tokens"
    :data-curves="vizOptions.showPerBandCurves ? 'on' : 'off'"
    :data-bw="vizOptions.showBandwidthMarkers ? 'on' : 'off'"
    :data-solo="vizOptions.soloWhileEditing ? 'on' : 'off'"
    :style="{ '--expandedWidth': '270px', '--tokenFill': String(vizOptions.bandFillOpacity) }"
  >
    <div class="stubGlyph">
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
    </div>

    <div class="groupStub" role="button" tabindex="0" aria-label="Token visuals"></div>

    <div class="groupExpanded">
      <div class="groupTitle">Token Visuals</div>
      <div class="row">
        <VizChip
          :active="vizOptions.showPerBandCurves"
          :aria-pressed="vizOptions.showPerBandCurves"
          title="Show per-band response curves"
          @click="vizOptions.showPerBandCurves = !vizOptions.showPerBandCurves"
        >
          Per-band
        </VizChip>
        <VizChip
          :active="vizOptions.showBandwidthMarkers"
          :aria-pressed="vizOptions.showBandwidthMarkers"
          title="Show bandwidth (Q) markers"
          @click="vizOptions.showBandwidthMarkers = !vizOptions.showBandwidthMarkers"
        >
          BW
        </VizChip>
        <VizChip
          :active="vizOptions.soloWhileEditing"
          :aria-pressed="vizOptions.soloWhileEditing"
          title="Solo the selected band while editing (mutes all others)"
          @click="vizOptions.soloWhileEditing = !vizOptions.soloWhileEditing"
        >
          Solo
        </VizChip>
        <span
          class="knob-wrapper-inline"
          style="--knob-arc: var(--el-color-primary)"
          title="Band fill opacity (Shift = fine adjust)"
          aria-label="Band fill opacity"
        >
          <KnobDial
            :value="vizOptions.bandFillOpacity"
            :min="0"
            :max="1"
            scale="linear"
            :size="20"
            @change="(p) => (vizOptions.bandFillOpacity = Math.max(0, Math.min(1, p.value)))"
          />
        </span>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { vizOptions } from '../../stores/vizOptions'
import KnobDial from '../KnobDial.vue'
import VizChip from '../VizChip.vue'
</script>
