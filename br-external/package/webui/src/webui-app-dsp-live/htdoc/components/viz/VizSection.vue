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
    ref="rootEl"
    class="groupContainer viz-section"
    :class="{ 'viz-section--disabled': disabled, 'viz-section--dense': dense, expanded: isExpanded }"
    :data-group="groupId"
  >
    <div
      class="groupStub"
      role="button"
      tabindex="0"
      :aria-label="title"
      :title="disabled && disabledTooltip ? disabledTooltip : title"
      @click="activateStub"
      @keydown.enter="activateStub"
      @keydown.space.prevent="activateStub"
    >
      <slot name="glyph" />
    </div>

    <div class="groupExpanded">
      <div class="groupTitle viz-section__title-row">
        <span class="viz-section__title">{{ title }}</span>
        <span class="viz-section__spacer"></span>
        <!-- per-section controls (e.g. the curves averages reset);
             the enable switch always stays last -->
        <span class="viz-section__actions"><slot name="header-actions" /></span>
        <el-tooltip
          v-if="toggle"
          :content="toggleTitle"
          placement="top"
          :disabled="disabled"
        >
          <el-switch
            size="small"
            :model-value="toggleValue"
            :disabled="disabled"
            :aria-label="toggleTitle"
            @update:model-value="(v: boolean) => emit('update:toggleValue', v)"
          />
        </el-tooltip>
      </div>
      <div
      class="viz-section__body"
      :class="{ 'viz-section__body--dim': bodyDimmed }"
      :style="{ alignItems: bodyAlign, justifyContent: bodyJustify }"
    >
        <slot />
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import { isGroupExpanded } from '../../lib/vizAccordion'

const rootEl = ref<HTMLDivElement | null>(null)
const props = withDefaults(
  defineProps<{
    groupId: string
    title: string
    disabled?: boolean
    /** show the enable/disable switch at the end of the title bar */
    toggle?: boolean
    toggleValue?: boolean
    toggleTitle?: string
    /** tooltip on the stub when the section is disabled */
    disabledTooltip?: string
    /** tighter title spacing for sections whose body needs the room */
    dense?: boolean
    /** vertical distribution of the body rows (flex justify-content) */
    bodyJustify?: string
    /** horizontal alignment of the body rows (flex align-items) */
    bodyAlign?: string
    /** dim the body while the feature switch is off (settings stay readable) */
    bodyDimmed?: boolean
  }>(),
  { disabled: false, toggle: false, toggleValue: false, toggleTitle: '', disabledTooltip: '', dense: false, bodyJustify: 'flex-start', bodyAlign: 'center', bodyDimmed: false }
)

const emit = defineEmits<{ (e: 'update:toggleValue', v: boolean): void }>()

const isExpanded = computed(() => isGroupExpanded(props.groupId))

function activateStub() {
  // bubbles to the AccordionStrip, which routes it to the layout manager
  rootEl.value?.dispatchEvent(
    new CustomEvent('viz-stub-activate', { bubbles: true, detail: { groupId: props.groupId } })
  )
}
</script>

<style scoped lang="scss">
/* ── generic section structure (owned by this component) ─────────────── */
.groupContainer {
  /* min width an expanded section needs; the strip reads this value
   * from the DOM for its collapse math. CSS-driven: per-section
   * overrides live in the sections' own scoped styles. */
  --expandedWidth: 220px;

  display: flex;
  width: 44px;
  height: 100%;
  flex: 0 0 auto;
  overflow: hidden;
  border-right: 1px solid var(--el-border-color-lighter);
  transition: width 0.18s ease, box-shadow 0.18s ease;

  &:last-child {
    border-right: none;
  }

  &.expanded {
    min-width: var(--expandedWidth);
    width: var(--expandedWidth);
    flex: 1 1 var(--expandedWidth);
    box-shadow: inset 2px 0 0 color-mix(in srgb, var(--el-color-primary) 30%, transparent);

    .groupExpanded {
      display: flex;
    }
  }
}

.groupStub {
  width: 44px;
  flex: 0 0 auto;
  display: flex;
  align-items: flex-start;
  justify-content: center;
  padding: 8px 6px 6px;
  box-sizing: border-box;
  cursor: pointer;
  transition: background 0.2s ease;

  &:hover {
    background: color-mix(in srgb, var(--el-fill-color) 40%, transparent);
  }
}

.groupExpanded {
  flex: 1 1 auto;
  min-width: 0;
  display: none;
  flex-direction: column;
  justify-content: flex-start;
  padding: 4px 12px 8px 8px;
}

.groupTitle {
  margin: 0 0 0.5rem;
  font-size: var(--el-font-size-small);
  font-weight: 600;
  color: var(--el-text-color-secondary);
  white-space: nowrap;

  &.viz-section__title-row {
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .viz-section__spacer {
    flex: 1;
  }
}

/* generic styling for the optional header-actions slot (small controls
 * aligned with the title/switch row) */
.viz-section__actions {
  display: inline-flex;
  align-items: center;
  gap: 4px;

  :slotted(.el-button) {
    margin: 0;
    min-height: 22px;
    padding: 3px 6px;
  }
}

/* generic body row + chips for slotted content */
.viz-section__body {
  display: flex;
  flex-direction: column;
  flex: 1 1 auto;
  width: 100%;
  min-width: 0;
  min-height: 0;

  :slotted(.row) {
    display: flex;
    align-items: center;
    gap: 8px;
    flex-wrap: wrap;
  }

  :slotted(.viz-chip.el-button) {
    margin: 0;
    min-height: 24px;
    padding: 4px 8px;
    font-family: var(--el-font-family);
    font-size: var(--el-font-size-extra-small);
  }

  &--dim {
    opacity: 0.5;
  }
}

/* ── variants ──────────────────────────────────────────────────────────── */
.viz-section--disabled {
  opacity: 0.45;
}

/* the .expanded rule re-enables pointer events on .groupExpanded:
 * out-specificity it (and its descendants) while the section is disabled */
.viz-section.viz-section--disabled .groupExpanded,
.viz-section.viz-section--disabled.expanded .groupExpanded,
.viz-section.viz-section--disabled .groupExpanded * {
  pointer-events: none !important;
}

.viz-section--dense .groupTitle {
  margin-bottom: 0.3rem;
}
</style>
