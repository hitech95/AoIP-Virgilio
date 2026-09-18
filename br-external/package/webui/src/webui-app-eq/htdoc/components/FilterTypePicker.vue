<template>
  <div class="filter-type-picker" :style="{ '--band-color': bandColor }">
    <el-button
      v-for="ft in filterTypes"
      :key="ft.type"
      class="filter-option"
      :class="{ 'is-current': ft.type === currentType }"
      plain
      :title="`${ft.label} — ${ft.subtitle}`"
      @click="handleSelect(ft.type)"
    >
      <span class="f-opt">
        <FilterIcon :type="ft.type" class="opt-icon" />
        <span class="opt-label">{{ ft.label }}</span>
        <span class="opt-subtitle">{{ ft.subtitle }}</span>
      </span>
    </el-button>
  </div>
</template>

<script setup lang="ts">
import type { EqBand } from '../lib/filterResponse'
import FilterIcon from './icons/FilterIcon.vue'

defineProps<{
  currentType: EqBand['type']
  /** Accent of the owning band card (CSS value), e.g. `var(--band-3)`. */
  bandColor?: string
}>()

const emit = defineEmits<{
  (e: 'select', type: EqBand['type']): void
}>()

// Available filter types (excludes AllPass, as in CamillaEQ)
const filterTypes: Array<{ type: EqBand['type']; label: string; subtitle: string }> = [
  { type: 'Peaking', label: 'Peaking', subtitle: 'Gain + Q' },
  { type: 'LowShelf', label: 'Low Shelf', subtitle: 'Gain + Q' },
  { type: 'HighShelf', label: 'High Shelf', subtitle: 'Gain + Q' },
  { type: 'HighPass', label: 'High Pass', subtitle: 'Q only' },
  { type: 'LowPass', label: 'Low Pass', subtitle: 'Q only' },
  { type: 'BandPass', label: 'Band Pass', subtitle: 'Q only' },
  { type: 'Notch', label: 'Notch', subtitle: 'Q only' },
]

function handleSelect(type: EqBand['type']) {
  emit('select', type)
}
</script>

<style scoped lang="scss">
.filter-type-picker {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 4px;
}

.filter-option.el-button {
  margin: 0;
  width: 100%;
  height: auto;
  min-height: 0;
  padding: 6px 2px;

  &:not(.is-current):hover,
  &:not(.is-current):focus {
    border-color: color-mix(in srgb, var(--band-color) 45%, var(--el-bg-color));
    background: color-mix(in srgb, var(--band-color) 12%, var(--el-bg-color));
    color: var(--band-color);

    .opt-subtitle {
      color: var(--band-color);
      opacity: 0.75;
    }
  }

  &.is-current {
    border-color: color-mix(in srgb, var(--band-color) 45%, var(--el-bg-color));
    background: color-mix(in srgb, var(--band-color) 12%, var(--el-bg-color));
    color: var(--band-color);

    &:hover,
    &:focus {
      border-color: var(--band-color);
      background: color-mix(in srgb, var(--band-color) 20%, var(--el-bg-color));
      color: var(--band-color);
    }

    .opt-subtitle {
      color: var(--band-color);
      opacity: 0.75;
    }
  }
}

.f-opt {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 2px;
}

.opt-icon {
  width: 18px;
  height: 18px;
  color: currentColor;
}

.opt-label {
  font-size: 12px;
  font-weight: 600;
  line-height: 1.1;
  text-align: center;
  white-space: normal;
}

.opt-subtitle {
  font-size: 11px;
  line-height: 1.1;
  text-align: center;
  white-space: normal;
  color: var(--el-text-color-secondary);
}
</style>
