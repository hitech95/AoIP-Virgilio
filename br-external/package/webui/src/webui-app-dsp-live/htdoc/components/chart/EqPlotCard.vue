<template>
  <!-- The graph is ALWAYS visible: grid, curves and the FFT spectrum canvas
         render even when no filter block is selected. -->
  <el-container direction="vertical" class="plot-card">
    <el-header height="auto" class="plot-card__header">
      <!-- Top labels: octave (C1-C9) + frequency region rows. Every cell is
           placed with the same log mapping as the plot gridlines (freqToX
           over 10..fMax, fMax = fs/2 capped at 30k): chips are inset 2px
           inside their exact span, so the gap between them is centered on
           the true boundary at any sample rate. -->
      <div class="strip octaves">
        <div
          v-for="s in octaveSegs"
          :key="`o${s.f1}`"
          class="cell"
          :class="{ spacer: s.spacer }"
          :style="cellStyle(s)"
        >{{ s.label }}</div>
      </div>
      <div class="strip regions">
        <div
          v-for="s in regionSegs"
          :key="`r${s.f1}`"
          class="cell"
          :style="cellStyle(s)"
        >{{ s.label }}</div>
      </div>
    </el-header>

    <!-- Plot (SVG curve grid+ tokens + spectrum canvas + gain scale) -->
    <el-main class="plot-card__main">
      <EqPlotArea />
    </el-main>

    <!-- X labels: below the chart -->
    <el-footer class="plot-card__footer">
      <div class="x-labels">
        <template v-for="freq in majorTicks" :key="`tick${freq}`">
            <span v-if="freq !== 10 && freq !== plotFreqMax" class="freq-label"
            :style="{ left: `${(freqToX(freq, 1000, plotFreqMax) / 1000) * 100}%` }">
            {{ formatFreq(freq) }}
          </span>
        </template>
      </div>
    </el-footer>
  </el-container>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import EqPlotArea from './EqPlotArea.vue'
import { eq } from '../../stores/eqStore'
import {
  freqToX,
  formatFreq,
  octaveSegments,
  regionSegments,
  generateFrequencyTicks,
} from '../../lib/eqPlotMath'
import type { FilterStepInfo } from '../../lib/camillaEqMapping'

const plotFreqMax = computed(() => Math.min(30000, eq.sampleRate / 2))
const octaveSegs = computed(() => octaveSegments(plotFreqMax.value))
const regionSegs = computed(() => regionSegments(plotFreqMax.value))
const xPct = (f: number) => freqToX(f, 1000, plotFreqMax.value) / 10
/* Cells sit 2px inside their exact span: the visible gap between adjacent
   chips is centered on the true boundary, so it stays on the gridline. */
const cellStyle = (s: { f1: number; f2: number }) => ({
  left: `calc(${xPct(s.f1)}% + 2px)`,
  width: `calc(${xPct(s.f2) - xPct(s.f1)}% - 4px)`,
})
const majorTicks = computed(() => generateFrequencyTicks(plotFreqMax.value).majors)

const currentStep = computed<FilterStepInfo | null>(
  () => eq.steps.find((s) => s.index === eq.selectedStepIndex) ?? null
)

</script>
