<template>
  <!-- The graph is ALWAYS visible: grid, curves and the FFT spectrum canvas
         render even when no filter block is selected. -->
  <el-container direction="vertical" class="plot-card">
    <el-header height="auto">
      <!-- Top labels: octave (C1-C9) + frequency region rows -->
      <div class="octaves" :style="{ gridTemplateColumns: octaveColumns }">
        <div class="cell spacer"></div>
        <div v-for="c in ['C1', 'C2', 'C3', 'C4', 'C5', 'C6', 'C7', 'C8', 'C9']" :key="c" class="cell">{{ c }}</div>
        <div class="cell spacer"></div>
      </div>
      <div class="regions" :style="{ gridTemplateColumns: regionColumns }">
        <div v-for="r in ['SUB', 'BASS', 'LOW MID', 'MID', 'HIGH MID', 'PRS', 'TREBLE']" :key="r" class="cell">{{ r }}
        </div>
      </div>
    </el-header>

    <!-- Plot (SVG curve grid+ tokens + spectrum canvas + gain scale) -->
    <el-main>
      <EqPlotArea />
    </el-main>

    <!-- X labels: below the chart -->
    <el-footer>
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
  calcOctaveWidths,
  calcRegionWidths,
  generateFrequencyTicks,
} from '../../lib/eqPlotMath'
import type { FilterStepInfo } from '../../lib/camillaEqMapping'

const plotFreqMax = computed(() => Math.min(30000, eq.sampleRate / 2))
const octaveColumns = computed(() => calcOctaveWidths(plotFreqMax.value).map((w) => `${w}fr`).join(' '))
const regionColumns = computed(() => calcRegionWidths(plotFreqMax.value).map((w) => `${w}fr`).join(' '))
const majorTicks = computed(() => generateFrequencyTicks(plotFreqMax.value).majors)

const currentStep = computed<FilterStepInfo | null>(
  () => eq.steps.find((s) => s.index === eq.selectedStepIndex) ?? null
)

</script>
