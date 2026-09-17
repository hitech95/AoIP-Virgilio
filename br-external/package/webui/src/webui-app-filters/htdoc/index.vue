<template>
  <div class="filters-page">
    <el-alert v-if="error" :title="error" type="error" :closable="false" show-icon/>

    <template v-if="schema">
      <el-tabs v-model="activeTab">
        <el-tab-pane :label="$t('General')" name="general">
          <el-form label-width="auto" label-suffix=":" class="general-form">
            <el-form-item :label="$t('Sample rate')">
              <el-select v-model="settings.samplerate">
                <el-option label="44.1 kHz" value="44100"/>
                <el-option label="48 kHz" value="48000"/>
                <el-option label="96 kHz" value="96000"/>
              </el-select>
            </el-form-item>
            <el-form-item :label="$t('Chunk size')">
              <el-select v-model="settings.chunksize">
                <el-option v-for="size in chunkSizes" :key="size" :label="size + ' samples'" :value="String(size)"/>
              </el-select>
            </el-form-item>
            <el-form-item :label="$t('Format')">
              <el-select v-model="settings.format">
                <el-option :label="$t('16-bit')" value="S16_LE"/>
                <el-option :label="$t('24-bit')" value="S24_3LE"/>
                <el-option :label="$t('32-bit')" value="S32_LE"/>
              </el-select>
            </el-form-item>
            <el-form-item :label="$t('Startup volume')">
              <el-slider v-model="settings.gain" :min="-60" :max="0" :step="1" show-input/>
            </el-form-item>
            <el-form-item v-if="schema.user_gains.length" :label="$t('Source select')">
              <el-radio-group v-model="settings.source">
                <el-radio-button label="0">{{ $t('Channel') }} 0</el-radio-button>
                <el-radio-button label="mix">{{ $t('Mix (L+R)/2') }}</el-radio-button>
                <el-radio-button label="1">{{ $t('Channel') }} 1</el-radio-button>
              </el-radio-group>
            </el-form-item>
          </el-form>
          <el-divider/>
          <div class="save-row"><el-button type="primary" :loading="savingSettings" @click="saveSettings">{{ $t('Save & Apply') }}</el-button></div>
        </el-tab-pane>
        <el-tab-pane :label="$t('Filters')" name="filters">
      <!-- no editable slots: the protected pipeline is not configured on
           this device (no uci subchain sections) -->
      <el-empty v-if="!Object.keys(schema.editable).length && !Object.keys(schema.locked).length"
                :description="$t('No editable slots: this device ships a plain pass-through pipeline. The speaker configuration (subchains + locked tails) is provisioned at build time.')"/>
      <template v-else>
      <el-alert type="info" :closable="false" show-icon class="saved-note"
                :title="$t('This page edits the saved UCI filter configuration. Use DSP > EQ for temporary realtime tuning, then save it here.')"/>

      <!-- editable slots -->
      <el-card v-for="(slot, name) in schema.editable" :key="name" shadow="never" class="slot-card">
        <template #header>
          {{ name }}
          <el-tag size="small" type="info">{{ slot.policy }}</el-tag>
          <span class="hint">{{ $t('max') }} {{ slot.max_steps }} · {{ $t('ch') }} {{ slot.channels }} · {{ slot.allow.join(' ') }}</span>
        </template>

        <div v-if="slot.filters.length" class="filter-list">
          <div v-for="(filter, index) in slot.filters" :key="index" class="filter-row">
            <span class="filter-index">{{ index + 1 }}</span>
            <label>{{ $t('Type') }}
              <el-select :model-value="filter.type" @update:model-value="v => patch(name, index, 'type', v)">
                <el-option v-for="t in slot.allow" :key="t" :label="t" :value="t"/>
              </el-select>
            </label>
            <label v-if="needs(filter.type, 'f')">{{ $t('Freq [Hz]') }}
              <el-input-number :model-value="num(filter.f, 1000)" :min="1" :max="96000" controls-position="right"
                @update:model-value="v => patch(name, index, 'f', v)"/>
            </label>
            <label v-if="needs(filter.type, 'gain')">{{ $t('Gain [dB]') }}
              <el-input-number :model-value="num(filter.gain, 0)" :min="-40" :max="20" :step="0.25" controls-position="right"
                @update:model-value="v => patch(name, index, 'gain', v)"/>
            </label>
            <label v-if="needs(filter.type, 'q')">{{ $t('Q') }}
              <el-input-number :model-value="num(filter.q, 1)" :min="0.1" :max="20" :step="0.1" controls-position="right"
                @update:model-value="v => patch(name, index, 'q', v)"/>
            </label>
            <label v-if="filter.type === 'conv'" class="file-field">{{ $t('File') }}
              <el-select :model-value="filter.filename" @update:model-value="v => patch(name, index, 'filename', v)">
                <el-option v-for="f in coeffs" :key="f" :label="f" :value="`/opt/user_data/filters/${f}`"/>
              </el-select>
            </label>
            <div class="filter-actions">
              <el-button size="small" :disabled="index === 0" @click="move(name, index, -1)">↑</el-button>
              <el-button size="small" :disabled="index === slot.filters.length - 1" @click="move(name, index, 1)">↓</el-button>
              <el-button size="small" type="danger" @click="remove(name, index)">{{ $t('Remove') }}</el-button>
            </div>
          </div>
        </div>
        <el-empty v-else :description="$t('No filters')" :image-size="48"/>

        <div class="slot-actions">
          <el-select v-model="addType[name]" size="small" style="width: 140px">
            <el-option v-for="t in slot.allow" :key="t" :label="t" :value="t"/>
          </el-select>
          <el-button size="small" :disabled="slot.filters.length >= slot.max_steps" @click="add(name)">
            {{ $t('Add filter') }}
          </el-button>
        </div>
      </el-card>

      <!-- response curves -->
      <el-card shadow="never" class="curve-card">
        <template #header>{{ $t('Cascade response') }}</template>
        <div v-for="(slot, name) in plottable" :key="name" class="curve-row">
          <canvas :ref="el => curves[name] = el" class="curve" height="120"></canvas>
          <span class="curve-label">{{ name }}</span>
        </div>
        <el-empty v-if="!Object.keys(plottable).length" :description="$t('No filters')" :image-size="48"/>
      </el-card>

      <!-- locked context -->
      <el-collapse>
        <el-collapse-item :title="$t('Protected chain (read-only)')">
          <el-descriptions v-for="(names, sc) in schema.locked" :key="sc" :title="sc" border :column="4" size="small">
            <el-descriptions-item v-for="n in names" :key="n" :label="n">{{ n }}</el-descriptions-item>
          </el-descriptions>
        </el-collapse-item>
      </el-collapse>

      <div class="save-row">
        <el-button type="primary" :loading="saving" :disabled="!dirty" @click="save">
          {{ $t('Save & Apply') }}
        </el-button>
        <span v-if="dirty" class="hint">{{ $t('unsaved changes') }}</span>
      </div>
      </template>
        </el-tab-pane>
      </el-tabs>
    </template>
  </div>
