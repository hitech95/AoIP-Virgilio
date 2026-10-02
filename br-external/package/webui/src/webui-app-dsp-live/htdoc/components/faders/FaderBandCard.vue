<template>
  <FaderCard
    class="filter-card"
    :class="{ selected, muted: !band.enabled, 'solo-dim': isSoloDimmed }"
    :model-value="band.gain"
    :color="bandColor"
    :marks="gainMarks"
    :disabled="off || !supportsGain"
    :dimmed="!supportsGain"
    @input="(value) => setBandGain(bandIndex, value)"
    @activate="handleSelect"
  >
    <template #header>
      <div class="toolbar">
        <el-popover v-model:visible="settingsVisible" placement="bottom-start" :width="300" trigger="click"
          :disabled="readOnly" @show="openSettings">
          <template #reference>
            <button type="button" class="order-btn" :disabled="readOnly"
              :title="filterName" :aria-label="$t('Filter settings')">
              <BandOrderIcon class="order-icon" :position="orderNumber" :size="24" :color="bandColor" />
            </button>
          </template>
          <div class="filter-settings">
            <div class="filter-settings__heading">
              <BandOrderIcon :position="orderNumber" :size="20" :color="bandColor" />
              <strong>{{ $t('Filter settings') }}</strong>
            </div>
            <el-form label-position="top" @submit.prevent="onRename">
              <el-form-item :label="$t('Filter name')" :error="nameError ? $t(nameError) : ''">
                <el-input v-model="nameDraft" maxlength="64" :aria-label="$t('Filter name')"
                  :disabled="settingsBusy" @input="nameError = ''" @keydown.esc.stop="settingsVisible = false" />
              </el-form-item>
              <div class="filter-settings__actions">
                <el-button size="small" :disabled="settingsBusy" @click="settingsVisible = false">{{ $t('Cancel') }}</el-button>
                <el-button size="small" type="primary" native-type="submit" :loading="settingsBusy"
                  :disabled="!nameDraft.trim() || nameDraft.trim() === filterName">{{ $t('Save name') }}</el-button>
              </div>
            </el-form>
            <div class="filter-settings__delete">
              <el-button size="small" type="danger" plain :disabled="settingsBusy" @click="onDelete">
                <el-icon><Delete /></el-icon><span>{{ $t('Delete band') }}</span>
              </el-button>
            </div>
          </div>
        </el-popover>
        <el-popover v-model:visible="pickerVisible" placement="bottom-start" :width="230" trigger="click"
          :disabled="off">
          <template #reference>
            <button type="button" class="type-btn" :disabled="off"
              :title="$t('Band {n} — {type} (change type)', { n: bandIndex + 1, type: band.type })"
              :aria-label="$t('Change filter type for band {n}', { n: bandIndex + 1 })" @click.stop>
              <FilterIcon :type="band.type" />
            </button>
          </template>
          <FilterTypePicker :current-type="band.type" :band-color="`var(--band-${(bandIndex % 10) + 1})`"
            @select="onTypeSelect" />
        </el-popover>
      </div>
    </template>

    <template #footer>
      <!-- Unlabeled Gain/Hz/Q steppers with the mute switch between gain and
           frequency; the preamp card footer carries the labels. -->
      <div class="f-stepper" :title="$t('Gain (dB)')">
        <el-input-number class="f-input" size="small" :controls="false" :model-value="band.gain" :min="-24" :max="24"
          :step="0.5" :precision="1" :disabled="off || !supportsGain" :aria-label="$t('Gain in decibel')"
          @change="(v: number | undefined) => v !== undefined && setBandGain(bandIndex, v)" />
        <div class="f-btns">
          <button type="button" class="f-btn" :disabled="off || !supportsGain" :aria-label="$t('Increase gain')"
            @click="setBandGain(bandIndex, band.gain + 0.5)">+</button>
          <button type="button" class="f-btn" :disabled="off || !supportsGain" :aria-label="$t('Decrease gain')"
            @click="setBandGain(bandIndex, band.gain - 0.5)">−</button>
        </div>
      </div>

      <div class="switch-row">
        <el-switch size="small" :model-value="band.enabled"
          :title="band.enabled ? $t('Mute') : $t('Unmute')"
          :aria-label="band.enabled ? $t('Mute band') : $t('Enable band')"
          :disabled="readOnly" @change="toggleMute" />
      </div>

      <div class="f-stepper" :title="$t('Frequency (Hz)')">
        <el-input-number class="f-input" size="small" :controls="false" :model-value="band.freq" :min="10" :max="30000"
          :step="10" :precision="0" :disabled="off" :aria-label="$t('Frequency in hertz')" @change="onFreqChange" />
        <div class="f-btns">
          <button type="button" class="f-btn" :disabled="off" :aria-label="$t('Increase frequency')"
            @click="setBandFreq(bandIndex, band.freq + 10)">+</button>
          <button type="button" class="f-btn" :disabled="off" :aria-label="$t('Decrease frequency')"
            @click="setBandFreq(bandIndex, band.freq - 10)">−</button>
        </div>
      </div>

      <div class="f-stepper" :title="$t('Quality (Q)')">
        <el-input-number class="f-input" size="small" :controls="false" :model-value="band.q" :min="0.1" :max="10"
          :step="0.1" :precision="1" :disabled="off" :aria-label="$t('Quality factor')" @change="onQChange" />
        <div class="f-btns">
          <button type="button" class="f-btn" :disabled="off" :aria-label="$t('Increase Q')"
            @click="setBandQ(bandIndex, band.q + 0.1)">+</button>
          <button type="button" class="f-btn" :disabled="off" :aria-label="$t('Decrease Q')"
            @click="setBandQ(bandIndex, band.q - 0.1)">−</button>
        </div>
      </div>
    </template>
  </FaderCard>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { Delete } from '@element-plus/icons-vue'
