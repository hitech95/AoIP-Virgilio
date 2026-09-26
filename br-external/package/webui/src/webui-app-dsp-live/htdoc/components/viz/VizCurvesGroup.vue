<template>
  <VizSection
    group-id="curves"
    :expanded-width="200"
    :title="$t('Spectrum Curves')"
    :disabled="!vizOptions.spectrumEnabled"
    :disabled-tooltip="$t('Enable the FFT spectrum to configure the analyzer')"
    :data-lta="vizOptions.showLTA ? 'on' : 'off'"
    :data-sta="vizOptions.showSTA ? 'on' : 'off'"
    :data-peak="vizOptions.showPeak ? 'on' : 'off'"
  >
    <template #glyph>
      <svg width="22" height="22" viewBox="0 0 24 24" aria-hidden="true">
        <line class="glyphPeak" x1="4" y1="7" x2="20" y2="7" />
        <line class="glyphSta" x1="4" y1="12" x2="20" y2="12" />
        <line class="glyphLta" x1="4" y1="17" x2="20" y2="17" />
      </svg>
    </template>

    <div class="row">
      <div class="waveStack">
          <svg viewBox="0 0 120 24" xmlns="http://www.w3.org/2000/svg">
            <defs>
              <linearGradient id="eqLtaGrad" x1="0" y1="0" x2="120" y2="0" gradientUnits="userSpaceOnUse">
                <stop class="stop" offset="0%" />
                <stop class="stop" offset="50%" />
                <stop class="stop" offset="100%" />
              </linearGradient>
              <filter id="eqLtaGlow" x="-20%" y="-100%" width="140%" height="300%">
                <feGaussianBlur stdDeviation="1.4" result="blur" />
                <feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge>
              </filter>
              <pattern id="eqLtaWaveP" width="60" height="24" patternUnits="userSpaceOnUse">
                <path
                  d="M0 12 C10 12 10 8.5 15 8.5 S20 15.5 30 15.5 S40 8.5 45 8.5 S50 12 60 12"
                  stroke="url(#eqLtaGrad)" fill="none" stroke-width="1.6" stroke-linecap="round" opacity="0.85" />
                <animateTransform
                  attributeName="patternTransform"
                  type="translate" from="0 0" to="-60 0" dur="9s" repeatCount="indefinite" />
              </pattern>

              <linearGradient id="eqStaGrad" x1="0" y1="0" x2="120" y2="0" gradientUnits="userSpaceOnUse">
                <stop class="stop" offset="0%" />
                <stop class="stop" offset="55%" />
                <stop class="stop" offset="100%" />
              </linearGradient>
              <filter id="eqStaGlow" x="-20%" y="-120%" width="140%" height="340%">
                <feGaussianBlur stdDeviation="2" result="blur" />
                <feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge>
              </filter>
              <pattern id="eqStaWaveP" width="40" height="24" patternUnits="userSpaceOnUse">
                <path
                  d="M0 12 C4 12 5 5 10 5 S16 19 20 19 S26 5 30 5 S36 12 40 12"
                  stroke="url(#eqStaGrad)" fill="none" stroke-width="2" stroke-linecap="round" />
                <animateTransform
                  attributeName="patternTransform"
                  type="translate" from="0 0" to="-40 0" dur="4.5s" repeatCount="indefinite" />
              </pattern>

              <linearGradient id="eqPeakGrad" x1="0" y1="0" x2="120" y2="0" gradientUnits="userSpaceOnUse">
                <stop class="stop" offset="0%" />
                <stop class="stop" offset="45%" />
                <stop class="stop" offset="100%" />
              </linearGradient>
              <filter id="eqPeakGlow" x="-20%" y="-140%" width="140%" height="380%">
                <feGaussianBlur stdDeviation="2.4" result="blur" />
                <feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge>
              </filter>
              <pattern id="eqPeakWaveP" width="40" height="24" patternUnits="userSpaceOnUse">
                <path
                  d="M0 10 L5 7 L8 11 L11 4 L14 9 L18 6 L21 12 L25 5 L29 9 L32 6 L36 10 L40 9"
                  stroke="url(#eqPeakGrad)" fill="none" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" />
                <animateTransform
                  attributeName="patternTransform"
                  type="translate" from="0 0" to="-40 0" dur="2.8s" repeatCount="indefinite" />
              </pattern>
            </defs>

            <line class="waveFlat" x1="2" y1="12" x2="118" y2="12" />
            <rect class="ltaFill" x="2" y="0" width="116" height="24" fill="url(#eqLtaWaveP)" filter="url(#eqLtaGlow)" />
            <rect class="staFill" x="2" y="0" width="116" height="24" fill="url(#eqStaWaveP)" filter="url(#eqStaGlow)" />
            <rect class="peakFill" x="2" y="0" width="116" height="24" fill="url(#eqPeakWaveP)" filter="url(#eqPeakGlow)" />
          </svg>
        </div>

        <VizChip
          :active="vizOptions.showLTA"
          type="primary"
          :title="$t('Long-term average (slow)')"
          @click="vizOptions.showLTA = !vizOptions.showLTA"
        >
          LTA
        </VizChip>
        <VizChip
          :active="vizOptions.showSTA"
          type="success"
          :title="$t('Short-term average (fast)')"
          @click="vizOptions.showSTA = !vizOptions.showSTA"
        >
          STA
        </VizChip>
        <VizChip
          :active="vizOptions.showPeak"
          type="warning"
          :title="$t('Peak hold')"
          @click="vizOptions.showPeak = !vizOptions.showPeak"
        >
          Peak
        </VizChip>
        <VizChip
          :title="$t('Reset STA/LTA/Peak averages')"
          :aria-label="$t('Reset averages')"
          @click="resetAveragesTick.count++"
        >
          <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true">
            <path d="M20 12a8 8 0 1 1-2.1-5.4" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" />
            <path d="M19.8 3.8v3.9h-3.9" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" />
          </svg>
        </VizChip>
      </div>
    </VizSection>
</template>

<script setup lang="ts">
import { vizOptions, resetAveragesTick } from '../../stores/vizOptions'
import VizChip from '../VizChip.vue'
import VizSection from '../viz/VizSection.vue'
</script>

<i18n src="../../locale.json"/>
