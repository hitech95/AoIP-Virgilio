<template>
  <section class="pipeline-page">
    <el-alert v-if="error" type="error" :title="error" :closable="false" show-icon />
    <el-alert type="info" :closable="false" show-icon
      :title="unprotected ? 'Unprotected configuration: live WebSocket controls are enabled.' : 'Protected configuration: only policy-exposed controls are enabled.'" />

    <VueFlow v-if="nodes.length" :nodes="nodes" :edges="edges" :nodes-draggable="false"
      :nodes-connectable="false" :elements-selectable="true" :fit-view-on-init="true"
      :fit-view-options="{ padding: 0.3, maxZoom: 1.05, minZoom: 0.55 }" class="flow" :class="{ 'is-simple': isSimple }"
      @node-click="selectNode">
      <Background :color="graphGrid" :gap="22" :size="1" />
      <Controls />
      <template #node-pipeline="nodeProps">
        <PipelineNode v-bind="nodeProps" />
      </template>
    </VueFlow>
    <el-empty v-else description="CamillaDSP is not running or has no pipeline" />

    <div class="selected-editor" v-if="selected">
      <FilterBlockEditor v-if="selected?.step.type === 'Filter'" :node="selected" :step="selected.step"
        :input-channels="inputChannels" :can-edit-block="canEditBlock" :can-edit-filters="canEditFilters"
        :entries="filterEntries" :filter="filter" :filter-label="filterLabel" :is-biquad="isBiquad" :has-q="hasQ"
        :has-gain="hasGain" :filter-types="filterTypes" @apply="apply" @remove-filter="removeFilter"
        @set-enabled="setFilterEnabled" @add-filter="addFilter" />

      <MixerBlockEditor v-else-if="selected?.step.type === 'Mixer'" :node="selected" :step="selected.step"
        :mixer="mixer(selected.step.name)" :can-edit="canEditBlock" :input-channels="inputChannels"
        :warning="mixWarning" :gain-limits="gainLimits" @apply="apply" @set-scale="setScale"
        @remove-source="removeSource" @add-source="addSource" />
    </div>
  </section>
</template>

<script>
import { VueFlow } from '@vue-flow/core'
import { Controls } from '@vue-flow/controls'
import { Background } from '@vue-flow/background'
import PipelineNode from './components/PipelineNode.vue'
import FilterBlockEditor from './components/FilterBlockEditor.vue'
import MixerBlockEditor from './components/MixerBlockEditor.vue'
import './styles/pipeline.scss'
import '@vue-flow/core/dist/style.css'
import '@vue-flow/controls/dist/style.css'

const FILTER_TYPES = [
  'Peaking', 'Highpass', 'Lowpass', 'Highshelf', 'Lowshelf', 'Notch', 'Allpass'
].map(value => ({ value, label: value }))

