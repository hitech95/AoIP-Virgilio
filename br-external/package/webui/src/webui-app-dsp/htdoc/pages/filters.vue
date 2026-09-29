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
          <el-tag type="info">{{ slot.policy }}</el-tag>
          <span class="hint">{{ $t('max') }} {{ slot.max_steps ?? '∞' }} · {{ $t('ch') }} {{ slot.channels || '—' }} · {{ slot.allow.length ? slot.allow.join(' ') : $t('any') }}</span>
        </template>

        <el-table v-if="slot.filters.length" :data="slot.filters">
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

        <!-- Mixer tab. Fader section (60vh): main fader card (flex,
             full height, value tag + slider + description) beside the
             block faders. Mixer section below: one card per mixer with
             the gain matrix. -->
        <el-tab-pane :label="$t('Mixer')" name="mixer">
          <div class="mixer-faders">
            <el-card shadow="never" class="fader-card-box fader-master">
              <template #header>{{ $t('Master volume') }}</template>
              <div class="fader-col">
                <el-tag class="fader-value" type="info" effect="dark">{{ mainVolume.toFixed(1) }} dB</el-tag>
                <el-slider v-model="mainVolume" vertical :min="-60" :max="0" :step="0.5"
                  height="100%" :marks="mainMarks" :format-tooltip="v => v + ' dB'"
                  @change="applyMainVolume"/>
                <span class="fader-label">{{ $t('Main') }}</span>
              </div>
            </el-card>

            <el-card v-for="(f, slot) in faders" :key="slot" shadow="never" class="fader-card-box fader-aux">
              <template #header>{{ slotLabel(slot) }}</template>
              <div class="fader-col">
                <el-tag class="fader-value" type="info" effect="plain" size="small">{{ faders[slot].toFixed(1) }} dB</el-tag>
                <el-slider v-model="faders[slot]" vertical :min="-24" :max="24" :step="0.5"
                  height="100%" :marks="faderMarks" :format-tooltip="v => v + ' dB'"/>
              </div>
            </el-card>
          </div>

          <el-empty v-if="!mixers.length"
            :description="$t('No mixers exposed by the policy. The source mixer is provisioned at build time.')"/>

          <el-card v-for="m in mixers" :key="m.name" shadow="never" class="slot-card mixer-block">
            <template #header>{{ m.name }}</template>

            <el-form inline class="mixer-meta">
              <el-form-item :label="$t('Inputs')">
                <el-input-number v-model="mixMetaEdits[m.name].in" :min="1" :max="16"
                  :disabled="m.channels_locked"/>
              </el-form-item>
              <el-form-item :label="$t('Outputs')">
                <el-input-number v-model="mixMetaEdits[m.name].out" :min="1" :max="16"
                  :disabled="m.channels_locked"/>
              </el-form-item>
            </el-form>
            <div v-if="m.channels_locked" class="hint mixer-hint">{{ $t('Channel counts are locked by the pipeline policy.') }}</div>

            <div class="mixer-presets">
              <el-radio-group v-model="mixSel[m.name]" @update:model-value="v => quickMix(m.name, v)">
                <el-radio-button label="0">{{ inName(m, 0) }}</el-radio-button>
                <el-radio-button label="mix">{{ inName(m, 0) }}+{{ inName(m, 1) }}</el-radio-button>
                <el-radio-button label="1">{{ inName(m, 1) }}</el-radio-button>
                <el-radio-button label="custom">{{ $t('Other') }}</el-radio-button>
              </el-radio-group>
            </div>

            <table class="mixer-matrix">
              <tr>
                <td class="matrix-cell matrix-corner" :rowspan="2" :colspan="2"></td>
                <td class="matrix-cell matrix-mute-head" :rowspan="2"
                  :class="{ 'cell-disabled': mixSel[m.name] !== 'custom' }"></td>
                <td class="matrix-cell matrix-head" :colspan="matrixSources(m.name).length">{{ $t('Input') }}</td>
              </tr>
              <tr>
                <td class="matrix-cell matrix-src" v-for="s in matrixSources(m.name)" :key="s"
                  :class="{ 'matrix-hl-col': isHl(m.name, null, s) }">
                  <el-tag type="info" effect="plain">{{ inName(m, s) }}</el-tag>
                </td>
              </tr>
              <tr v-for="d in matrixDests(m.name)" :key="d"
                :class="{ 'matrix-hl-row': isHl(m.name, d, null) }">
                <td v-if="d === matrixDests(m.name)[0]" class="matrix-cell matrix-rotate"
                    :rowspan="matrixDests(m.name).length"><div>{{ $t('Output') }}</div></td>
                <td class="matrix-cell matrix-idx">
                  <el-input v-if="editingOut(m.name, d)" v-model="editOutValue"
                    class="ch-label" maxlength="16" :placeholder="'CH' + d"
                    @keyup.enter="commitOutLabel(m.name, d)" @blur="commitOutLabel(m.name, d)"/>
                  <el-tag v-else type="success" effect="plain" class="label-tag"
                    :title="$t('Click to rename this output')" @click="startEditOut(m, d)">{{ outName(m, d) }}</el-tag>
                </td>
                <td class="matrix-cell matrix-mute" :class="{ 'cell-disabled': mixSel[m.name] !== 'custom' }">
                  <el-tooltip v-if="destClips(m.name, d)" :content="$t('Clipping risk')" placement="top">
                    <el-tag type="warning" effect="dark" class="clip-tag">!</el-tag>
                  </el-tooltip>
                  <el-button :type="cellMuted(m.name, d) ? 'danger' : 'info'"
                    circle @click="toggleDestMute(m.name, d)">
                    <svg viewBox="0 0 24 24" class="mx-icon-mute"><path d="M14,3.23V5.29C16.89,6.15 19,8.83 19,12C19,15.17 16.89,17.84 14,18.7V20.77C18,19.86 21,16.28 21,12C21,7.72 18,4.14 14,3.23M16.5,12C16.5,10.23 15.5,8.71 14,7.97V16C15.5,15.29 16.5,13.76 16.5,12M3,9V15H7L12,20V4L7,9H3Z"/></svg>
                  </el-button>
                </td>
                <td v-for="s in matrixSources(m.name)" :key="s"
                    class="matrix-cell matrix-cell-btn"
                    :class="{ 'matrix-active': !!matrixCell(m.name, d, s) && !cellMuted(m.name, d),
                              'cell-disabled': mixSel[m.name] !== 'custom',
                              'matrix-hl': isHl(m.name, d, s) }"
                    @click="openCell(m, d, s)"
                    @mouseenter="setHover(m.name, d, s)" @mouseleave="setHover(null)">
                  <template v-if="matrixCell(m.name, d, s)">
                    <span v-if="cellMuted(m.name, d)" class="cell-muted">{{ $t('Muted') }}</span>
                    <span v-else class="cell-gain">{{ cellDb(m.name, d, s) }} dB</span>
                  </template>
                </td>
              </tr>
            </table>
            <div class="hint mixer-hint">{{ $t('Choose Other to edit the matrix; a cell click opens the gain dialog.') }}</div>
          </el-card>

          <div v-if="mixers.length || Object.keys(faders).length" class="save-row">
            <el-button type="primary" :loading="savingMixer" :disabled="!mixerDirty" @click="saveMixer">
              {{ $t('Save & Apply') }}
            </el-button>
            <span v-if="mixerDirty" class="hint">{{ $t('unsaved changes') }}</span>
          </div>
        </el-tab-pane>

        <!-- gain dialog for one matrix cell -->
        <el-dialog :title="cellDialogTitle" v-model="cellDialog" width="320px">
          <el-form label-width="auto">
            <el-form-item :label="$t('Mode')">
              <el-select v-model="cellMode" style="width: 120px">
                <el-option label="dB" value="dB"/>
                <el-option :label="$t('Linear')" value="linear"/>
              </el-select>
            </el-form-item>
            <el-form-item :label="$t('Gain')">
              <el-input-number v-model="cellValue" :min="cellMode === 'dB' ? -150 : 0"
                :max="cellMode === 'dB' ? 50 : 10" :step="cellMode === 'dB' ? 0.25 : 0.01"
                :precision="cellMode === 'dB' ? 2 : 4"/>
            </el-form-item>
          </el-form>
          <template #footer>
            <el-button @click="cellDialog = false">{{ $t('Cancel') }}</el-button>
            <el-button type="primary" @click="applyCell">{{ $t('OK') }}</el-button>
          </template>
        </el-dialog>
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
      mixEdits: {},
      mixSel: {},
      mixPristine: {},
      faders: {},
      fadersPristine: {},
      mixMetaEdits: {},
      mixMetaPristine: {},
      stageNames: {},
      mainVolume: 0,
      cellDialog: false,
      cellMixer: null,
      cellDest: null,
      cellSource: null,
      cellValue: 0,
      cellMode: 'dB',
      editOutMixer: null,
      editOutIdx: null,
      editOutValue: '',
      hoverCellState: null
    }
  },
  computed: {
    mixerDirty() {
      for (const m of Object.keys(this.mixEdits)) {
        if (this.mixSel[m] !== (this.mixPristine[m]?.sel ?? 'custom')) return true
        if (JSON.stringify(this.mixEdits[m]) !== JSON.stringify(this.mixPristine[m]?.rows)) return true
        if (JSON.stringify(this.mixMetaEdits[m]) !== JSON.stringify(this.mixMetaPristine[m])) return true
      }
      for (const s of Object.keys(this.faders))
        if (this.faders[s] !== this.fadersPristine[s]) return true
      return false
    },
    mainMarks() {
      return Object.fromEntries(
        Array.from({ length: 11 }, (_, i) => -6 * i).map(v => [v, String(v)]))
    },
    faderMarks() {
      return Object.fromEntries(
        Array.from({ length: 9 }, (_, i) => -24 + 6 * i).map(v => [v, String(v)]))
    },
    cellDialogTitle() {
      if (!this.cellMixer) return ''
      return `${this.outName(this.cellMixer, this.cellDest)} <- ${this.inName(this.cellMixer, this.cellSource)}`
    },
  },
  async created() {
    if (this.$route.query.tab === 'filters') this.activeTab = 'filters'
    if (this.$route.query.tab === 'mixer') this.activeTab = 'mixer'
    await this.reload()
  },
  methods: {
    async reload() {
      try {
        const [schema, settings, mix, st, pipe] = await Promise.all([
          this.$oui.call('dsp', 'get_saved_filters'),
          this.$oui.call('dsp', 'get_settings'),
          this.$oui.call('dsp', 'get_mixers'),
          this.$oui.call('dsp', 'status'),
          this.$oui.call('dsp', 'get_pipeline')
        ])
        this.stageNames = {}
        for (const s of pipe?.stages ?? [])
          if (s.name) this.stageNames[s.label ?? s.index] = s.name
        if (st && Number.isFinite(Number(st.volume)))
          this.mainVolume = Math.max(-60, Math.min(0, Number(st.volume)))
        this.schema = schema
        this.settings = { ...this.settings, ...settings }
        /* uci values arrive as strings: coerce what the sliders bind to
           (a string gain froze the startup volume slider) */
        this.settings.gain = Number(this.settings.gain ?? 0)
        if (!this.settings.output_channels) this.settings.output_channels = this.settings.channels
        this.mixers = mix?.mixers ?? []
        this.stageMixerState()
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
    linToDb(g) {
      g = +g
      return (!g || g < 1e-5) ? -150 : +(20 * Math.log10(g)).toFixed(2)
    },
    dbToLin(d) {
      return d <= -149.95 ? 0 : +Math.pow(10, d / 20).toFixed(4)
    },
    /* build the staged (editable) view of the server state */
    stageMixerState() {
      const edits = {}, sels = {}, pristine = {}, meta = {}, metaP = {}
      for (const m of this.mixers) {
        const rows = m.routes.map(r => ({
          dest: r.dest, source: r.source,
          dB: this.linToDb(r.gain), mute: !!r.mute
        }))
        edits[m.name] = rows
        sels[m.name] = m.state
        pristine[m.name] = { sel: m.state, rows: rows.map(r => ({ ...r })) }
        meta[m.name] = {
          in: m.in ?? 2, out: m.out ?? 2,
          in_label: [...(m.in_label ?? [])],
          out_label: [...(m.out_label ?? [])]
        }
        metaP[m.name] = JSON.parse(JSON.stringify(meta[m.name]))
      }
      this.mixEdits = edits
      this.mixSel = sels
      this.mixPristine = pristine
      this.mixMetaEdits = meta
      this.mixMetaPristine = metaP
      /* block faders: leading gain filter of each editable slot */
      const faders = {}, pristineF = {}
      for (const [slot, def] of Object.entries(this.schema?.editable ?? {})) {
        const first = (def.filters ?? [])[0]
        if (first?.type === 'gain' && first.gain != null) {
          faders[slot] = Number(first.gain)
          pristineF[slot] = Number(first.gain)
        }
      }
      this.faders = faders
      this.fadersPristine = pristineF
    },
    quickMix(name, v) {
      if (v === 'custom') return
      for (const row of this.mixEdits[name] ?? []) {
        if (v === 'mix') row.dB = -6.02 /* 0.5 linear */
        else row.dB = String(row.source) === v ? 0 : -150
      }
    },
    /* ---- names ---- */
    mixerByName(name) {
      return this.mixers.find(m => m.name === name) ?? null
    },
    inName(m, i) {
      const l = this.mixMetaEdits[m.name]?.in_label ?? []
      return (l[+i] && String(l[+i]).trim()) || ('CH' + i)
    },
    outName(m, i) {
      const l = this.mixMetaEdits[m.name]?.out_label ?? []
      return (l[+i] && String(l[+i]).trim()) || ('CH' + i)
    },
    slotLabel(slot) {
      /* block faders: prefer the pipeline stage custom name */
      return this.stageNames[slot] ?? slot
    },
    /* hover cross-highlight: row + column of the hovered cell */
    setHover(m, d, s) {
      this.hoverCellState = m === null ? null : { m, d: String(d), s: String(s) }
    },
    isHl(m, d, s) {
      const h = this.hoverCellState
      if (!h || h.m !== m) return false
      const sameRow = d !== null && h.d === String(d)
      const sameCol = s !== null && h.s === String(s)
      return (sameRow && s !== null && h.s === String(s)) || (sameCol && d !== null && h.d === String(d)) ||
             (sameRow && s === null) || (sameCol && d === null)
    },
    /* per-output clipping: linear sum of the unmuted routes > 1.0 */
    destClips(name, dest) {
      const rows = (this.mixEdits[name] ?? []).filter(r => String(r.dest) === String(dest) && !r.mute)
      const sum = rows.reduce((acc, r) => acc + this.dbToLin(r.dB), 0)
      return sum > 1.0001
    },
    /* ---- matrix view helpers (dests x sources from the staged rows) ---- */
    matrixSources(name) {
      return [...new Set((this.mixEdits[name] ?? []).map(r => String(r.source)))].sort()
    },
    matrixDests(name) {
      return [...new Set((this.mixEdits[name] ?? []).map(r => String(r.dest)))].sort()
    },
    matrixCell(name, dest, source) {
      return (this.mixEdits[name] ?? []).find(r => String(r.dest) === String(dest) && String(r.source) === String(source))
    },
    cellMuted(name, dest) {
      const rows = (this.mixEdits[name] ?? []).filter(r => String(r.dest) === String(dest))
      return rows.length > 0 && rows.every(r => r.mute)
    },
    cellDb(name, dest, source) {
      const c = this.matrixCell(name, dest, source)
      return c ? c.dB.toFixed(2).replace(/\.00$/, '') : null
    },
    toggleDestMute(name, dest) {
      const muted = this.cellMuted(name, dest)
      for (const r of this.mixEdits[name] ?? [])
        if (String(r.dest) === String(dest)) r.mute = !muted
      this.mixSel[name] = 'custom'
    },
    openCell(m, dest, source) {
      if (this.mixSel[m.name] !== 'custom') return
      const c = this.matrixCell(m.name, dest, source)
      if (!c) return
      this.cellMixer = m
      this.cellDest = dest
      this.cellSource = source
      this.cellMode = 'dB'
      this.cellValue = c.dB
      this.cellDialog = true
    },
    applyCell() {
      const m = this.mixerByName(this.cellMixer?.name)
      if (!m) { this.cellDialog = false; return }
      let dB = this.cellValue
      if (this.cellMode === 'linear')
        dB = this.linToDb(this.cellValue)
      const c = this.matrixCell(m.name, this.cellDest, this.cellSource)
      if (c) c.dB = Math.round(dB * 100) / 100
      this.mixSel[m.name] = 'custom'
      this.cellDialog = false
    },
    /* output labels: click the channel tag to rename (UCI out_label) */
    editingOut(name, idx) {
      return this.editOutMixer === name && String(this.editOutIdx) === String(idx)
    },
    startEditOut(m, idx) {
      /* labels are editable regardless of the preset: presets only lock
       * the gain cells */
      this.editOutMixer = m.name
      this.editOutIdx = idx
      const l = this.mixMetaEdits[m.name]?.out_label ?? []
      this.editOutValue = l[+idx] ?? ''
    },
    commitOutLabel(name, idx) {
      if (!this.editingOut(name, idx)) return
      const meta = this.mixMetaEdits[name]
      if (meta) {
        while (meta.out_label.length <= +idx) meta.out_label.push('')
        meta.out_label[+idx] = this.editOutValue.trim()
      }
      this.editOutMixer = null
      this.editOutIdx = null
    },
    /* main fader: live DSP master volume, immediate */
    async applyMainVolume() {
      const r = await this.$oui.call('dsp', 'volume_set', { volume: this.mainVolume })
      if (r?.error) this.$message.error(r.error.message)
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
    /* one save for the whole page section: changed mixers first, then
     * the block faders (leading gain filters ride save_filters) */
    async saveMixer() {
      this.savingMixer = true
      try {
        for (const m of this.mixers) {
          const p = this.mixPristine[m.name]
          const metaChanged = JSON.stringify(this.mixMetaEdits[m.name]) !== JSON.stringify(this.mixMetaPristine[m.name])
          const changed = this.mixSel[m.name] !== p.sel ||
            JSON.stringify(this.mixEdits[m.name]) !== JSON.stringify(p.rows)
          if (changed) {
            const routes = this.mixEdits[m.name].map(e => ({
              dest: e.dest, source: e.source,
              gain: this.dbToLin(e.dB), mute: e.mute ? 1 : 0 }))
            const r = await this.$oui.call('dsp', 'save_mixer', { mixer: m.name, routes })
            if (r?.error) throw new Error(r.error.message)
          }
          if (metaChanged) {
            const me = this.mixMetaEdits[m.name]
            const r = await this.$oui.call('dsp', 'save_mixer_meta', {
              mixer: m.name,
              in_label: me.in_label.map(x => String(x ?? '').trim()).filter(x => x),
              out_label: me.out_label.map(x => String(x ?? '').trim()).filter(x => x) })
            if (r?.error) throw new Error(r.error.message)
            /* channel counts only when the policy allows them */
            if (!m.channels_locked && (me.in !== m.in || me.out !== m.out)) {
              const r2 = await this.$oui.call('dsp', 'save_mixer_meta', {
                mixer: m.name, in: me.in, out: me.out,
                in_label: [], out_label: [] })
              if (r2?.error) throw new Error(r2.error.message)
            }
          }
        }
        const changedSlots = Object.keys(this.faders)
          .filter(s => this.faders[s] !== this.fadersPristine[s])
        if (changedSlots.length) {
          const steps = {}
          for (const slot of changedSlots) {
            const filters = (this.schema.editable[slot].filters ?? []).map(f => ({ ...f }))
            if (!filters.length || filters[0].type !== 'gain') continue
            filters[0] = { type: 'gain', gain: Math.round(this.faders[slot] * 100) / 100 }
            steps[slot] = filters
          }
          if (Object.keys(steps).length) {
            const r = await this.$oui.call('dsp', 'save_filters', { steps })
            if (r?.error) throw new Error(r.error.message)
          }
        }
        this.$message.success(this.$t('Configuration has been applied'))
      } catch (e) {
        this.$message.error(String(e.message ?? e))
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
.mixer-matrix { border-collapse: collapse; margin-top: 12px; }
.mixer-matrix .matrix-cell {
  border: 1px solid var(--el-border-color-lighter);
  padding: 3px 8px; text-align: center; min-width: 52px; height: 34px;
}
.mixer-matrix .matrix-head { font-weight: 600; }
.mixer-matrix .matrix-corner { min-width: 0; width: 40px; }
.mixer-matrix .matrix-rotate div {
  writing-mode: vertical-rl; transform: rotate(180deg);
  font-size: 12px; color: var(--el-text-color-secondary); margin: 0 auto;
}
.mixer-matrix .matrix-active { background: rgba(103, 194, 58, 0.15); }
.mixer-matrix .matrix-cell-btn { cursor: pointer; }
.mixer-matrix .cell-gain { font-size: 12px; }
.mixer-matrix .cell-muted { font-size: 12px; color: var(--el-text-color-secondary); }
.mixer-matrix .matrix-mute { padding: 2px; }
.mx-icon-mute { width: 16px; height: 16px; fill: currentColor; }
.mixer-faders { display: flex; gap: 16px; align-items: stretch; height: 60vh; margin-bottom: 16px; }
/* compact: master 200px, one card per aux fader at 100px */
.fader-card-box { display: flex; flex-direction: column; min-width: 0; }
.fader-master { flex: 0 0 200px; }
.fader-aux { flex: 0 0 100px; }
.fader-card-box :deep(.el-card__body) { flex: 1; min-height: 0; display: flex; padding: 12px 8px; }
.fader-col { display: flex; flex-direction: column; align-items: center; flex: 1; min-height: 0; padding: 6px 0; }
/* the slider must not ride over the value tag / label */
.fader-col .el-slider { flex: 1; min-height: 0; margin: 10px 0; }
.fader-value { flex-shrink: 0; margin-bottom: 8px; }
.fader-label { font-size: 12px; color: var(--el-text-color-secondary); flex-shrink: 0; margin-top: 10px; }
.mixer-faders .el-slider__marks-text { font-size: 10px; }
.fader-aux .fader-col .el-slider { margin-left: 14px; }
.label-tag { cursor: pointer; }
.mixer-hint { margin: 10px 0 4px; }
.fader-label { font-size: 12px; color: var(--el-text-color-secondary); }
.ch-label { width: 110px; }
.mixer-meta { margin-bottom: 4px; }
/* fixed label column: the table must not change width in edit mode */
.mixer-matrix .matrix-idx { width: 96px; min-width: 96px; max-width: 96px; }
.mixer-matrix .matrix-idx .ch-label { width: 88px; }
/* source tags aligned to the end */
.mixer-matrix .matrix-src { text-align: right; }
.mixer-matrix .matrix-hl { background: var(--el-fill-color-light); }
.mixer-matrix .matrix-hl-col { background: var(--el-fill-color-light); }
.mixer-matrix tr.matrix-hl-row td { background: var(--el-fill-color-light); }
.mixer-matrix .matrix-active.matrix-hl { background: rgba(103, 194, 58, 0.35); }
.mixer-matrix .cell-disabled { opacity: 0.45; pointer-events: none; }
.mixer-matrix .clip-tag { font-weight: 700; margin-right: 4px; }
.mixer-matrix .matrix-mute-head { min-width: 48px; }
.save-row { display: flex; align-items: center; gap: 12px; margin: 12px 0; }
</style>

<i18n src="./locale.json"/>
