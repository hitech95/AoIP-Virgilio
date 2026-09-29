<template>
  <section v-show="active" class="pipeline-page">
    <el-alert v-if="error" type="error" :title="error" :closable="false" show-icon />

    <VueFlow v-if="nodes.length" :nodes="nodes" :edges="edges" :nodes-draggable="false"
      :nodes-connectable="false" :elements-selectable="true" :fit-view-on-init="true"
      :fit-view-options="{ padding: 0.3, maxZoom: 1.05, minZoom: 0.55 }" class="flow" :class="{ 'is-simple': isSimple }"
      @node-click="selectNode" @pane-click="clearSelection">
      <Background :color="graphGrid" :gap="22" :size="1" />
      <Controls />
      <template #node-pipeline="nodeProps">
        <PipelineNode v-bind="nodeProps" />
      </template>
    </VueFlow>
    <el-empty v-else :description="$t('CamillaDSP is not running or has no pipeline')" />

    <!-- Orphaned filter definitions: present in the session store but
          referenced by no pipeline block (camilladsp refuses unreferenced
          defs in the live config). Re-adding follows the policy (editable
          or free Filter blocks only; allow lists and max_steps respected --
          the daemon manifest re-checks every live change anyway). -->
    <el-card v-if="orphans.length" shadow="never" class="orphan-card">
      <template #header>{{ $t('Orphaned filters') }}</template>
      <el-table :data="orphans" size="default">
        <el-table-column :label="$t('Name')" min-width="150">
          <template #default="{ row }">
            <span class="orphan-name">{{ row.name }}</span>
          </template>
        </el-table-column>
        <el-table-column :label="$t('Type')" width="110">
          <template #default="{ row }">
            <el-tag type="info" effect="plain">{{ row.type }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column :label="$t('Add to block')" min-width="320">
          <template #default="{ row }">
            <el-select v-model="orphanTarget[row.name]" class="orphan-select"
              popper-class="dsp-block-dd" :placeholder="$t('Add to block')">
              <template #label="{ label }">
                <span class="sel-name">{{ label }}</span>
                <span class="sel-tags">
                  <el-tag v-if="blockOf(row)?.policy" size="small" type="info" effect="plain" class="sel-chip">
                    {{ policyLabel(blockOf(row).policy) }}
                  </el-tag>
                  <el-tag size="small" type="primary" effect="light" class="sel-chip">
                    {{ blockOf(row)?.count ?? '—' }}{{ blockOf(row)?.max != null ? `/${blockOf(row).max}` : '' }} {{ $t('filters') }}
                  </el-tag>
                  <el-tag v-for="c in (blockOf(row)?.channels ?? [])" :key="c" size="small"
                    type="success" effect="light" class="sel-chip">{{ channelLabel(c) }}</el-tag>
                </span>
              </template>
              <el-option v-for="b in eligibleBlocks(row)" :key="b.index" :value="b.index"
                :label="b.label" :disabled="b.max != null && b.count >= b.max">
                <div class="opt-row">
                  <span class="opt-name">{{ b.label }}</span>
                  <span class="opt-tags">
                    <el-tag size="small" type="info" effect="plain">{{ policyLabel(b.policy) }}</el-tag>
                    <el-tag size="small" type="primary" effect="light">
                      {{ b.count }}{{ b.max != null ? `/${b.max}` : '' }} {{ $t('filters') }}
                    </el-tag>
                    <el-tag v-for="c in b.channels" :key="c" size="small" type="success" effect="light">
                      {{ channelLabel(c) }}
                    </el-tag>
                  </span>
                </div>
              </el-option>
            </el-select>
          </template>
        </el-table-column>
        <el-table-column width="90" align="right">
          <template #default="{ row }">
            <el-button type="primary" :disabled="orphanTarget[row.name] == null"
              @click="addOrphan(row)">{{ $t('Add') }}</el-button>
          </template>
        </el-table-column>
      </el-table>
    </el-card>

    <div class="selected-editor" v-if="selected">
      <FilterBlockEditor v-if="selected?.step.type === 'Filter'" :node="selected" :step="selected.step"
        :input-channels="inputChannels" :can-edit-block="canEditBlock" :can-edit-filters="canEditFilters"
        :can-label="canLabel"
        :entries="filterEntries" :filter="filter" :filter-label="filterLabel" :is-biquad="isBiquad" :has-q="hasQ"
        :has-gain="hasGain" :filter-types="filterTypes" @apply="apply" @remove-filter="removeFilter"
        @set-enabled="setFilterEnabled" @set-type="setFilterType" @add-filter="addFilter"
        @rename-filter="renameFilter" @save-label="saveBlockLabel" />

      <MixerBlockEditor v-else-if="selected?.step.type === 'Mixer'" :node="selected" :step="selected.step"
        :mixer="mixer(selected.step.name)" :can-edit="canEditBlock" :can-route="canEditRoutes"
        :can-bypass="canEditRoutes" :can-label="canLabel"
        :input-channels="inputChannels"
        :warning="mixWarning" :gain-limits="gainLimits" :ch-labels="chLabels"
        @apply="apply" @set-scale="setScale" @rename-out="renameMixerOut"
        @remove-source="removeSource" @add-source="addSource" @save-label="saveBlockLabel" />
    </div>
  </section>

</template>

<script>
import { VueFlow } from '@vue-flow/core'
import { Controls } from '@vue-flow/controls'
import { Background } from '@vue-flow/background'
import PipelineNode from '../PipelineNode.vue'
import FilterBlockEditor from '../FilterBlockEditor.vue'
import MixerBlockEditor from '../MixerBlockEditor.vue'
import '../../styles/pipeline.scss'
import '../../styles/eq.scss'
import { sessionForget, reconcileSession, loadSession, sessionTypeOf, getStepKey } from '../../lib/filterSession'
import { disableFilterInStep, enableFilterInStep } from '../../lib/filterEnablement'
import * as dsp from '../../dsp'
import { initializeFromConfig } from '../../stores/eqStore'
import '@vue-flow/core/dist/style.css'
import '@vue-flow/controls/dist/style.css'

const FILTER_TYPES = [
  'Peaking', 'Highpass', 'Lowpass', 'Highshelf', 'Lowshelf', 'Notch', 'Allpass'
].map(value => ({ value, label: value }))

/* Advanced tab of the Live page (the former pipeline page). Uses the
 * page-owned dsp.ts websocket (no private connection); refreshes on
 * every activation so edits made in the EQ tab are picked up. */
export default {
  name: 'AdvancedTab',
  components: { VueFlow, Controls, Background, PipelineNode, FilterBlockEditor, MixerBlockEditor },
  props: {
    active: { type: Boolean, default: false }
  },
  data() {
    return {
      nodes: [], edges: [], error: '', config: null, policy: [], schema: null,
      orphanTarget: {},
      chLabels: { in: [], out: [] },
      selected: null, unprotected: false, applying: false,
      refreshing: false
    }
  },
  computed: {
    inputChannels() { return Array.from({ length: this.config?.devices?.capture?.channels ?? 0 }, (_, i) => i) },
    mixerStageIndex() {
      return (this.config?.pipeline ?? []).findIndex(s => s.type === 'Mixer')
    },
    /* orphaned filters: definitions live in the SESSION store
       (camilladsp refuses unreferenced defs in the running config) */
    /* disabled/orphaned filters: definitions live in the SESSION store
       (camilladsp refuses unreferenced defs in the running config) */
    orphans() {
      // re-evaluate on config changes (the session has no signal)
      void this.config
      return Object.entries(loadSession())
        .map(([name, entry]) => ({ name, type: sessionTypeOf(entry), stepIndex: entry.stepIndex }))
        .sort((a, b) => a.name.localeCompare(b.name))
    },
    filterTypes() { return FILTER_TYPES },
    /* 'mixer' = source mixer whose route GAINS the policy exposes --
     * structure (bypass/scale/invert/mute/sources) stays manifest-pinned */
    canEditBlock() { return this.unprotected || ['free', 'mixer'].includes(this.selected?.data.kind) },
    canEditRoutes() { return this.unprotected || this.selected?.data.kind === 'free' },
    /* the block label is uci metadata -- safe on any non-locked block */
    canLabel() { return !!this.selected && this.selected.data.kind !== 'locked' },
    canEditFilters() { return this.unprotected || ['free', 'editable'].includes(this.selected?.data.kind) },
    graphGrid() { return document.documentElement.classList.contains('dark') ? '#314052' : '#b8c4d1' },
    isSimple() { return this.nodes.length <= 3 },
    filterEntries() {
      if (!this.config || this.selected?.step.type !== 'Filter') return []
      const stepIndex = (this.config.pipeline ?? []).indexOf(this.selected.step)
      /* filters shipped with the board config (the base input gains and
       * the locked tails) are structural: visible and value-editable,
       * but never disable/remove/rename/type-change-able. Everything the
       * web UI created carries a u_ id and is fully editable. */
      const active = (this.selected.step.names ?? [])
        .map(name => ({ name, disabled: false, structural: !name.startsWith('u_') }))
      const stepKey = getStepKey(this.selected.step.channels ?? [], stepIndex)
      const disabled = Object.entries(loadSession())
        .filter(([, e]) => e.positions && e.positions[stepKey] !== undefined)
        .map(([name, e]) => ({ name, disabled: true, index: e.positions[stepKey] }))
        .sort((a, b) => a.index - b.index)
      return [...active, ...disabled]
    }
  },
  async created() {
    try {
      this.policy = (await this.$oui.call('dsp', 'get_pipeline')).stages ?? []
      try {
        this.schema = await this.$oui.call('dsp', 'get_saved_filters')
      } catch { this.schema = null }
      try {
        const mix = await this.$oui.call('dsp', 'get_mixers')
        const m0 = mix?.mixers?.[0]
        this.chLabels = { in: m0?.in_label ?? [], out: m0?.out_label ?? [] }
      } catch { this.chLabels = { in: [], out: [] } }
    } catch (error) { this.error = error?.message ?? String(error) }
    // first refresh as soon as the page-owned connection is up
    this._stopConn = this.$watch(() => dsp.connectionState.value, state => {
      if (state === 'connected' && !this.config) this.refresh()
    }, { immediate: true })
  },
  unmounted() { this._stopConn?.() },
  watch: {
    // always resync on activation: EQ-tab uploads change the live config
    active(v) { if (v && dsp.connectionState.value === 'connected') this.refresh() }
  },
  methods: {
    /* camilladsp command over the page-owned connection; the dsp client
     * rejects with the reply body ({ result }) -- shape the message like
     * the former private-socket client did. GetConfigJson replies also
     * refresh the SHARED config cache (dsp.config): the page-level Save
     * and the other tabs read from it */
    async request(command, value) {
      try {
        const body = await dsp.request(command, value)
        if (command === 'GetConfigJson') {
          const v = body?.value
          dsp.config.value = typeof v === 'string' ? JSON.parse(v) : v
        }
        return body?.value
      } catch (r) {
        const result = r && typeof r === 'object' && 'result' in r ? r.result : r
        const msg = typeof result === 'string' ? `${command}: ${result}`
          : (result && typeof result === 'object' && Object.keys(result).length)
            ? `${command}: ${Object.keys(result)[0]} ${Object.values(result)[0]}`
            : `${command} failed`
        throw new Error(msg)
      }
    },
    async refresh() {
      if (this.refreshing) return
      this.refreshing = true
      try {
        const value = await this.request('GetConfigJson')
        this.config = typeof value === 'string' ? JSON.parse(value) : value
        // disabled-filter session: entries whose removal was lost get
        // re-disabled and the reconciled config uploaded once
        if (reconcileSession(this.config).length)
          this.request('SetConfigJson', JSON.stringify(this.config))
            .catch(() => { this.$message.warning(this.$t('Could not re-apply muted filters')) })
        this.unprotected = !this.policy.length || this.policy.every(stage => stage.kind === 'free')
        this.buildGraph()
      } catch (e) {
        this.error = e?.value?.message ?? e?.message ?? String(e)
      } finally {
        this.refreshing = false
      }
    },
    stage(index) { return this.policy.find(stage => stage.index === index) },
    kind(index, step) {
      const stage = this.stage(index)
      /* mixers follow the policy map: kind 'mixer' = route gains exposed
       * by policy (user_gains), 'free' = unprotected block */
      if (step.type === 'Mixer') return stage ? stage.kind : 'mixer'
      if (!stage) return step.type === 'Filter' ? 'filter' : 'free'
      return stage.kind === 'locked' ? 'locked' : stage.kind === 'editable' ? 'editable' : 'readonly'
    },
    buildGraph() {
      const capture = Array.from({ length: this.config.devices.capture.channels }, (_, i) => i)
      const playback = Array.from({ length: this.config.devices.playback.channels }, (_, i) => i)
      const nodes = [{ id: 'capture', type: 'pipeline', selectable: false, position: { x: 0, y: 140 }, data: { kind: 'endpoint', label: 'Capture', inputs: [], outputs: capture, chOut: this.chLabels.in } }]
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
        const afterMixer = this.mixerStageIndex >= 0 && index > this.mixerStageIndex
        const chIn = afterMixer ? this.chLabels.out : this.chLabels.in
        const chOut = this.chLabels.out
        nodes.push({
          id, type: 'pipeline', selectable: kind !== 'locked', position: { x: depth * 280, y: this.channelY(outputs) },
          data: {
            kind, label: stage.name ?? stage.label ?? step.description ?? step.type, inputs, outputs, detail, chIn, chOut,
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
      nodes.push({ id: 'playback', type: 'pipeline', selectable: false, position: { x: depth * 280, y: this.channelY(playback) }, data: { kind: 'endpoint', label: 'Playback', inputs: playback, outputs: [], chIn: this.chLabels.out } })
      for (const channel of playback) if (state[channel]) edges.push(this.edge(state[channel].node, 'playback', state[channel].channel, channel, state[channel].color))
      this.nodes = nodes
      this.edges = edges
    },
    mixer(name) { return this.config?.mixers?.[name] },
    channelY(channels) { const list = channels ?? []; return 90 + (list.length ? list.reduce((sum, channel) => sum + channel, 0) / list.length : 0) * 180 },
    channelColor(channel) { return ['#3f9cff', '#f05ab7', '#9a7cff', '#f3bf4f'][channel % 4] },
    mixerColor(channel) { return ['#31d390', '#ff9d42', '#49c8ff', '#d88cff'][channel % 4] },
    edge(source, target, channel, targetChannel, color) { return { id: `${source}-${channel}-${target}-${targetChannel}`, source, target, sourceHandle: `out-${channel}`, targetHandle: `in-${targetChannel}`, type: 'straight', style: { stroke: color, strokeWidth: 2 } } },
    /* camilladsp type -> uci name (mirror of genconf's vocabulary) */
    uciTypeName(f) {
      if (f.type === 'Gain') return 'gain'
      if (f.type === 'Volume') return 'volume'
      if (f.type === 'Conv') return 'conv'
      if (f.type === 'Delay') return 'delay'
      const map = { Peaking: 'peak', Highshelf: 'hs', Lowshelf: 'ls', Highpass: 'hp',
                    Lowpass: 'lp', Bandpass: 'bp', Notch: 'notch', Allpass: 'ap' }
      return map[f.parameters?.type] ?? null
    },
    eligibleBlocks(orphan) {
      /* the websocket may not be up yet (or the fetch failed): the
       * orphan table renders from the session store alone and must not
       * crash on the missing runtime config */
      if (!this.config) return []
      const out = []
      const def = loadSession()[orphan.name]?.def ?? this.config.filters?.[orphan.name]
      const uciType = this.uciTypeName(def)
      for (const stage of this.policy) {
        if (stage.kind !== 'editable' && stage.kind !== 'free') continue
        const step = this.config.pipeline[stage.index]
        if (!step || step.type !== 'Filter') continue
        if (stage.kind === 'editable') {
          const slot = this.schema?.editable?.[stage.label]
          const allow = slot?.allow ?? []
          const max = slot?.max_steps ? Number(slot.max_steps) : null
          if (allow.length && (!uciType || !allow.includes(uciType))) continue
          out.push({
            index: stage.index, label: stage.label, count: (step.names ?? []).length, max,
            policy: 'editable',
            channels: this.channelsOf(slot?.channels)
          })
        } else {
          out.push({
            index: stage.index, label: stage.name ?? stage.label ?? `#${stage.index}`,
            count: (step.names ?? []).length, max: null,
            policy: 'free',
            channels: this.channelsOf(step.channels)
          })
        }
      }
      return out
    },
    /* channel spec (uci string "0 1" or runtime array) -> numbers */
    channelsOf(spec) {
      if (Array.isArray(spec)) return spec.map(c => Number(c)).filter(Number.isFinite)
      return String(spec ?? '').split(/\s+/).filter(Boolean).map(Number).filter(Number.isFinite)
    },
    channelLabel(c) { return this.chLabels.in?.[c]?.trim() || `ch ${c}` },
    policyLabel(policy) {
      return policy === 'free' ? this.$t('free edit') : this.$t('editable')
    },
    /* the block selected in a row's dropdown (for the collapsed label) */
    blockOf(orphan) {
      const idx = this.orphanTarget[orphan.name]
      if (idx == null) return null
      return this.eligibleBlocks(orphan).find(b => b.index === idx) ?? null
    },
    /* live output renaming: uci out_label via save_mixer_meta */
    async renameMixerOut(dest, label) {
      const mixerName = this.selected?.step?.name
      if (!mixerName || dest == null) return
      try {
        const mix = await this.$oui.call('dsp', 'get_mixers')
        const m0 = (mix?.mixers ?? []).find(m => m.name === mixerName)
        const out = [...(m0?.out_label ?? [])]
        while (out.length <= +dest) out.push('')
        out[+dest] = String(label ?? '').trim().slice(0, 16)
        const r = await this.$oui.call('dsp', 'save_mixer_meta', {
          mixer: mixerName, out_label: out.filter(x => x || out.lastIndexOf(x) >= 0)
        })
        if (r?.error) throw new Error(r.error.message)
        this.chLabels = { ...this.chLabels, out }
        this.buildGraph()
        const node = this.nodes.find(item => item.id === this.selected?.id)
        if (node) this.selectNode({ node })
      } catch (e) {
        this.$message.error(this.$t('Update failed') + (e?.message ? `: ${e.message}` : ''))
      }
    },
    async renameFilter(oldName, newName) {
      if (this.isStructural(oldName)) return
      newName = String(newName ?? '').trim().replace(/[^a-zA-Z0-9._-]/g, '')
      if (!newName || newName === oldName) return
      if (this.config.filters[newName]) {
        this.$message.error(`Filter '${newName}' already exists`)
        return
      }
      this.config.filters[newName] = this.config.filters[oldName]
      delete this.config.filters[oldName]
      for (const step of this.config.pipeline ?? [])
        step.names = (step.names ?? []).map(n => n === oldName ? newName : n)
      await this.apply()
    },
    async saveBlockLabel(label) {
      if (!this.selected) return
      try {
        const r = await this.$oui.call('dsp', 'set_block_label', {
          index: this.config.pipeline.indexOf(this.selected.step),
          label: String(label ?? '').trim()
        })
        if (r?.error) this.$message.error(r.error.message)
        else {
          this.policy = (await this.$oui.call('dsp', 'get_pipeline')).stages ?? this.policy
          this.buildGraph()
          /* re-select so the editor follows the rebuilt node (label) */
          const node = this.nodes.find(item => item.id === this.selected?.id)
          if (node) this.selectNode({ node })
        }
      } catch (e) {
        this.$message.error(e?.message ?? String(e))
      }
    },
    async addOrphan(orphan) {
      const idx = this.orphanTarget[orphan.name]
      if (idx == null) return
      const step = this.config.pipeline[idx]
      if (!step || step.type !== 'Filter') return
      const def = loadSession()[orphan.name]?.def
      if (!def) return
      if (!this.config.filters) this.config.filters = {}
      this.config.filters[orphan.name] = def
      step.names = [...(step.names ?? []), orphan.name]
      sessionForget(orphan.name)
      /* the orphan is CONSUMED: forgetting the session entry drops
       * every disabled-view of it (the origin block's table row, the
       * panel list) or it keeps showing as disabled on the origin */
      this.config = { ...this.config }
      await this.apply()
      this.orphanTarget = { ...this.orphanTarget, [orphan.name]: undefined }
    },
    selectNode({ node }) {
      if (!node.selectable || node.data.kind === 'endpoint' || node.data.kind === 'locked') return
      const index = +node.id.replace('stage-', '')
      this.selected = { id: node.id, data: node.data, step: this.config.pipeline[index] }
      this.buildGraph()
    },
    clearSelection() {
      this.selected = null
      this.buildGraph()
    },
    filter(name) { return this.config?.filters?.[name] ?? loadSession()[name]?.def },
    runtimeFilterLabel(name) { return this.filter(name)?.parameters?.type ?? this.filter(name)?.type ?? name },
    filterLabel(name) { const type = this.runtimeFilterLabel(name); return /^EQ\d+$/.test(name) ? `${type} filter` : `${type} · ${name}` },
    isBiquad(name) { return this.filter(name)?.type === 'Biquad' },
    hasQ(name) { return this.isBiquad(name) && this.filter(name)?.parameters?.q != null },
    hasGain(name) {
        const f = this.filter(name)
        // plain Gain/Volume filters (uci 'gain') carry the value in parameters.gain
        return f?.type === 'Gain' || f?.type === 'Volume' || (f?.type === 'Biquad' && f?.parameters?.gain != null)
      },
    /* structural = shipped with the board config, not web UI-created */
    isStructural(name) { return !name.startsWith('u_') },
    setFilterType(name, type) {
      if (this.isStructural(name)) return
      const filter = this.filter(name)
      if (!filter?.parameters) return
      filter.parameters.type = type
      if (type === 'Peaking' || type.endsWith('shelf')) filter.parameters.gain ??= 0
      else delete filter.parameters.gain
      this.apply()
    },
    addFilter(type) {
      const prefix = type.toLowerCase()
      let number = 1, name = `${prefix}_${number}`
      while (this.config.filters[name]) name = `${prefix}_${++number}`
      this.config.filters[name] = { type: 'Biquad', description: `${type} filter`, parameters: { type, freq: 1000, q: 1, ...(type === 'Peaking' || type.endsWith('shelf') ? { gain: 0 } : {}) } }
      this.selected.step.names.push(name)
      this.apply()
    },
    removeFilter(name) {
      if (this.isStructural(name)) return
      const index = this.selected.step.names.indexOf(name); if (index >= 0) { this.selected.step.names.splice(index, 1); delete this.config.filters[name] } sessionForget(name); this.apply() },
    setFilterEnabled(name, enabled) {
      if (this.isStructural(name)) return
      const stepIndex = this.config.pipeline.indexOf(this.selected.step)
      if (enabled) {
        /* restores the definition and re-inserts the name at its
         * recorded original position (appended when no record exists) */
        this.config = enableFilterInStep(this.config, name, stepIndex)
      } else {
        const index = this.selected.step.names.indexOf(name)
        /* idempotency guard: a repeated disable (double event, stale
         * row) would splice(-1, ...) corrupting the block */
        if (index < 0) return
        /* the definition moves to the session store: camilladsp
         * refuses unreferenced defs; the orphan panel restores from
         * there */
        this.config = disableFilterInStep(this.config, name, stepIndex)
      }
      this.apply()
    },
    addSource(destination, channel) { destination.sources.push({ channel, gain: 0, inverted: false, mute: false, scale: 'dB' }); this.apply() },
    removeSource(destination, channel) { destination.sources = destination.sources.filter(source => source.channel !== channel); this.apply() },
    setScale(source, scale) { const from = source.scale || 'dB'; const gain = Number(source.gain) || 0; if (from !== scale) source.gain = scale === 'dB' ? (gain <= 0 ? -150 : 20 * Math.log10(gain)) : Math.pow(10, gain / 20); source.scale = scale; this.apply() },
    gainLimits(source) { return (source.scale || 'dB') === 'linear' ? { min: 0, max: 10, step: 0.01 } : { min: -150, max: 50, step: 0.25 } },
    mixWarning(destination) { const active = destination.mute ? [] : (destination.sources ?? []).filter(source => !source.mute); const linear = active.reduce((sum, source) => sum + ((source.scale || 'dB') === 'linear' ? (+source.gain || 0) : Math.pow(10, (+source.gain || 0) / 20)), 0); return { sources: active.length, risk: linear > 1 + 1e-6, gainDb: linear <= 0 ? '-∞' : (20 * Math.log10(linear)).toFixed(2) } },
    async apply() {
      /* NOTE: no canEdit guard here -- orphan restore / rename operate
       * without a selected block; the editors gate their own controls */
      if (this.applying) return
      this.applying = true
      try {
        const selectedId = this.selected?.id
        await this.request('SetConfigJson', JSON.stringify(this.config))
        await this.refresh()
        const node = this.nodes.find(item => item.id === selectedId)
        if (node) this.selectNode({ node })
        /* keep the EQ tab in sync: its store caches the previous
         * config and would clobber these edits on the next upload */
        initializeFromConfig(this.config)
      }
      catch (error) {
        /* Error instances stringify to '{}' -- keep the real message */
        this.error = typeof error === 'string' ? error : (error?.message ?? String(error))
        this.$message.error(this.$t('Update failed') + (this.error ? `: ${this.error}` : ''))
      }
      finally { this.applying = false }
    }
  }
}
</script>

<i18n src="../../locale.json"/>

<style scoped lang="scss">
/* the flow canvas: viewport-relative minimum height (fits its
   content, at least half the screen) */
.flow {
  min-height: 50vh;
}

.orphan-card {
  margin: 12px 0;

  .orphan-name {
    font-family: ui-monospace, Menlo, Consolas, monospace;
    font-size: 13px;
  }

  /* collapsed selection: stretch the EP wrapper so the label-slot
     content justifies exactly like an option row (name left, chips
     right) -- same rules as the EQ tab selector */
  .orphan-select {
    width: 100%;

    :deep(.el-select__selected-item.el-select__placeholder) {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 6px;
      width: 100%;
    }
  }

  .sel-name {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .sel-tags {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    flex-shrink: 0;
  }
}
</style>