export default {
  components: { VueFlow, Controls, Background, PipelineNode, FilterBlockEditor, MixerBlockEditor },
  data() {
    return {
      nodes: [], edges: [], error: '', ws: null, config: null, policy: [],
      selected: null, selectedId: null, unprotected: false, applying: false,
      disabledFilters: {}, sessionTimer: null
    }
  },
  computed: {
    inputChannels() { return Array.from({ length: this.config?.devices?.capture?.channels ?? 0 }, (_, i) => i) },
    filterTypes() { return FILTER_TYPES },
    canEditBlock() { return this.unprotected || this.selected?.data.kind === 'free' },
    canEditFilters() { return this.unprotected || ['free', 'editable'].includes(this.selected?.data.kind) },
    graphGrid() { return document.documentElement.classList.contains('dark') ? '#314052' : '#b8c4d1' },
    isSimple() { return this.nodes.length <= 3 },
    filterEntries() {
      if (this.selected?.step.type !== 'Filter') return []
      const stepIndex = (this.config.pipeline ?? []).indexOf(this.selected.step)
      const active = (this.selected.step.names ?? []).map(name => ({ name, disabled: false }))
      const disabled = Object.entries(this.disabledFilters)
        .filter(([, item]) => item.stepIndex === stepIndex)
        .sort(([, a], [, b]) => a.index - b.index)
        .map(([name]) => ({ name, disabled: true }))
      return [...active, ...disabled]
    }
  },
  async created() {
    try {
      this.policy = (await this.$oui.call('dsp', 'get_pipeline')).stages ?? []
      await this.connect()
      this.sessionTimer = setInterval(() => this.checkSession(), 5000)
    } catch (error) { this.error = error?.message ?? String(error) }
  },
  unmounted() { clearInterval(this.sessionTimer); this.ws?.close() },
  methods: {
    connect() {
      return new Promise((resolve, reject) => {
        const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:'
        this.ws = new WebSocket(`${protocol}//${location.host}/ws`)
        this.ws.onopen = async () => { try { await this.refresh(); resolve() } catch (error) { reject(error) } }
        this.ws.onerror = () => reject(new Error('CamillaDSP websocket connection failed'))
      })
    },
    async checkSession() {
      if (await this.$oui.isAlived()) return
      clearInterval(this.sessionTimer)
      this.ws?.close(1000, 'Session expired')
      this.$router.replace('/login')
    },
    request(command, value) {
      return new Promise((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error(`${command} timed out`)), 5000)
        const onMessage = event => {
          clearTimeout(timeout)
          this.ws.removeEventListener('message', onMessage)
          const reply = JSON.parse(event.data)
          const body = reply[Object.keys(reply)[0]]
          body?.result === 'Ok' ? resolve(body.value) : reject(body?.value ?? new Error(`${command} failed`))
        }
        this.ws.addEventListener('message', onMessage)
        this.ws.send(JSON.stringify(value === undefined ? command : { [command]: value }))
      })
    },
    async refresh() {
      const value = await this.request('GetConfigJson')
      this.config = typeof value === 'string' ? JSON.parse(value) : value
      this.unprotected = !this.policy.length || this.policy.every(stage => stage.kind === 'free')
      this.buildGraph()
    },
    stage(index) { return this.policy.find(stage => stage.index === index) },
    kind(index, step) {
      if (step.type === 'Mixer') return 'mixer'
      const stage = this.stage(index)
      if (!stage) return step.type === 'Filter' ? 'filter' : 'free'
      return stage.kind === 'locked' ? 'locked' : stage.kind === 'editable' ? 'editable' : 'readonly'
    },
    buildGraph() {
      const capture = Array.from({ length: this.config.devices.capture.channels }, (_, i) => i)
      const playback = Array.from({ length: this.config.devices.playback.channels }, (_, i) => i)
      const nodes = [{ id: 'capture', type: 'pipeline', selectable: false, position: { x: 0, y: 140 }, data: { kind: 'endpoint', label: 'Capture', inputs: [], outputs: capture } }]
      const edges = []
      const state = Object.fromEntries(capture.map(channel => [channel, { node: 'capture', channel, depth: 0, color: this.channelColor(channel) }]))

      for (const [index, step] of (this.config.pipeline ?? []).entries()) {
        const kind = this.kind(index, step)
        const mixer = step.type === 'Mixer' ? this.mixer(step.name) : null
        const outputs = mixer ? Array.from({ length: mixer.channels?.out ?? playback.length }, (_, i) => i) : (step.channels ?? capture)
        const inputs = mixer ? Array.from({ length: mixer.channels?.in ?? capture.length }, (_, i) => i) : outputs
        // Mixer maps happen inside the block. Its input bus remains a fixed
        // channel-for-channel connection from the preceding pipeline block.
        const upstream = inputs.map(channel => ({ target: channel, state: state[channel] })).filter(item => item.state)
        const depth = Math.max(0, ...upstream.map(item => item.state.depth)) + 1
        const stage = this.stage(index)
        const id = `stage-${index}`
        const detail = step.type === 'Filter' ? `${step.names?.length ?? 0} filters` : mixer ? `${inputs.length} × ${outputs.length}` : ''
        nodes.push({
          id, type: 'pipeline', selectable: kind !== 'locked', position: { x: depth * 280, y: this.channelY(outputs) },
          data: {
            kind, label: kind === 'locked' ? stage.label : (step.description || step.type), inputs, outputs, detail,
            bypassed: !!step.bypassed,
            filterLabels: step.type === 'Filter' ? (step.names ?? []).map(name => this.runtimeFilterLabel(name)) : [],
            destinations: mixer ? mixer.mapping.map(destination => ({ dest: destination.dest, mute: !!destination.mute, sources: destination.sources.map(source => ({ channel: source.channel, mute: !!source.mute, inverted: !!source.inverted })) })) : []
          }
        })
        for (const item of upstream) edges.push(this.edge(item.state.node, id, item.state.channel, item.target, item.state.color))
        for (const channel of outputs) {
          const prior = upstream.find(item => item.target === channel)?.state
          state[channel] = { node: id, channel, depth, color: mixer ? this.mixerColor(channel) : (prior?.color ?? this.channelColor(channel)) }
        }
      }

      const depth = Math.max(0, ...playback.map(channel => state[channel]?.depth ?? 0)) + 1
      nodes.push({ id: 'playback', type: 'pipeline', selectable: false, position: { x: depth * 280, y: this.channelY(playback) }, data: { kind: 'endpoint', label: 'Playback', inputs: playback, outputs: [] } })
      for (const channel of playback) if (state[channel]) edges.push(this.edge(state[channel].node, 'playback', state[channel].channel, channel, state[channel].color))
      this.nodes = nodes
      this.edges = edges
    },
    mixer(name) { return this.config?.mixers?.[name] },
    channelY(channels) { const list = channels ?? []; return 90 + (list.length ? list.reduce((sum, channel) => sum + channel, 0) / list.length : 0) * 180 },
    channelColor(channel) { return ['#3f9cff', '#f05ab7', '#9a7cff', '#f3bf4f'][channel % 4] },
    mixerColor(channel) { return ['#31d390', '#ff9d42', '#49c8ff', '#d88cff'][channel % 4] },
    edge(source, target, channel, targetChannel, color) { return { id: `${source}-${channel}-${target}-${targetChannel}`, source, target, sourceHandle: `out-${channel}`, targetHandle: `in-${targetChannel}`, type: 'straight', style: { stroke: color, strokeWidth: 2 } } },
    selectNode({ node }) {
      if (!node.selectable || node.data.kind === 'endpoint' || node.data.kind === 'locked') return
      this.selectedId = node.id
      const index = +node.id.replace('stage-', '')
      this.selected = { id: node.id, data: node.data, step: this.config.pipeline[index] }
      this.buildGraph()
    },
    filter(name) { return this.config?.filters?.[name] ?? this.disabledFilters[name]?.filter },
    runtimeFilterLabel(name) { return this.filter(name)?.parameters?.type ?? this.filter(name)?.type ?? name },
    filterLabel(name) { const type = this.runtimeFilterLabel(name); return /^EQ\d+$/.test(name) ? `${type} filter` : `${type} · ${name}` },
    isBiquad(name) { return this.filter(name)?.type === 'Biquad' },
    hasQ(name) { return this.isBiquad(name) && this.filter(name)?.parameters?.q != null },
    hasGain(name) { return this.isBiquad(name) && this.filter(name)?.parameters?.gain != null },
    addFilter(type) {
      const prefix = type.toLowerCase()
      let number = 1, name = `${prefix}_${number}`
      while (this.config.filters[name]) name = `${prefix}_${++number}`
      this.config.filters[name] = { type: 'Biquad', description: `${type} filter`, parameters: { type, freq: 1000, q: 1, ...(type === 'Peaking' || type.endsWith('shelf') ? { gain: 0 } : {}) } }
      this.selected.step.names.push(name)
      this.apply()
    },
    removeFilter(name) { const index = this.selected.step.names.indexOf(name); if (index >= 0) { this.selected.step.names.splice(index, 1); delete this.config.filters[name] } delete this.disabledFilters[name]; this.apply() },
    setFilterEnabled(name, enabled) {
      if (enabled) { const saved = this.disabledFilters[name]; if (!saved) return; this.config.filters[name] = saved.filter; this.config.pipeline[saved.stepIndex].names.splice(saved.index, 0, name); delete this.disabledFilters[name] }
      else { const stepIndex = this.config.pipeline.indexOf(this.selected.step); const index = this.selected.step.names.indexOf(name); this.disabledFilters[name] = { filter: this.config.filters[name], stepIndex, index }; this.selected.step.names.splice(index, 1); delete this.config.filters[name] }
      this.apply()
    },
    addSource(destination, channel) { destination.sources.push({ channel, gain: 0, inverted: false, mute: false, scale: 'dB' }); this.apply() },
    removeSource(destination, channel) { destination.sources = destination.sources.filter(source => source.channel !== channel); this.apply() },
    setScale(source, scale) { const from = source.scale || 'dB'; const gain = Number(source.gain) || 0; if (from !== scale) source.gain = scale === 'dB' ? (gain <= 0 ? -150 : 20 * Math.log10(gain)) : Math.pow(10, gain / 20); source.scale = scale; this.apply() },
    gainLimits(source) { return (source.scale || 'dB') === 'linear' ? { min: 0, max: 10, step: 0.01 } : { min: -150, max: 50, step: 0.25 } },
    mixWarning(destination) { const active = destination.mute ? [] : (destination.sources ?? []).filter(source => !source.mute); const linear = active.reduce((sum, source) => sum + ((source.scale || 'dB') === 'linear' ? (+source.gain || 0) : Math.pow(10, (+source.gain || 0) / 20)), 0); return { sources: active.length, risk: linear > 1 + 1e-6, gainDb: linear <= 0 ? '-∞' : (20 * Math.log10(linear)).toFixed(2) } },
    async apply() {
      if ((!this.canEditBlock && !this.canEditFilters) || this.applying) return
      this.applying = true
      try { const selectedId = this.selected?.id; await this.request('SetConfigJson', JSON.stringify(this.config)); await this.refresh(); const node = this.nodes.find(item => item.id === selectedId); if (node) this.selectNode({ node }) }
      catch (error) { this.error = typeof error === 'string' ? error : JSON.stringify(error) }
      finally { this.applying = false }
    }
  }
}
</script>
