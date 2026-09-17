<template>
  <div class="band-order-icon" :title="displayTitle" v-html="svgWithDisplay"></div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import svgRaw from '../../assets/band-order-icons.svg?raw'

const props = withDefaults(
  defineProps<{
    /** Position to display (1-20) */
    position?: number
    /** Optional title (defaults to "Band N" if not provided) */
    title?: string
  }>(),
  { position: 1, title: '' }
)

const clampedPosition = computed(() => Math.max(1, Math.min(20, Math.floor(props.position))))

// Generate SVG with the selected position made visible.
// All groups have display="none" by default; the selected one becomes inline.
const svgWithDisplay = computed(() => {
  const targetId = `pos${String(clampedPosition.value).padStart(2, '0')}`
  const regex = new RegExp(`(<g id="${targetId}"[^>]*display=")none(")`, 'g')
  return svgRaw.replace(regex, '$1inline$2')
})

const displayTitle = computed(() => props.title || `Band ${clampedPosition.value}`)
</script>
