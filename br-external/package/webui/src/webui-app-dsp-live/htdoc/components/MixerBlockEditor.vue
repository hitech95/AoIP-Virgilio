<template>
  <el-card class="block-card mixer">
    <template #header>
      <el-row class="block-head" :gutter="8" justify="space-between">
        <el-space>
          <strong class="block-kind">{{ $t('Mixer') }}</strong>
          <el-input v-if="labelEditing" v-model="labelValue" class="label-input" size="small"
            :placeholder="$t('Block name')" maxlength="32"
            @keyup.enter="commitLabel" @blur="commitLabel"/>
          <el-tag v-else-if="canLabel" type="info" effect="plain" class="label-tag"
            :title="$t('Click to rename this block')" @click="startLabelEdit">{{ blockLabel || $t('Block name') }}</el-tag>
          <el-tag v-else type="info">{{ node.data.label }}</el-tag>
          <!-- one-way binding: el-switch normalizes a null modelValue to
               false and writes it back via v-model, which would mutate
               (and upload) the step on mere selection -->
          <el-switch :model-value="!!step.bypassed" class="bypass-switch" :disabled="!canBypass"
            @change="v => { step.bypassed = v; $emit('apply') }"/>
        </el-space>
        <el-space>
          <el-tag v-if="step.bypassed" type="warning">{{ $t('Bypassed') }}</el-tag>
        </el-space>
      </el-row>
    </template>

    <el-space direction="vertical" style="width: 100%;" :size="32" fill>
        <el-card v-for="destination in mixer.mapping ?? []" :key="destination.dest" class="destination" shadow="never">
          <template #header>
            <el-row :gutter="8" justify="space-between">
              <el-space>
                <span>{{ $t('Output') }}: </span>
                <el-input v-if="editingOut === destination.dest" v-model="outValue"
                  class="ch-label" maxlength="16" :placeholder="'CH' + destination.dest"
                  @keyup.enter="commitOut(destination.dest)" @blur="commitOut(destination.dest)"/>
                <el-tag v-else class="label-tag"
                  :title="$t('Click to rename this output')"
                  @click="startOutEdit(destination.dest)">{{ outName(destination.dest) }}</el-tag>
                <el-switch :model-value="!!destination.mute" :disabled="!canRoute"
                  @change="v => { destination.mute = v; $emit('apply') }"/><span>{{ $t('Mute') }}</span>
              </el-space>
              <el-space>
                <el-tag v-if="warning(destination).risk" type="warning">{{ $t('Clipping risk') }}</el-tag>
              </el-space>
            </el-row>
          </template>

          <el-space direction="vertical" style="width: 100%;" fill>
            <el-alert v-if="warning(destination).risk" type="warning" :closable="false" show-icon>
              <template #title>{{ $t('Summing {n} sources', { n: warning(destination).sources }) }}</template>
              <template #default>{{ $t('Effective gain {db} dB (risk of clipping)', { db: warning(destination).gainDb }) }}</template>
            </el-alert>

            <el-table :data="destination.sources" class="source-table" stripe>
              <el-table-column :label="$t('Source')" width="150">
                <template #default="scope">
                  <span class="source-label">Ch {{ scope.row.channel }}</span>
                </template>
              </el-table-column>
              <el-table-column :label="$t('Mode')" width="110">
                <template #default="scope">
                  <el-select :model-value="scope.row.scale || 'dB'" :disabled="!canRoute"
                    @change="$emit('set-scale', scope.row, $event)">
                    <el-option label="dB" value="dB" />
                    <el-option :label="$t('Linear')" value="linear" />
                  </el-select>
                </template>
              </el-table-column>
              <el-table-column :label="$t('Gain')" width="210">
                <template #default="scope">
                  <el-input-number v-model="scope.row.gain" :disabled="!canEdit" :min="gainLimits(scope.row).min"
                    :max="gainLimits(scope.row).max" :step="gainLimits(scope.row).step" :precision="2"
                    controls-position="right" @change="$emit('apply')">
                    <template #suffix>
                      <span>{{ scope.row.scale || 'dB' }}</span>
                    </template>
                  </el-input-number>
                  <span class="unit"></span>
                </template>
              </el-table-column>
              <el-table-column :label="$t('Invert')" width="92">
                <template #default="scope">
                  <el-checkbox v-model="scope.row.inverted" :disabled="!canRoute" @change="$emit('apply')" />
                </template>
              </el-table-column>
              <el-table-column :label="$t('Mute')" width="82">
                <template #default="scope">
                  <el-checkbox v-model="scope.row.mute" :disabled="!canRoute" @change="$emit('apply')" />
                </template>
              </el-table-column>
              <el-table-column align="right">
                <template #default="scope">
                  <el-button type="danger" :disabled="!canRoute || destination.sources.length === 1"
                    @click="$emit('remove-source', destination, scope.row.channel)">{{ $t('Remove') }}</el-button>
                </template>
              </el-table-column>
            </el-table>

            <el-space>
              <el-select v-model="newSource[destination.dest]" :disabled="!canRoute" :placeholder="$t('Source channel')"
                style="width:150px">
                <el-option v-for="channel in availableSources(destination)" :key="channel" :label="$t('Ch {n}', { n: channel })"
                  :value="channel" />
              </el-select>
              <el-button :disabled="!canRoute || newSource[destination.dest] == null" @click="addSource(destination)">+
                {{ $t('Add source') }}</el-button>
            </el-space>
          </el-space>
        </el-card>
    </el-space>
  </el-card>
</template>

<script>
export default {
  emits: ['apply', 'set-scale', 'remove-source', 'add-source', 'rename-out', 'save-label'],
  props: {
    node: Object, step: Object, mixer: Object, canEdit: Boolean, canRoute: Boolean,
    canBypass: Boolean, canLabel: Boolean, inputChannels: Array,
    warning: Function, gainLimits: Function,
    /* mixer channel labels (uci in_label/out_label) */
    chLabels: { type: Object, default: () => ({ in: [], out: [] }) }
  },
  data() {
    return { blockLabel: '', labelEditing: false, labelValue: '', editingOut: null, outValue: '', newSource: {} }
  },
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
    outName(dest) {
      const l = this.chLabels?.out?.[+dest]
      return (l && String(l).trim()) || ('CH' + dest)
    },
    /* click the tag -> edit mode (prefilled) -> enter/blur confirms */
    startOutEdit(dest) {
      this.editingOut = dest
      this.outValue = this.outName(dest)
    },
    commitOut(dest) {
      if (this.editingOut !== dest) return
      this.editingOut = null
      const v = String(this.outValue ?? '').trim()
      if (v && v !== this.outName(dest)) this.$emit('rename-out', dest, v)
    },
    availableSources(destination) { const used = new Set(destination.sources.map(source => source.channel)); return this.inputChannels.filter(channel => !used.has(channel)) },
    addSource(destination) { const channel = this.newSource[destination.dest]; if (channel == null) return; this.$emit('add-source', destination, channel); this.newSource[destination.dest] = null }
  }
}
</script>

<i18n src="../locale.json"/>

<style scoped lang="scss">
.label-tag { cursor: pointer; }
.ch-label { width: 100px; }
.label-input { width: 160px; }
.name-tag { cursor: pointer; }
</style>
