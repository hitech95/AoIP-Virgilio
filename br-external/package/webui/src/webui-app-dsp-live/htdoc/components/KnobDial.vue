<template>
  <svg
    ref="svgEl"
    class="knob-dial"
    :class="{ dragging: isDragging }"
    :viewBox="`0 0 ${viewBoxSize} ${viewBoxSize}`"
    :width="viewBoxSize"
    :height="viewBoxSize"
    @pointerdown="handlePointerDown"
    @pointermove="handlePointerMove"
    @pointerup="handlePointerUp"
  >
    <!-- Knob body (neutral) -->
    <circle :cx="size / 2 + 6" :cy="size / 2 + 6" :r="size / 2" class="knob-body" />
    <!-- Value arc (accent-tinted) -->
    <path :d="arcPath" class="knob-arc" stroke-width="4.5" />
  </svg>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'

const props = withDefaults(
  defineProps<{
    /** frequency (10-30000) or Q (0.1-10) or custom range */
    value: number
    mode?: 'frequency' | 'q'
    /** knob diameter in px */
    size?: number
    /** optional custom range (overrides mode-based defaults) */
    min?: number
    max?: number
    scale?: 'linear' | 'log'
  }>(),
  { mode: 'frequency', size: 32, min: undefined, max: undefined, scale: 'linear' }
)

const emit = defineEmits<{ (e: 'change', payload: { value: number }): void }>()

const MIN_ANGLE = -135
const MAX_ANGLE = 135
void MAX_ANGLE

// Drag state
const isDragging = ref(false)
let startY = 0
let startValue = 0
const svgEl = ref<SVGSVGElement | null>(null)

function mapLog(value: number, inMin: number, inMax: number, outMin: number, outMax: number): number {
  const logValue = Math.log(value)
  const logMin = Math.log(inMin)
  const logMax = Math.log(inMax)
  return ((logValue - logMin) / (logMax - logMin)) * (outMax - outMin) + outMin
}

function mapLinear(value: number, inMin: number, inMax: number, outMin: number, outMax: number): number {
  return ((value - inMin) / (inMax - inMin)) * (outMax - outMin) + outMin
}

// Determine range based on mode or custom props
const rangeConfig = computed<{ min: number; max: number; scale: 'linear' | 'log' }>(() => {
  if (props.min !== undefined && props.max !== undefined) {
    return { min: props.min, max: props.max, scale: props.scale }
  }
  if (props.mode === 'frequency') {
    return { min: 10, max: 30000, scale: 'log' }
  }
  return { min: 0.1, max: 10, scale: 'linear' }
})

// Clamp value to range for arc computation (prevents visual looping)
const clampedValue = computed(() => {
  const { min, max } = rangeConfig.value
  return Math.min(max, Math.max(min, props.value))
})

// Calculate arc parameters based on range
const arcParams = computed(() => {
  const { min, max, scale } = rangeConfig.value

  let sweep: number
  if (scale === 'log') {
    sweep = mapLog(clampedValue.value, min, max, 30, 270)
  } else {
    sweep = mapLinear(clampedValue.value, min, max, 30, 270)
  }

  return { startAngle: MIN_ANGLE, endAngle: MIN_ANGLE + sweep }
})

const arcPath = computed(() => {
  const { startAngle, endAngle } = arcParams.value
  const radius = props.size / 2 + 4
  const centerX = props.size / 2 + 6
  const centerY = props.size / 2 + 6

  const startRad = (startAngle * Math.PI) / 180
  const endRad = (endAngle * Math.PI) / 180

  const x1 = centerX + radius * Math.sin(startRad)
  const y1 = centerY - radius * Math.cos(startRad)
  const x2 = centerX + radius * Math.sin(endRad)
  const y2 = centerY - radius * Math.cos(endRad)

  const largeArc = endAngle - startAngle > 180 ? 1 : 0

  return `M ${x1} ${y1} A ${radius} ${radius} 0 ${largeArc} 1 ${x2} ${y2}`
})

const viewBoxSize = computed(() => props.size + 12)

// Interaction handlers
function handlePointerDown(event: PointerEvent) {
  event.preventDefault()
  svgEl.value?.setPointerCapture(event.pointerId)

  isDragging.value = true
  startY = event.clientY
  startValue = props.value
}

function handlePointerMove(event: PointerEvent) {
  if (!isDragging.value) return

  const deltaY = startY - event.clientY // Inverted: up = increase
  const sensitivity = event.shiftKey ? 0.2 : 1.0 // Shift = fine adjustment
  const { min, max, scale } = rangeConfig.value

  let newValue: number
  if (scale === 'log') {
    const factor = Math.pow(1.01, deltaY * sensitivity)
    newValue = startValue * factor
  } else {
    const range = max - min
    const baseStep = range / 100 // 1% of range per pixel
    const step = event.shiftKey ? baseStep * 0.2 : baseStep
    newValue = startValue + deltaY * step
  }

  newValue = Math.min(max, Math.max(min, newValue))

  emit('change', { value: newValue })
}

function handlePointerUp(event: PointerEvent) {
  if (!isDragging.value) return

  svgEl.value?.releasePointerCapture(event.pointerId)
  isDragging.value = false
}
</script>