</template>

<script>
import { cascadeResponse } from './dsp.js'

const PARAMS = {
  peak:  ['f', 'gain', 'q'],
  ls:    ['f', 'gain', 'q'],
  hs:    ['f', 'gain', 'q'],
  notch: ['f', 'q'],
  ap:    ['f', 'q'],
  gain:  ['gain'],
  delay: [],
  conv:  []
}

export default {
  data() {
    return {
      schema: null,
      coeffs: [],
      error: '',
      dirty: false,
      saving: false,
      savingSettings: false,
      activeTab: 'general',
      settings: { samplerate: 48000, chunksize: 1024, format: 'S16_LE', channels: 2, output_channels: 2, capture: 'Inferno', playback: 'File:/dev/null', gain: 0, source: 'mix' },
      chunkSizes: [256, 512, 1024, 2048, 4096],
      addType: {},
      curves: {},
    }
  },
  computed: {
    plottable() {
      if (!this.schema) return {}
      const out = {}
      for (const name in this.schema.editable) {
        const fs = this.schema.editable[name].filters
        if (fs.length && fs.some(f => ['peak', 'ls', 'hs', 'notch', 'ap', 'gain'].includes(f.type)))
          out[name] = fs
      }
      return out
    }
  },
  async created() {
    if (this.$route.query.tab === 'filters') this.activeTab = 'filters'
    await this.reload()
  },
  updated() {
    this.drawAll()
  },
  methods: {
    num(v, fallback) {
      const n = parseFloat(v)
      return Number.isFinite(n) ? n : fallback
    },
    needs(type, p) {
      return (PARAMS[type] ?? []).includes(p)
    },
    async reload() {
      try {
        this.schema = await this.$oui.call('dsp', 'get_saved_filters')
        const [settings] = await Promise.all([
          this.$oui.call('dsp', 'get_settings'),
        ])
        this.settings = { ...this.settings, ...settings }
        /* Empty output_channels means same as input in the UCI schema. */
        if (!this.settings.output_channels) this.settings.output_channels = this.settings.channels
        this.error = ''
        this.dirty = false
        for (const name in this.schema.editable)
          if (!this.addType[name])
            this.addType[name] = this.schema.editable[name].allow[0]
        const fl = await this.$oui.call('files', 'list')
        this.coeffs = (fl?.files ?? []).map(f => f.name)
      } catch (e) {
        this.error = String(e)
      }
    },
    patch(name, idx, key, value) {
      this.schema.editable[name].filters[idx][key] = value
      this.dirty = true
      if (key === 'type')
        this.schema.editable[name].filters[idx] = { type: value }
    },
    add(name) {
      const t = this.addType[name] ?? 'gain'
      const f = { type: t }
      for (const p of (PARAMS[t] ?? []))
        f[p] = (p === 'f') ? 1000 : (p === 'q') ? 1.0 : 0
      if (t === 'conv')
        f.filename = this.coeffs.length ? `/opt/user_data/filters/${this.coeffs[0]}` : ''
      this.schema.editable[name].filters.push(f)
      this.dirty = true
    },
    remove(name, idx) {
      this.schema.editable[name].filters.splice(idx, 1)
      this.dirty = true
    },
    move(name, idx, dir) {
      const fs = this.schema.editable[name].filters
      const [f] = fs.splice(idx, 1)
      fs.splice(idx + dir, 0, f)
      this.dirty = true
    },
    async save() {
      this.saving = true
      const steps = {}
      for (const name in this.schema.editable)
        steps[name] = this.schema.editable[name].filters.map(f => ({ ...f, name: undefined }))
      const r = await this.$oui.call('dsp', 'save_filters', { steps })
      this.saving = false
      if (r?.error)
        return this.$message.error(r.error.message)
      this.$message.success(this.$t('Configuration has been applied'))
      await this.reload()
    },
    async saveSettings() {
      this.savingSettings = true
      const r = await this.$oui.call('dsp', 'save_settings', { settings: this.settings })
      this.savingSettings = false
      if (r?.error) return this.$message.error(r.error.message)
      this.$message.success(this.$t('Configuration has been applied'))
    },
    drawAll() {
      for (const name in this.plottable) {
        const canvas = this.curves[name]
        if (!canvas) continue
        const resp = cascadeResponse(this.plottable[name], 48000)
        const ctx = canvas.getContext('2d')
        const W = canvas.width = canvas.offsetWidth || 600
        const H = canvas.height
        ctx.clearRect(0, 0, W, H)
        ctx.strokeStyle = '#409eff'
        ctx.lineWidth = 2
        ctx.beginPath()
        if (resp) {
          const { freqs, totalDb } = resp
          const dbMin = -18, dbMax = 18
          for (let i = 0; i < freqs.length; i++) {
            const x = (Math.log(freqs[i] / 20) / Math.log(1000 / 20)) * (W - 8) + 4
            const y = H - 6 - (Math.max(dbMin, Math.min(dbMax, totalDb[i])) - dbMin) / (dbMax - dbMin) * (H - 12)
            i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)
          }
        }
        ctx.stroke()
        /* zero line */
        ctx.strokeStyle = '#ddd'
        ctx.lineWidth = 1
        ctx.beginPath()
        ctx.moveTo(0, 6 + (H - 12) / 2)
        ctx.lineTo(W, 6 + (H - 12) / 2)
        ctx.stroke()
      }
    }
  }
}
</script>

