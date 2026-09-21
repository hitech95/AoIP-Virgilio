<!--
  AccordionStrip.vue - generic responsive horizontal accordion container.
  Slotted groups must expose a matching data-group value for each definition.
-->
<template>
  <div ref="hostEl" class="accordion-strip visual-container">
    <div ref="viewportEl" class="accordion-strip__viewport">
      <div class="accordion-strip__edge-fade accordion-strip__edge-fade--left"></div>
      <div class="accordion-strip__edge-fade accordion-strip__edge-fade--right"></div>
      <div ref="stripEl" class="accordion-strip__content">
        <slot />
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue'
import { VizLayoutManager, type VizGroup } from '../lib/vizLayoutManager'

export interface AccordionStripGroup {
  id: string
  priority: number
  expandedWidth: number
}

const props = defineProps<{ groups: AccordionStripGroup[]; stubWidth?: number }>()

const hostEl = ref<HTMLDivElement | null>(null)
const viewportEl = ref<HTMLDivElement | null>(null)
const stripEl = ref<HTMLDivElement | null>(null)
let layoutManager: VizLayoutManager | null = null
let removeViewportListeners: (() => void) | null = null

onMounted(() => {
  const host = hostEl.value
  const viewport = viewportEl.value
  const strip = stripEl.value
  if (!host || !viewport || !strip) return

  const groups: VizGroup[] = props.groups.flatMap((group) => {
    const el = strip.querySelector(`[data-group='${group.id}']`) as HTMLElement | null
    return el ? [{ ...group, el }] : []
  })
  if (groups.length !== props.groups.length) return

  layoutManager = new VizLayoutManager(host, viewport, strip, groups, {
    stubWidth: props.stubWidth ?? 44,
  })

  let down = false
  let dragging = false
  let startX = 0
  let startScroll = 0
  let pointerId: number | null = null
  const threshold = 4

  const handlePointerDown = (event: PointerEvent) => {
    if (!viewport.classList.contains('constrained')) return
    down = true
    dragging = false
    startX = event.clientX
    startScroll = viewport.scrollLeft
    pointerId = event.pointerId
  }
  const handlePointerMove = (event: PointerEvent) => {
    if (!down) return
    if (!dragging && Math.abs(event.clientX - startX) > threshold) {
      dragging = true
      if (pointerId !== null) viewport.setPointerCapture(pointerId)
    }
    if (dragging) viewport.scrollLeft = startScroll - (event.clientX - startX)
  }
  const finishPointer = (event?: PointerEvent) => {
    down = false
    dragging = false
    if (!event) return
    try { viewport.releasePointerCapture(event.pointerId) } catch { /* Not captured. */ }
  }
  const handlePointerCancel = () => finishPointer()
  const handleWheel = (event: WheelEvent) => {
    if (!viewport.classList.contains('constrained') || Math.abs(event.deltaY) <= Math.abs(event.deltaX)) return
    if (viewport.scrollWidth <= viewport.clientWidth + 1) return
    event.preventDefault()
    viewport.scrollLeft += event.deltaY
  }

  viewport.addEventListener('pointerdown', handlePointerDown)
  viewport.addEventListener('pointermove', handlePointerMove)
  viewport.addEventListener('pointerup', finishPointer)
  viewport.addEventListener('pointercancel', handlePointerCancel)
  viewport.addEventListener('wheel', handleWheel, { passive: false })
  removeViewportListeners = () => {
    viewport.removeEventListener('pointerdown', handlePointerDown)
    viewport.removeEventListener('pointermove', handlePointerMove)
    viewport.removeEventListener('pointerup', finishPointer)
    viewport.removeEventListener('pointercancel', handlePointerCancel)
    viewport.removeEventListener('wheel', handleWheel)
  }
})

onBeforeUnmount(() => {
  removeViewportListeners?.()
  layoutManager?.destroy()
})
</script>

<style scoped lang="scss">
.accordion-strip {
  height: 100%;
  box-sizing: border-box;
}

.accordion-strip__viewport {
  position: relative;
  height: 100%;
  /* Include the border in the parent-reserved height. */
  box-sizing: border-box;
  border: 1px solid var(--el-border-color-lighter);
  border-radius: 8px;
  overflow: hidden;
  min-width: 0;
}

.accordion-strip__viewport.constrained {
  overflow-x: auto;
  overflow-y: hidden;
}

.accordion-strip__edge-fade {
  pointer-events: none;
  position: absolute;
  top: 0;
  bottom: 0;
  width: 28px;
  opacity: 0;
  transition: opacity 0.18s ease;
  z-index: 10;
}

.accordion-strip__edge-fade--left {
  left: 0;
  background: linear-gradient(90deg, var(--el-bg-color) 0%, transparent 100%);
  border-top-left-radius: 8px;
  border-bottom-left-radius: 8px;
}

.accordion-strip__edge-fade--right {
  right: 0;
  background: linear-gradient(270deg, var(--el-bg-color) 0%, transparent 100%);
  border-top-right-radius: 8px;
  border-bottom-right-radius: 8px;
}

.accordion-strip__viewport.hasLeftOverflow .accordion-strip__edge-fade--left,
.accordion-strip__viewport.hasRightOverflow .accordion-strip__edge-fade--right {
  opacity: 1;
}

.accordion-strip__content {
  height: 100%;
  display: flex;
  align-items: stretch;
}
</style>
