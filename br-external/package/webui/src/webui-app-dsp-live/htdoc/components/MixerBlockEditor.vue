<template>
  <el-card class="block-card mixer">
    <template #header>
      <el-row class="block-head" :gutter="8" justify="space-between">
        <el-space>
          <strong class="block-kind">{{ $t('Mixer') }}</strong>
          <el-tag type="info">{{ node.data.label }}</el-tag>
          <el-switch v-model="step.bypassed" class="bypass-switch" :disabled="!canEdit" @change="$emit('apply')" />
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
                <span>{{ $t('Dest') }}: </span>
                <el-tag>{{ destination.dest }}</el-tag>
                <el-switch v-model="destination.mute" :disabled="!canEdit" @change="$emit('apply')" /><span>{{ $t('Mute') }}</span>
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
                  <el-select :model-value="scope.row.scale || 'dB'" :disabled="!canEdit"
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
                  <el-checkbox v-model="scope.row.inverted" :disabled="!canEdit" @change="$emit('apply')" />
                </template>
              </el-table-column>
              <el-table-column :label="$t('Mute')" width="82">
                <template #default="scope">
                  <el-checkbox v-model="scope.row.mute" :disabled="!canEdit" @change="$emit('apply')" />
                </template>
              </el-table-column>
              <el-table-column align="right">
                <template #default="scope">
                  <el-button type="danger" :disabled="!canEdit || destination.sources.length === 1"
                    @click="$emit('remove-source', destination, scope.row.channel)">{{ $t('Remove') }}</el-button>
                </template>
              </el-table-column>
            </el-table>

            <el-space>
              <el-select v-model="newSource[destination.dest]" :disabled="!canEdit" :placeholder="$t('Source channel')"
                style="width:150px">
                <el-option v-for="channel in availableSources(destination)" :key="channel" :label="$t('Ch {n}', { n: channel })"
                  :value="channel" />
              </el-select>
              <el-button :disabled="!canEdit || newSource[destination.dest] == null" @click="addSource(destination)">+
                {{ $t('Add source') }}</el-button>
            </el-space>
          </el-space>
        </el-card>
    </el-space>
  </el-card>
</template>

<script>
export default {
  emits: ['apply', 'set-scale', 'remove-source', 'add-source'],
  props: { node: Object, step: Object, mixer: Object, canEdit: Boolean, inputChannels: Array, warning: Function, gainLimits: Function },
  data() { return { newSource: {} } },
  methods: { availableSources(destination) { const used = new Set(destination.sources.map(source => source.channel)); return this.inputChannels.filter(channel => !used.has(channel)) }, addSource(destination) { const channel = this.newSource[destination.dest]; if (channel == null) return; this.$emit('add-source', destination, channel); this.newSource[destination.dest] = null } }
}
</script>

<i18n src="../locale.json"/>