<style scoped>
.filters-page { padding: 0 10px; }
.slot-card, .curve-card, .saved-note { margin-bottom: 12px; }
.general-form { max-width: 560px; }
.filter-list { display: grid; gap: 10px; }
.filter-row { display: flex; align-items: end; gap: 10px; flex-wrap: wrap; padding: 10px; border: 1px solid #ebeef5; border-radius: 4px; background: #fafafa; }
.filter-row label { display: grid; gap: 4px; min-width: 125px; color: #606266; font-size: 12px; }
.filter-row :deep(.el-input-number), .filter-row :deep(.el-select) { width: 135px; }
.filter-index { width: 22px; padding-bottom: 9px; color: #909399; }
.filter-actions { display: flex; gap: 4px; padding-bottom: 1px; }
.file-field { min-width: 220px !important; }
.file-field :deep(.el-select) { width: 220px; }
.hint { color: #888; font-size: 12px; margin-left: 8px; }
.slot-actions { margin-top: 8px; }
.curve-row { position: relative; }
.curve { width: 100%; display: block; background: #fafafa; border-radius: 4px; }
.curve-label { position: absolute; top: 4px; left: 8px; font-size: 12px; color: #888; }
.save-row { display: flex; align-items: center; gap: 12px; margin: 12px 0; }
</style>

<i18n src="./locale.json"/>