import FaderCard from '../FaderCard.vue'
import FilterIcon from '../icons/FilterIcon.vue'
import BandOrderIcon from '../icons/BandOrderIcon.vue'
import FilterTypePicker from '../FilterTypePicker.vue'
import type { EqBand } from '../../lib/filterResponse.ts'
import {
  eq,
  removeBand,
  renameBand,
  setBandGain,
  setBandFreq,
  setBandQ,
  setBandType,
  toggleBandEnabled,
  selectBand,
  startSoloSession,
  endSoloSession,
} from '../../stores/eqStore.ts'
import { vizOptions } from '../../stores/vizOptions.ts'

const props = defineProps<{
  band: EqBand
  bandIndex: number
  orderNumber: number
  filterName: string
  selected: boolean
  /** Policy: the whole block is protected (locked) -- freeze every control */
  readOnly?: boolean
}>()

/** true when the band is muted OR the owning block is policy-locked */
const off = computed(() => props.readOnly || !props.band.enabled)

const pickerVisible = ref(false)
const settingsVisible = ref(false)
const settingsBusy = ref(false)
const nameDraft = ref('')
const nameError = ref('')

function openSettings() {
  nameDraft.value = props.filterName
  nameError.value = ''
}

async function onRename() {
  if (settingsBusy.value || props.readOnly) return
  settingsBusy.value = true
  try {
    if (await renameBand(props.bandIndex, nameDraft.value)) settingsVisible.value = false
    else nameError.value = eq.uploadStatus.message || 'Unable to rename filter'
  } catch {
    nameError.value = 'Unable to rename filter'
  } finally {
    settingsBusy.value = false
  }
}

async function onDelete() {
  if (props.readOnly || settingsBusy.value) return
  settingsVisible.value = false
  await removeBand(props.bandIndex)
}
const bandColor = `var(--band-${(props.bandIndex % 10) + 1})`

/* The order icon opens naming and deletion settings. */

// Gain scale dots at every 6 dB inside the ±24 dB range; the labels are
// hidden in the stylesheet, leaving only the dot marks.
const gainMarks = Object.fromEntries([-18, -12, -6, 0, 6, 12, 18].map((v) => [v, '']))

const supportsGain = computed(
  () =>
    props.band.type === 'Peaking' || props.band.type === 'LowShelf' || props.band.type === 'HighShelf'
)

const isSoloDimmed = computed(
  () => eq.soloActiveBandIndex !== null && eq.soloActiveBandIndex !== props.bandIndex
)

