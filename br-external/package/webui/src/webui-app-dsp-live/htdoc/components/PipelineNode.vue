<template>
  <div class="pipeline-node" :class="[`kind-${data.kind}`, { 'is-selected': selected }]">
    <Handle v-for="(channel, index) in inputs" :key="`in-${channel}`"
      type="target" :position="Position.Left" :id="`in-${channel}`" :style="handlePosition(index, inputs)"/>

    <div class="node-heading">
      <strong class="node-title">{{ data.label }}</strong>
      <el-tag v-if="data.bypassed" size="small" type="warning" effect="plain">{{ $t('Bypassed') }}</el-tag>
      <el-tag v-else-if="data.kind === 'locked'" size="small" type="info" effect="plain">{{ $t('Protected') }}</el-tag>
    </div>

    <ChannelRow v-if="sameChannels" :label="$t('Channels')" :channels="inputs"/>
    <template v-else>
      <ChannelRow :label="$t('In')" :channels="inputs"/>
      <ChannelRow :label="$t('Out')" :channels="outputs"/>
    </template>

    <div v-if="data.detail" class="node-detail">{{ data.detail }}</div>
    <div v-if="data.filterLabels?.length" class="applied-filters">
      <el-tag v-for="label in data.filterLabels" :key="label" size="small" type="primary" effect="plain">{{ label }}</el-tag>
    </div>

    <div v-if="data.kind === 'mixer'" class="mixer-destinations">
      <div v-for="destination in data.destinations" :key="destination.dest" class="mixer-destination" :class="{ muted: destination.mute }">
        <div class="destination-label">{{ $t('Dest') }} {{ destination.dest }} <el-tag v-if="destination.mute" size="small" type="danger">{{ $t('Muted') }}</el-tag></div>
        <div class="destination-sources">
          <el-tag v-for="source in destination.sources" :key="source.channel" size="small" effect="plain" :type="source.mute ? 'info' : 'success'">
            {{ $t('Src {n}', { n: source.channel }) }}<span v-if="source.inverted"> · {{ $t('Inv') }}</span><span v-if="source.mute"> · {{ $t('Mute') }}</span>
          </el-tag>
        </div>
      </div>
    </div>

    <Handle v-for="(channel, index) in outputs" :key="`out-${channel}`"
      type="source" :position="Position.Right" :id="`out-${channel}`" :style="handlePosition(index, outputs)"/>
  </div>
</template>

<script>
import { Handle, Position } from '@vue-flow/core'
import ChannelRow from './ChannelRow.vue'

export default {
  components: { Handle, ChannelRow },
  props: { data: { type: Object, required: true }, selected: Boolean },
  computed: {
    inputs() { return this.data.inputs ?? [] },
    outputs() { return this.data.outputs ?? [] },
    sameChannels() { return this.inputs.length === this.outputs.length && this.inputs.every((channel, index) => channel === this.outputs[index]) }
  },
  methods: {
    handlePosition(index, channels) { return { top: `${(index + 1) * 100 / (channels.length + 1)}%` } }
  },
  setup() { return { Position } }
}
</script>

<i18n src="../locale.json"/>
