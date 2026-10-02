<template>
  <el-card class="block-card filter">
    <template #header>
      <el-row class="block-head" :gutter="8" justify="space-between">
        <el-space>
          <strong class="block-kind">{{ $t('Filter') }}</strong>
          <el-input v-if="labelEditing" v-model="labelValue" class="label-input" size="small"
            :placeholder="$t('Block name')" maxlength="32"
            @keyup.enter="commitLabel" @blur="commitLabel"/>
          <el-tag v-else-if="canLabel" type="info" effect="plain" class="label-tag"
            :title="$t('Click to rename this block')" @click="startLabelEdit">{{ blockLabel || $t('Block name') }}</el-tag>
          <el-tag v-else type="info">{{ node.data.label }}</el-tag>
          <!-- one-way binding: see MixerBlockEditor (null modelValue
               write-back would mutate the step on selection).
               Gate on canEditFilters: the manifest pins locked runs
               only, so bypassing an EDITABLE block is allowed (verified
               against camilladsp), while filter rows stay gated too -->
          <el-switch :model-value="!!step.bypassed" class="bypass-switch" :disabled="!canEditFilters"
            :active-text="$t('Bypassed')" :aria-label="$t('Bypassed')"
            @change="v => { step.bypassed = v; $emit('apply') }"/>
        </el-space>
        <el-space>
          <el-tag v-if="node.data.kind === 'locked'" type="info">{{ $t('Protected') }}</el-tag>
        </el-space>
      </el-row>
    </template>

    <el-space direction="vertical" style="width: 100%;" :size="32" fill>
      <el-card shadow="never" class="editor-section">
        <template #header>{{ $t('Block settings') }}</template>
        <el-form label-width="110px" inline>
          <el-form-item :label="$t('Channels')">
            <el-checkbox-group v-model="step.channels" :disabled="!canEditBlock" @change="$emit('apply')">
              <el-checkbox v-for="channel in inputChannels" :key="channel" :label="channel">{{ $t('Ch {n}', { n: channel }) }}</el-checkbox>
            </el-checkbox-group>
          </el-form-item>
        </el-form>
      </el-card>

      <el-empty v-if="!entries.length" :description="$t('No filters')" :image-size="48" />

      <el-table v-if="entries.length" :data="entries" class="source-table" stripe>
        <el-table-column :label="$t('Filter')" width="150">
          <template #default="scope">
            <el-input v-if="editingName === scope.row.name" v-model="nameValue"
              class="name-input" maxlength="32" :placeholder="scope.row.name"
              @keyup.enter="commitName(scope.row.name)" @blur="commitName(scope.row.name)"/>
            <el-tag v-else-if="canEditFilters && !scope.row.structural" type="info" effect="plain" class="name-tag"
              :title="$t('Click to rename this filter')" @click="startNameEdit(scope.row.name)">
              {{ scope.row.name }}
            </el-tag>
            <el-tag v-else-if="scope.row.structural" type="info" effect="plain" class="name-tag structural-tag"
              :title="$t('Slot gain (preamp) -- managed by the block')">
              {{ scope.row.name }}
            </el-tag>
            <template v-else>{{ filterLabel(scope.row.name) }}</template>
          </template>
        </el-table-column>
        <el-table-column :label="$t('Enabled')" width="110">
          <template #default="scope">
            <el-switch :model-value="!scope.row.disabled" :disabled="!canEditFilters || scope.row.structural"
              @change="$emit('set-enabled', scope.row.name, $event)" />
          </template>
        </el-table-column>
        <el-table-column :label="$t('Type')" width="210">
          <template #default="scope">
            <el-select :model-value="filterType(scope.row.name)"
              :disabled="!canEditFilters || scope.row.disabled || scope.row.structural || !isBiquad(scope.row.name)"
              @change="$emit('set-type', scope.row.name, $event)">
              <el-option v-for="type in filterTypes" :key="type.value" :label="type.label" :value="type.value" />
            </el-select>
          </template>
        </el-table-column>
        <el-table-column :label="$t('Frequency')" width="210">
          <template #default="scope">
            <el-input-number v-if="isBiquad(scope.row.name)" v-model="filter(scope.row.name).parameters.freq"
              :min="10" :max="24000" :precision="0" :disabled="!canEditFilters || scope.row.disabled"
              controls-position="right" @change="$emit('apply')">
              <template #suffix><span>Hz</span></template>
            </el-input-number>
            <span v-else>-</span>
          </template>
        </el-table-column>
        <el-table-column :label="$t('Q')" width="145">
          <template #default="scope">
            <el-input-number v-if="hasQ(scope.row.name)" v-model="filter(scope.row.name).parameters.q"
              :min="0.1" :max="20" :step="0.1" :precision="2" :disabled="!canEditFilters || scope.row.disabled"
              controls-position="right" @change="$emit('apply')" />
            <span v-else>-</span>
          </template>
        </el-table-column>
        <el-table-column :label="$t('Gain')" width="210">
          <template #default="scope">
            <el-input-number v-if="hasGain(scope.row.name)" v-model="filter(scope.row.name).parameters.gain"
              :min="-30" :max="20" :step="0.25" :precision="2" :disabled="!canEditFilters || scope.row.disabled"
              controls-position="right" @change="$emit('apply')">
              <template #suffix><span>dB</span></template>
            </el-input-number>
            <span v-else>-</span>
          </template>
        </el-table-column>
        <el-table-column align="right">
          <template #default="scope">
            <el-button v-if="!scope.row.structural" type="danger" :disabled="!canEditFilters"
              @click="$emit('remove-filter', scope.row.name)">{{ $t('Remove') }}</el-button>
          </template>
        </el-table-column>
      </el-table>

      <el-space class="add-filter-row">
        <el-select v-model="newType" :disabled="!canEditFilters" :placeholder="$t('Filter type')" style="width: 150px">
          <el-option v-for="type in filterTypes" :key="type.value" :label="type.label" :value="type.value" />
        </el-select>
        <el-button type="primary" :disabled="!canEditFilters" @click="addFilter">+ {{ $t('Add filter') }}</el-button>
      </el-space>
    </el-space>
  </el-card>