// Apply a Solo toggle immediately when this card is already selected rather
// than waiting for another pointer interaction with the card.
watch(
  () => vizOptions.soloWhileEditing,
  (enabled) => {
    if (eq.selectedBandIndex !== props.bandIndex) return
    if (enabled) startSoloSession(props.bandIndex, true)
    else endSoloSession()
  }
)

function handleSelect() {
  selectBand(props.bandIndex)
  startSoloSession(props.bandIndex, vizOptions.soloWhileEditing)
}

function toggleMute() {
  void toggleBandEnabled(props.bandIndex)
}

function onTypeSelect(t: EqBand['type']) {
  pickerVisible.value = false
  setBandType(props.bandIndex, t)
}

function onFreqChange(v: number | undefined) {
  if (v !== undefined) setBandFreq(props.bandIndex, v)
}

function onQChange(v: number | undefined) {
  if (v !== undefined) setBandQ(props.bandIndex, v)
}
</script>

<style scoped lang="scss">
.filter-settings {
  display: flex;
  flex-direction: column;
  gap: 16px;

  &__heading { display: flex; align-items: center; gap: 8px; color: var(--el-text-color-primary); }
  &__actions { display: flex; justify-content: flex-end; gap: 8px; }
  &__actions .el-button + .el-button { margin-left: 0; }
  &__delete { border-top: 1px solid var(--el-border-color-lighter); padding-top: 12px; }
  &__delete .el-button { width: 100%; gap: 6px; }
}
.filter-card {
  &.selected {
    border-color: var(--band-color);
    box-shadow: inset 0 0 0 1px var(--band-color);
  }

  &.muted { opacity: 0.6; }

  &.solo-dim {
    opacity: 0.25;
    pointer-events: none;
  }
}

/* the header row of the card: both icon buttons centered, even gap */
.toolbar {
  width: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  min-height: 30px;
}

/* the band-order icon doubles as the delete entry point: same chrome
 * as the type button so it reads as a button */
.order-btn {
  width: 30px;
  height: 30px;
  flex: 0 0 30px;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 2px;
  border: 1px solid var(--el-border-color-lighter);
  border-radius: 5px;
  background: transparent;
  color: var(--band-color);
  cursor: pointer;
  transition: border-color 0.15s;
}
.order-btn:hover:not(:disabled) {
  border-color: var(--band-color);
}
.order-btn:disabled {
  cursor: not-allowed;
  opacity: 0.5;
}
.order-btn .order-icon {
  width: 100%;
  height: 100%;
}
.order-btn .order-icon svg {
  width: 100%;
  height: 100%;
}

.order-icon {
  display: flex;
  align-items: center;
  justify-content: center;
  flex: 0 0 24px;
}

.type-btn {
  width: 30px;
  height: 30px;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 0;
  border: 1px solid var(--el-border-color-lighter);
  border-radius: 5px;
  background: transparent;
  color: var(--band-color);
  cursor: pointer;

  :deep(.icon) {
    width: 24px;
    height: 24px;
  }

  &:not(:disabled):hover {
    border-color: var(--band-color);
    background: var(--el-fill-color-light);
  }

  &:disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }
}

.switch-row {
  height: 22px;
  display: flex;
  align-items: center;
  justify-content: center;

  :deep(.el-switch) {
    --el-switch-on-color: var(--band-color);
  }
}

.f-stepper {
  height: 24px;
  min-width: 0;
  display: grid;
  grid-template-columns: minmax(0, 1fr) 18px;
  align-items: stretch;
  gap: 0 2px;
}

.f-input {
  width: 100%;
  min-width: 0;
  height: 24px;

  :deep(.el-input__inner) {
    height: 24px;
    line-height: 24px;
    padding: 0 2px;
    font-size: var(--fader-control-font-size);
    font-variant-numeric: tabular-nums;
    text-align: center;
  }
}

.f-btns {
  display: flex;
  flex-direction: column;
  gap: 1px;
  min-width: 0;
}

.f-btn {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 0;
  border: 1px solid var(--el-border-color-lighter);
  border-radius: 3px;
  background: var(--el-fill-color-blank);
  color: var(--el-text-color-regular);
  font-size: var(--fader-label-font-size);
  line-height: 1;
  cursor: pointer;

  &:hover:not(:disabled) {
    border-color: var(--band-color);
    color: var(--band-color);
  }

  &:disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }
}
</style>

<i18n src="../../locale.json"/>
