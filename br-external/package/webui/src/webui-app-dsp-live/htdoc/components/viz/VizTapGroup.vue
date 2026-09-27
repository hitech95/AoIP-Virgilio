<template>
  <VizSection
    group-id="tap"
    :title="$t('Spectrum Signal Tap')"
    body-justify="center"
    body-align="center"
    toggle
    :toggle-value="vizOptions.spectrumEnabled"
    :toggle-title="$t('Enables the FFT spectrum analysis (computation heavy)')"
    @update:toggle-value="(v) => (vizOptions.spectrumEnabled = v)"
    :data-sel="vizOptions.spectrumMode"
  >
    <template #glyph>
      <svg width="22" height="22" viewBox="0 0 24 24" aria-hidden="true">
        <line class="g-line" x1="3" y1="12" x2="9.5" y2="12" />
        <rect class="g-block" x="9.5" y="9.5" width="5" height="5" rx="1" />
        <circle class="g-node" data-pos="pre" cx="6" cy="12" r="3" />
        <circle class="g-node" data-pos="post" cx="18" cy="12" r="3" />
        <line class="g-line" x1="14.5" y1="12" x2="21" y2="12" />
      </svg>
    </template>

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
            :aria-label="$t('Analyze signal before EQ (input)')"
            @click="vizOptions.spectrumMode = 'pre'"
            @keydown.enter="vizOptions.spectrumMode = 'pre'"
          >
            <title>{{ $t('Analyze signal before EQ (input)') }}</title>
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
            :aria-label="$t('Analyze signal after EQ (output)')"
            @click="vizOptions.spectrumMode = 'post'"
            @keydown.enter="vizOptions.spectrumMode = 'post'"
          >
            <title>{{ $t('Analyze signal after EQ (output)') }}</title>
            <line class="tapStem" x1="148" y1="10" x2="148" y2="24.5" />
            <circle class="tapNode" cx="148" cy="30" r="5.5" />
            <circle class="tapHead" cx="148" cy="7" r="3.5" />
            <text class="tapLabel" x="148" y="46">POST</text>
          </g>
        </svg>
    </div>
  </VizSection>
</template>

<script setup lang="ts">
import { vizOptions } from '../../stores/vizOptions'
import VizSection from '../viz/VizSection.vue'
</script>

<style scoped lang="scss">
.viz-section {
  /* stub glyph */
  .groupStub {
    .g-line {
      stroke: var(--el-border-color-darker);
      stroke-width: 1.3;
      stroke-linecap: round;
    }

    .g-block {
      fill: var(--el-fill-color-dark);
      stroke: var(--el-border-color-darker);
      stroke-width: 1;
    }

    .g-node {
      fill: var(--el-fill-color-darker);
      stroke: var(--el-border-color-darker);
      stroke-width: 1.4;
      transition: fill 0.2s ease, stroke 0.2s ease;
    }
  }

  &[data-sel='pre'] .g-node[data-pos='pre'],
  &[data-sel='post'] .g-node[data-pos='post'] {
    fill: var(--el-color-primary);
    stroke: var(--el-color-primary);
  }

  /* body diagram */
  .sigTapGroup {
    display: block;
  }

  .sigTap {
    display: block;
    width: 100%;
    height: auto;
  }

  .sigLine {
    stroke: var(--el-border-color-darker);
    stroke-width: 1.3;
  }

  .sigSegActive {
    stroke: var(--el-color-primary);
    stroke-width: 1.3;
    opacity: 0;
    transition: opacity 0.2s ease;
  }

  .eqBlock {
    fill: var(--el-fill-color-dark);
    stroke: var(--el-border-color-darker);
    stroke-width: 1;
  }

  .eqBlockCurve {
    fill: none;
    stroke: var(--el-color-primary);
    stroke-width: 1;
    stroke-linecap: round;
    opacity: 0.6;
  }

  .eqBlockLabel,
  .tapLabel {
    fill: var(--el-text-color-secondary);
    font-size: var(--el-font-size-extra-small);
    font-family: var(--el-font-family);
    text-anchor: middle;
  }

  .eqBlockLabel {
    dominant-baseline: middle;
  }

  .tap {
    cursor: pointer;

    &:hover {
      .tapNode,
      .tapStem {
        stroke: var(--el-color-primary);
      }

      .tapHead {
        fill: var(--el-color-primary);
      }

      .tapLabel {
        fill: var(--el-text-color-primary);
      }
    }
  }

  .tapNode {
    fill: var(--el-fill-color-darker);
    stroke: var(--el-border-color-darker);
    stroke-width: 1.5;
    transition: fill 0.2s ease, stroke 0.2s ease;
  }

  .tapStem {
    stroke: var(--el-border-color-darker);
    stroke-width: 1;
    stroke-dasharray: 2 2;
    transition: stroke 0.2s ease;
  }

  .tapHead {
    fill: var(--el-border-color-darker);
    transition: fill 0.2s ease;
  }

  .tapLabel {
    transition: fill 0.2s ease;
    user-select: none;
  }

  &[data-sel='pre'] {
    .sigSegActive.pre {
      opacity: 1;
    }

    .tap[data-pos='pre'] {
      .tapNode,
      .tapStem,
      .tapHead {
        stroke: var(--el-color-primary);
        fill: var(--el-color-primary);
      }

      .tapStem {
        stroke-dasharray: none;
      }

      .tapLabel {
        fill: var(--el-color-primary);
      }
    }
  }

  &[data-sel='post'] {
    .sigSegActive.post {
      opacity: 1;
    }

    .tap[data-pos='post'] {
      .tapNode,
      .tapStem,
      .tapHead {
        stroke: var(--el-color-primary);
        fill: var(--el-color-primary);
      }

      .tapStem {
        stroke-dasharray: none;
      }

      .tapLabel {
        fill: var(--el-color-primary);
      }
    }
  }
}
</style>

<i18n src="../../locale.json"/>
