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