</template>

<script>
export default {
  emits: ['apply', 'remove-filter', 'set-enabled', 'set-type', 'add-filter', 'rename-filter', 'save-label'],
  props: { node: Object, step: Object, inputChannels: Array, canEditBlock: Boolean, canEditFilters: Boolean, canLabel: Boolean, entries: Array, filter: Function, filterLabel: Function, isBiquad: Function, hasQ: Function, hasGain: Function, filterTypes: Array },
  data() { return { newType: 'Peaking', blockLabel: '', labelEditing: false, labelValue: '', editingName: null, nameValue: '' } },
  watch: {
    'node.data.label': {
      immediate: true,
      handler(v) { this.blockLabel = v ?? ''; this.labelEditing = false }
    }
  },
  methods: {
    /* click the block tag -> edit mode (prefilled) -> enter/blur saves */
    startLabelEdit() {
      this.labelEditing = true
      this.labelValue = this.blockLabel
    },
    commitLabel() {
      if (!this.labelEditing) return
      this.labelEditing = false
      const v = String(this.labelValue ?? '').trim()
      if (v !== this.blockLabel) this.$emit('save-label', v)
    },
    startNameEdit(name) {
      this.editingName = name
      this.nameValue = name
    },
    commitName(oldName) {
      if (this.editingName !== oldName) return
      this.editingName = null
      const v = String(this.nameValue ?? '').trim()
      if (v && v !== oldName) this.$emit('rename-filter', oldName, v)
    },
    addFilter() { this.$emit('add-filter', this.newType) },
    filterType(name) {
      const filter = this.filter(name)
      return filter?.parameters?.type ?? filter?.type ?? '-'
    }
  }
}
</script>

<i18n src="../locale.json"/>

<style scoped lang="scss">
.name-tag { cursor: pointer; }
.structural-tag { cursor: default; }
.label-tag { cursor: pointer; }
.name-input { width: 120px; }
.label-input { width: 160px; }
</style>
