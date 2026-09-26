<!--
VizSection.vue — generic collapsible section of the visualization bar.

Renders the DOM contract consumed by AccordionStrip/VizLayoutManager
(.groupContainer with data-group, .stubGlyph, .groupStub, .groupExpanded,
--expandedWidth). Sections compose it with their glyph and body.

Features:
- collapsible: the layout manager collapses a section to its glyph stub;
  clicking the stub expands it (accordion semantics)
- optional header toggle: a small switch at the end of the title bar to
  enable/disable the feature the section configures
- disabled: the whole section stays visible but grays out and stops
  reacting (used for sections that depend on the FFT being enabled)
-->
<template>
  <div
    class="groupContainer viz-section"
    :class="{ 'viz-section--disabled': disabled, 'viz-section--dense': dense }"
    :data-group="groupId"
    :style="{ '--expandedWidth': `${expandedWidth}px` }"
  >
    <div class="stubGlyph"><slot name="glyph" /></div>

    <div class="groupStub" role="button" tabindex="0" :aria-label="title"></div>

    <div class="groupExpanded">
      <div class="groupTitle viz-section__title-row">
        <span class="viz-section__title">{{ title }}</span>
        <span class="viz-section__spacer"></span>
        <el-switch
          v-if="toggle"
          size="small"
          :model-value="toggleValue"
          :disabled="disabled"
          :title="toggleTitle"
          :aria-label="toggleTitle"
          @update:model-value="(v: boolean) => emit('update:toggleValue', v)"
        />
      </div>
      <div class="viz-section__body">
        <slot />
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
withDefaults(
  defineProps<{
    groupId: string
    title: string
    expandedWidth?: number
    disabled?: boolean
    /** show the enable/disable switch at the end of the title bar */
    toggle?: boolean
    toggleValue?: boolean
    toggleTitle?: string
    /** tooltip on the stub when the section is disabled */
    disabledTooltip?: string
    /** tighter title spacing for sections whose body needs the room */
    dense?: boolean
  }>(),
  { expandedWidth: 200, disabled: false, toggle: false, toggleValue: false, toggleTitle: '', disabledTooltip: '', dense: false }
)

const emit = defineEmits<{ (e: 'update:toggleValue', v: boolean): void }>()
</script>

<style scoped>
.viz-section--disabled {
  opacity: 0.45;
}

.viz-section--disabled .groupExpanded {
  pointer-events: none;
}

.viz-section--dense .groupTitle {
  margin-bottom: 0.3rem;
}

.viz-section--dense .groupExpanded {
  padding-top: 4px;
}

.viz-section__title-row {
  display: flex;
  align-items: center;
  gap: 8px;
}

.viz-section__spacer {
  flex: 1;
}
</style>
