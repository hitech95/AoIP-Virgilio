<template>
  <el-card class="block-card filter">
    <template #header>
      <el-row class="block-head" :gutter="8" justify="space-between">
        <el-space>
          <strong class="block-kind">Filter</strong>
          <el-tag type="info">{{ node.data.label }}</el-tag>
          <el-switch v-model="step.bypassed" class="bypass-switch" :disabled="!canEditBlock" @change="$emit('apply')" />
        </el-space>
        <el-space>
          <el-tag v-if="step.bypassed" type="warning">Bypassed</el-tag>
          <el-tag v-if="node.data.kind === 'locked'" type="info">Protected</el-tag>
        </el-space>
      </el-row>
    </template>

    <el-space direction="vertical" style="width: 100%;" :size="32" fill>
      <el-card shadow="never" class="editor-section">
        <template #header>Block settings</template>
        <el-form label-width="110px" size="small" inline>
          <el-form-item label="Channels">
            <el-checkbox-group v-model="step.channels" :disabled="!canEditBlock" @change="$emit('apply')">
              <el-checkbox v-for="channel in inputChannels" :key="channel" :label="channel">Ch {{ channel }}</el-checkbox>
            </el-checkbox-group>
          </el-form-item>
        </el-form>
      </el-card>

      <el-card shadow="never" class="editor-section">
        <template #header>Add filter</template>
        <el-space>
          <el-select v-model="newType" :disabled="!canEditFilters" style="width: 200px">
            <el-option v-for="type in filterTypes" :key="type.value" :label="type.label" :value="type.value" />
          </el-select>
          <el-button type="primary" :disabled="!canEditFilters" @click="addFilter">+ Add</el-button>
        </el-space>
      </el-card>

      <el-empty v-if="!entries.length" description="No filters" :image-size="48" />

      <el-card v-for="entry in entries" :key="entry.name" shadow="never" class="filter-card"
        :class="{ disabled: entry.disabled }">
        <template #header>
          <el-row class="filter-card-head" :gutter="8" justify="space-between">
            <el-space>
              <span class="source-label">{{ filterLabel(entry.name) }}</span>
              <el-switch :model-value="!entry.disabled" :disabled="!canEditFilters"
                @change="$emit('set-enabled', entry.name, $event)" />
            </el-space>
            <el-space>
              <el-tag v-if="entry.disabled" type="info">Disabled</el-tag>
              <el-button size="small" type="danger" :disabled="!canEditFilters"
                @click="$emit('remove-filter', entry.name)">Remove</el-button>
            </el-space>
          </el-row>
        </template>

        <el-table v-if="rows(entry.name).length" :data="rows(entry.name)" class="source-table" stripe>
          <el-table-column label="Parameter" width="160">
            <template #default="scope">
              <span class="source-label">{{ scope.row.label }}</span>
            </template>
          </el-table-column>
          <el-table-column label="Value">
            <template #default="scope">
              <el-input-number v-if="scope.row.key === 'freq'" v-model="filter(entry.name).parameters.freq"
                :min="10" :max="24000" :precision="0" :disabled="!canEditFilters || entry.disabled"
                controls-position="right" @change="$emit('apply')">
                <template #suffix><span class="unit">Hz</span></template>
              </el-input-number>
              <el-input-number v-else-if="scope.row.key === 'q'" v-model="filter(entry.name).parameters.q"
                :min="0.1" :max="20" :step="0.1" :precision="2" :disabled="!canEditFilters || entry.disabled"
                controls-position="right" @change="$emit('apply')" />
              <el-input-number v-else-if="scope.row.key === 'gain'" v-model="filter(entry.name).parameters.gain"
                :min="-30" :max="20" :step="0.25" :precision="2" :disabled="!canEditFilters || entry.disabled"
                controls-position="right" @change="$emit('apply')">
                <template #suffix><span class="unit">dB</span></template>
              </el-input-number>
              <span v-else>{{ scope.row.value }}</span>
            </template>
          </el-table-column>
        </el-table>
      </el-card>
    </el-space>
  </el-card>
</template>

<script>
export default {
  emits: ['apply', 'remove-filter', 'set-enabled', 'add-filter'],
  props: { node: Object, step: Object, inputChannels: Array, canEditBlock: Boolean, canEditFilters: Boolean, entries: Array, filter: Function, filterLabel: Function, isBiquad: Function, hasQ: Function, hasGain: Function, filterTypes: Array },
  data() { return { newType: 'Peaking' } },
  methods: {
    addFilter() { this.$emit('add-filter', this.newType) },
    rows(name) {
      const filter = this.filter(name)
      if (!filter) return []
      const rows = [{ key: 'type', label: 'Type', value: filter.parameters?.type ?? filter.type }]
      if (this.isBiquad(name)) rows.push({ key: 'freq', label: 'Frequency' })
      if (this.hasQ(name)) rows.push({ key: 'q', label: 'Q' })
      if (this.hasGain(name)) rows.push({ key: 'gain', label: 'Gain' })
      return rows
    }
  }
}
</script>
