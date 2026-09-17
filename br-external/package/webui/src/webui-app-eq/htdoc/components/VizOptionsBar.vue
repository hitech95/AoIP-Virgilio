<!--
VizOptionsBar.vue — collapsible visualization options bar.
Each group lives in its own component (components/viz/*Group.vue); this shell
owns the strip layout, the responsive collapse/expand manager and the
drag/wheel scrolling.
-->
<template>
    <AccordionStrip :groups="groups">
      <VizTapGroup />
      <VizCurvesGroup />
      <VizSmoothGroup />
      <VizHeatmapGroup />
      <VizTokensGroup />
    </AccordionStrip>
</template>

<script setup lang="ts">
import AccordionStrip, { type AccordionStripGroup } from './AccordionStrip.vue'
import VizTapGroup from './viz/VizTapGroup.vue'
import VizCurvesGroup from './viz/VizCurvesGroup.vue'
import VizSmoothGroup from './viz/VizSmoothGroup.vue'
import VizHeatmapGroup from './viz/VizHeatmapGroup.vue'
import VizTokensGroup from './viz/VizTokensGroup.vue'

const groups: AccordionStripGroup[] = [
  { id: 'tap', priority: 4, expandedWidth: 256 },
  { id: 'curves', priority: 1, expandedWidth: 200 },
  { id: 'smooth', priority: 2, expandedWidth: 190 },
  { id: 'heatmap', priority: 3, expandedWidth: 210 },
  { id: 'tokens', priority: 5, expandedWidth: 270 },
]
</script>
