<template>
  <div class="filters-page">
    <el-alert v-if="error" :title="error" type="error" :closable="false" show-icon/>

    <template v-if="schema">
      <el-tabs v-model="activeTab">
        <!-- General: quick settings. The source radio is the quick L/R
             switch; "Other" (manual mixer gains) is DISPLAY ONLY here --
             it is set from the Mixer tab, never from this one. -->
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
              <el-radio-group :model-value="settings.source" @update:model-value="quickSource">
                <el-radio-button label="0">{{ $t('Channel') }} 0</el-radio-button>
                <el-radio-button label="mix">{{ $t('Mix (L+R)/2') }}</el-radio-button>
                <el-radio-button label="1">{{ $t('Channel') }} 1</el-radio-button>
                <el-radio-button label="custom" disabled>{{ $t('Other') }}</el-radio-button>
              </el-radio-group>
            </el-form-item>
          </el-form>
          <el-divider/>
          <div class="save-row"><el-button type="primary" :loading="savingSettings" @click="saveSettings">{{ $t('Save & Apply') }}</el-button></div>
        </el-tab-pane>

        <!-- Filters: READ-ONLY view of the stored configuration. Live
             editing (with response preview) lives in DSP > EQ, which
             saves its bands to UCI from there. -->
        <el-tab-pane :label="$t('Filters')" name="filters">
      <!-- no editable slots: the protected pipeline is not configured on
           this device (no uci subchain sections) -->
      <el-empty v-if="!Object.keys(schema.editable).length && !Object.keys(schema.locked).length"
                :description="$t('No editable slots: this device ships a plain pass-through pipeline.')"/>
      <template v-else>
      <el-alert type="info" :closable="false" show-icon class="saved-note"
                :title="$t('Read-only view of the saved UCI filter configuration. Create and tune filters live in DSP > EQ, then save them to UCI from there.')"/>

      <!-- stored filters per editable slot (read-only) -->
      <el-card v-for="(slot, name) in schema.editable" :key="name" shadow="never" class="slot-card">
        <template #header>
          {{ name }}
          <el-tag size="small" type="info">{{ slot.policy }}</el-tag>
          <span class="hint">{{ $t('max') }} {{ slot.max_steps }} · {{ $t('ch') }} {{ slot.channels }} · {{ slot.allow.join(' ') }}</span>
        </template>

        <el-table v-if="slot.filters.length" :data="slot.filters" size="small">
          <el-table-column type="index" width="42"/>
          <el-table-column prop="type" :label="$t('Type')" width="120"/>
          <el-table-column :label="$t('Frequency')" width="210">
            <template #default="{ row }">{{ freq(row) }}</template>
          </el-table-column>
          <el-table-column :label="$t('Q')" width="145">
            <template #default="{ row }">{{ show(row, 'q') }}</template>
          </el-table-column>
          <el-table-column :label="$t('Gain')" width="210">
            <template #default="{ row }">{{ gain(row) }}</template>
          </el-table-column>
          <el-table-column :label="$t('File')">
            <template #default="{ row }">{{ row.type === 'conv' ? (row.filename ?? '—') : '—' }}</template>
          </el-table-column>
        </el-table>
        <el-empty v-else :description="$t('No filters')" :image-size="48"/>
      </el-card>
      </template>
        </el-tab-pane>

        <!-- Mixer: detailed control of the user_gains mixers. Quick
             presets (L / R / L+R) or "Other" = manual route gains
             following the locked topology. Always visible, like the
             filters tab: empty state when the policy exposes no mixer. -->
        <el-tab-pane :label="$t('Mixer')" name="mixer">
          <el-empty v-if="!mixers.length"
            :description="$t('No mixers exposed by the policy. The source mixer is provisioned at build time.')"/>
          <el-card v-for="m in mixers" :key="m.name" shadow="never" class="slot-card">
            <template #header>
              {{ m.name }}
              <el-tag size="small" :type="m.state === 'custom' ? 'warning' : 'info'">
                {{ m.state === 'custom' ? $t('Other') : sourceLabel(m.state) }}
              </el-tag>
            </template>

            <el-radio-group :model-value="radioOf(m)" @update:model-value="v => setSource(m, v)">
              <el-radio-button label="0">{{ $t('Channel') }} 0</el-radio-button>
              <el-radio-button label="mix">{{ $t('Mix (L+R)/2') }}</el-radio-button>
              <el-radio-button label="1">{{ $t('Channel') }} 1</el-radio-button>
              <el-radio-button label="custom">{{ $t('Other') }}</el-radio-button>
            </el-radio-group>

            <template v-if="manualActive(m)">
              <el-table :data="editGains[m.name]" size="small" class="gains-table">
                <el-table-column :label="$t('Dest')" width="70">
                  <template #default="{ row }">{{ row.dest }}</template>
                </el-table-column>
                <el-table-column :label="$t('Source')" width="90">
                  <template #default="{ row }">{{ row.source }}</template>
                </el-table-column>
                <el-table-column :label="$t('Gain')" width="210">
                  <template #default="{ row }">
                    <el-input-number v-model="row.dB" :min="-150" :max="50" :step="0.25"
                      :precision="2" size="small" controls-position="right">
                      <template #suffix><span>dB</span></template>
                    </el-input-number>
                  </template>
                </el-table-column>
              </el-table>
              <div class="save-row">
                <el-button type="primary" size="small" :loading="savingMixer" @click="applyGains(m)">{{ $t('Apply') }}</el-button>
                <span class="hint">{{ $t('Manual gains follow the locked mixer topology.') }}</span>
              </div>
            </template>
          </el-card>
        </el-tab-pane>
      </el-tabs>
    </template>
  </div>
