<!--
VizOptionsBar.vue — collapsible visualization options bar.
Each group lives in its own component (components/viz/*Group.vue); this shell
owns the strip layout, the responsive collapse/expand manager and the
drag/wheel scrolling.
-->
<template>
    <AccordionStrip :groups="groups">
      <VizCurvesGroup />
      <VizTapGroup />
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

/* the expanded WIDTH lives in each section's :expanded-width prop and
 * is read back from the DOM by the strip; only order priority is here */
const groups: AccordionStripGroup[] = [
  { id: 'curves', priority: 1 },
  { id: 'tap', priority: 4 },
  { id: 'smooth', priority: 2 },
  { id: 'heatmap', priority: 3 },
  { id: 'tokens', priority: 5 },
]
</script>
