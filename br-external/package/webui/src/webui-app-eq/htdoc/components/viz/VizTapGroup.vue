<template>
  <div
    class="groupContainer expanded"
    data-group="tap"
    :data-sel="vizOptions.spectrumMode"
    style="--expandedWidth: 256px"
  >
    <div class="stubGlyph">
      <svg width="22" height="22" viewBox="0 0 24 24" aria-hidden="true">
        <line class="g-line" x1="3" y1="12" x2="9.5" y2="12" />
        <rect class="g-block" x="9.5" y="9.5" width="5" height="5" rx="1" />
        <circle class="g-node" data-pos="pre" cx="6" cy="12" r="3" />
        <circle class="g-node" data-pos="post" cx="18" cy="12" r="3" />
        <line class="g-line" x1="14.5" y1="12" x2="21" y2="12" />
      </svg>
    </div>

    <div class="groupStub" role="button" tabindex="0" aria-label="Spectrum signal tap"></div>

    <div class="groupExpanded">
      <div class="groupTitle">Spectrum Signal Tap</div>
      <div class="sigTapGroup" :data-sel="vizOptions.spectrumMode">
        <svg class="sigTap" viewBox="0 0 190 50" width="190" height="50" xmlns="http://www.w3.org/2000/svg">
          <defs>
            <filter id="eqTapGlow" x="-100%" y="-100%" width="300%" height="300%">
              <feGaussianBlur stdDeviation="2.2" result="blur" />
              <feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge>
            </filter>
          </defs>

          <line class="sigLine" x1="6" y1="30" x2="72" y2="30" />
          <line class="sigSegActive pre" x1="6" y1="30" x2="72" y2="30" />

          <rect class="eqBlock" x="72" y="20" width="46" height="20" rx="3" />
          <path class="eqBlockCurve" d="M76 30 C80 30 83 23 95 23 C107 23 110 30 114 30" />
          <text class="eqBlockLabel" x="95" y="17">EQ</text>

          <line class="sigLine" x1="118" y1="30" x2="184" y2="30" />
          <line class="sigSegActive post" x1="118" y1="30" x2="184" y2="30" />

          <g
            class="tap"
            data-pos="pre"
            role="button"
            tabindex="0"
            aria-label="Analyze signal before EQ (input)"
            @click="vizOptions.spectrumMode = 'pre'"
            @keydown.enter="vizOptions.spectrumMode = 'pre'"
          >
            <title>Analyze signal before EQ (input)</title>
            <line class="tapStem" x1="42" y1="10" x2="42" y2="24.5" />
            <circle class="tapNode" cx="42" cy="30" r="5.5" />
            <circle class="tapHead" cx="42" cy="7" r="3.5" />
            <text class="tapLabel" x="42" y="46">PRE</text>
          </g>

          <g
            class="tap"
            data-pos="post"
            role="button"
            tabindex="0"
            aria-label="Analyze signal after EQ (output)"
            @click="vizOptions.spectrumMode = 'post'"
            @keydown.enter="vizOptions.spectrumMode = 'post'"
          >
            <title>Analyze signal after EQ (output)</title>
            <line class="tapStem" x1="148" y1="10" x2="148" y2="24.5" />
            <circle class="tapNode" cx="148" cy="30" r="5.5" />
            <circle class="tapHead" cx="148" cy="7" r="3.5" />
            <text class="tapLabel" x="148" y="46">POST</text>
          </g>
        </svg>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { vizOptions } from '../../stores/vizOptions'
</script>