</template>

<script>
export default {
  data() {
    return {
      schema: null,
      mixers: [],
      error: '',
      savingSettings: false,
      savingMixer: false,
      activeTab: 'general',
      settings: { samplerate: 48000, chunksize: 1024, format: 'S16_LE', channels: 2, output_channels: 2, capture: 'Inferno', playback: 'File:/dev/null', gain: 0, source: 'mix' },
      chunkSizes: [256, 512, 1024, 2048, 4096],
      editGains: {},
      manualMode: {}
    }
  },
  async created() {
    if (this.$route.query.tab === 'filters') this.activeTab = 'filters'
    if (this.$route.query.tab === 'mixer') this.activeTab = 'mixer'
    await this.reload()
  },
  methods: {
    async reload() {
      try {
        const [schema, settings, mix] = await Promise.all([
          this.$oui.call('dsp', 'get_saved_filters'),
          this.$oui.call('dsp', 'get_settings'),
          this.$oui.call('dsp', 'get_mixers')
        ])
        this.schema = schema
        this.settings = { ...this.settings, ...settings }
        if (!this.settings.output_channels) this.settings.output_channels = this.settings.channels
        this.mixers = mix?.mixers ?? []
        this.error = ''
      } catch (e) {
        this.error = String(e)
      }
    },
    show(f, key) {
      return f[key] != null ? f[key] : '—'
    },
    /* pipeline-app formatting: plain labels, units in the values */
    freq(f) {
      return f.f != null ? `${f.f} Hz` : '—'
    },
    gain(f) {
      return f.gain != null ? `${f.gain} dB` : '—'
    },
    sourceLabel(s) {
      return s === '0' || s === '1' ? `${this.$t('Channel')} ${s}`
        : s === 'mix' ? this.$t('Mix (L+R)/2') : s
    },
    linToDb(g) {
      g = +g
      return (!g || g < 1e-5) ? -150 : +(20 * Math.log10(g)).toFixed(2)
    },
    dbToLin(d) {
      return d <= -149.95 ? 0 : +Math.pow(10, d / 20).toFixed(4)
    },
    manualActive(m) {
      return this.manualMode[m.name] === true || m.state === 'custom'
    },
    radioOf(m) {
      return this.manualActive(m) ? 'custom' : m.state
    },
    /* General-tab quick switch: presets only ("Other" is display-only) */
    async quickSource(v) {
      if (v === 'custom')
        return
      const r = await this.$oui.call('dsp', 'save_settings', { settings: { source: v } })
      if (r?.error)
        return this.$message.error(r.error.message)
      await this.reload()
    },
    async setSource(m, v) {
      if (v === 'custom') {
        this.manualMode[m.name] = true
        this.editGains[m.name] = m.routes.map(r => ({ dest: r.dest, source: r.source, dB: this.linToDb(r.gain) }))
        return
      }
      this.manualMode[m.name] = false
      const r = await this.$oui.call('dsp', 'save_mixer', { mixer: m.name, source: v })
      if (r?.error)
        this.$message.error(r.error.message)
      await this.reload()
    },
    async applyGains(m) {
      this.savingMixer = true
      const routes = (this.editGains[m.name] ?? []).map(e => ({ dest: e.dest, source: e.source, gain: this.dbToLin(e.dB) }))
      try {
        const r = await this.$oui.call('dsp', 'save_mixer', { mixer: m.name, routes })
        if (r?.error)
          this.$message.error(r.error.message)
      } catch (e) {
        this.$message.error(String(e))
      }
      this.savingMixer = false
      await this.reload()
    },
    async saveSettings() {
      this.savingSettings = true
      const r = await this.$oui.call('dsp', 'save_settings', { settings: this.settings })
      this.savingSettings = false
      if (r?.error) return this.$message.error(r.error.message)
      this.$message.success(this.$t('Configuration has been applied'))
      await this.reload()
    }
  }
}
</script>

<style scoped>
.filters-page { padding: 0 10px; }
.slot-card, .saved-note { margin-bottom: 12px; }
.general-form { max-width: 560px; }
.hint { color: #888; font-size: 12px; margin-left: 8px; }
.gains-table { margin-top: 12px; max-width: 480px; }
.save-row { display: flex; align-items: center; gap: 12px; margin: 12px 0; }
</style>

<i18n src="./locale.json"/>
