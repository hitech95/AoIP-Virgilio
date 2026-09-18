<template>
  <el-card
    shadow="hover"
    class="fader-card"
    :style="{ '--fader-color': color, '--fader-width': width }"
    @pointerdown.capture="emit('activate')"
  >
    <template #header>
      <slot name="header" />
    </template>

    <div ref="sliderBox" class="fader-card__slider" :class="{ 'is-dimmed': dimmed }">
      <el-slider
        vertical
        height="100%"
        :model-value="modelValue"
        :min="min"
        :max="max"
        :step="step"
        :marks="marks"
        :disabled="disabled"
        :format-tooltip="formatTooltip"
        @input="(value: number) => emit('input', value)"
      />
    </div>

    <template #footer>
      <div class="fader-card__footer">
        <slot name="footer" />
      </div>
    </template>
  </el-card>
</template>

<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue'
import { blockRunwayPointer } from '../lib/sliderInteraction'

withDefaults(
  defineProps<{
    modelValue: number
    color: string
    width?: string
    min?: number
    max?: number
    step?: number
    marks?: Record<number, string>
    disabled?: boolean
    dimmed?: boolean
    formatTooltip?: (value: number) => string
  }>(),
  {
    width: '100px',
    min: -24,
    max: 24,
    step: 0.5,
    marks: () => ({}),
    disabled: false,
    dimmed: false,
    formatTooltip: (value: number) => `${value > 0 ? '+' : ''}${value.toFixed(1)} dB`,
  }
)

const emit = defineEmits<{
  (event: 'input', value: number): void
  (event: 'activate'): void
}>()
const sliderBox = ref<HTMLElement | null>(null)
let releaseSliderGuard: (() => void) | null = null

onMounted(() => {
  releaseSliderGuard = blockRunwayPointer(sliderBox.value)
})

onBeforeUnmount(() => {
  releaseSliderGuard?.()
  releaseSliderGuard = null
})
</script>

<style scoped lang="scss">
.fader-card {
  --band-color: var(--fader-color);
  --band-ink: var(--fader-color);
  --fader-control-font-size: 13px;
  --fader-label-font-size: 12px;

  box-sizing: border-box;
  display: flex;
  flex: 0 0 var(--fader-width);
  flex-direction: column;
  width: var(--fader-width);
  height: 100%;

  :deep(.el-slider.is-vertical),
  :deep(.el-slider__runway) {
    height: 100%;
  }

  :deep(.el-slider__runway) {
    margin: 0 !important;
  }

  :deep(.el-slider__bar) {
    background: var(--fader-color);
  }

  :deep(.el-slider__button) {
    border-color: var(--fader-color);
  }

  :deep(.el-slider__marks) {
    pointer-events: none;
  }

  :deep(.el-slider__marks-stop) {
    width: 4px;
    height: 4px;
    border: none;
    border-radius: 50%;
    transform: translate(-50%, -50%);
    background: var(--el-text-color-secondary);
    opacity: 0.55;
  }

  :deep(.el-slider__marks-text) {
    display: none;
  }
}

/* Element Plus renders these nodes inside its own component scope. Use exact
   global direct-child selectors instead of scoped/deep nesting: it keeps PRE
   and filter cards on the same 35px / plot-body / 120px-footer geometry. */
:global(.fader-card > .el-card__header) {
  box-sizing: border-box;
  flex: 0 0 var(--eq-align-head);
  height: var(--eq-align-head);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 0 4px;
}

:global(.fader-card > .el-card__body) {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  padding: var(--eq-fader-gap) 0 var(--eq-axis-h);
}

:global(.fader-card > .el-card__footer) {
  box-sizing: border-box;
  flex: 0 0 var(--eq-vizbar-h);
  height: var(--eq-vizbar-h);
  min-height: 0;
  padding: 0;
}

.fader-card__slider {
  flex: 1 1 0;
  min-height: 0;
  display: flex;
  justify-content: center;

  &.is-dimmed {
    opacity: 0.35;
    pointer-events: none;
  }
}

.fader-card__footer {
  box-sizing: border-box;
  height: 100%;
  min-height: 0;
  /* Simple stack: the footer renders app-defined slot content, so it must
     not impose a column grid (grid auto-placement pushed sibling steppers
     into shared rows). Each stepper owns its input+buttons layout. */
  display: flex;
  flex-direction: column;
  justify-content: flex-end;
  gap: 6px;
  padding: 0 4px 8px;
}
</style>
