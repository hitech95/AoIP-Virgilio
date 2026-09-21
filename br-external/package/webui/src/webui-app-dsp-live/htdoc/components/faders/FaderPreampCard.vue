<template>
  <FaderCard
    class="preamp-card"
    :model-value="eq.preampGain"
    color="var(--band-10)"
    :marks="gainMarks"
    :disabled="!eq.preampAvailable || readOnly"
    :dimmed="!eq.preampAvailable || readOnly"
    @input="setPreampGain"
  >
    <template #header>
      <div class="toolbar">
        <span class="title">PRE</span>
      </div>
    </template>

    <template #footer>
      <!-- Labels for the Gain/Hz/Q stepper rows shared by all cards. The
           spacer matches the mute-switch row in each filter footer. -->
      <div class="f-row">
        <span class="f-label">Gain</span>
      </div>
      <div class="f-spacer"></div>
      <div class="f-row">
        <span class="f-label">Hz</span>
      </div>
      <div class="f-row">
        <span class="f-label">Q</span>
      </div>
    </template>
  </FaderCard>
</template>

<script setup lang="ts">
import FaderCard from '../FaderCard.vue'
import { eq, setPreampGain } from '../../stores/eqStore.ts'

defineProps<{
  /** Policy: the whole block is protected (locked) -- freeze the fader */
  readOnly?: boolean
}>()

// Gain scale dots at every 6 dB inside the ±24 dB range; the labels are
// hidden in the stylesheet, leaving only the dot marks.
const gainMarks = Object.fromEntries([-18, -12, -6, 0, 6, 12, 18].map((v) => [v, '']))
</script>

<style scoped lang="scss">
.preamp-card {
  opacity: 0.85;
}

.toolbar {
  width: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
}

.title {
  font-size: var(--fader-control-font-size);
  font-weight: 700;
  letter-spacing: 0.08em;
  color: var(--el-text-color-secondary);
}

.f-row {
  flex: 0 0 24px;
  min-height: 24px;
  display: flex;
  align-items: center;
}

.f-spacer {
  flex: 0 0 20px;
  height: 20px;
}

.f-label {
  font-size: var(--fader-label-font-size);
  font-weight: 600;
  letter-spacing: 0.04em;
  color: var(--el-text-color-secondary);
}
</style>
