<template>
  <section v-show="active" class="volume-page">
    <el-alert v-if="error" type="error" :title="error" :closable="false" show-icon />

    <!-- Top section: the capture card (input VUs + the MAIN fader -- the
         pre-chain volume, so it scales exactly the signals shown), then
         the camilladsp AUX1-4 faders (disabled unless a Volume filter in
         the pipeline maps them). -->
    <div class="fader-row">
      <el-card shadow="never" class="vol-fader capture-card">
        <template #header>{{ $t('Capture') }}</template>
        <div class="fader-col">
          <el-tag class="fader-value" type="info" effect="dark">{{ faderDb(0).toFixed(1) }} dB</el-tag>
          <div class="fader-and-meter">
            <VuMeter :levels="capRms" :peaks="capPeak" :labels="inLabels" height="100%" />
            <div class="fader-slider">
              <el-slider :model-value="faderPos(0)" vertical :min="1" :max="1000" :step="1"
                height="100%" :marks="marksMain" placement="right"
                :format-tooltip="v => posToDb(v).toFixed(1) + ' dB'"
                @update:model-value="v => setFaderPos(0, v)"
                @change="applyFader(0)" />
            </div>
          </div>
          <span class="fader-label">{{ $t('Main') }}</span>
        </div>
      </el-card>

      <el-card v-for="a in auxes" :key="a.idx" shadow="never" class="vol-fader"
        :class="{ 'fader-off': !a.mapped }">
        <template #header>Aux{{ a.idx }}</template>
        <div class="fader-col">
          <el-tag class="fader-value" type="info" :effect="a.mapped ? 'plain' : 'light'">
            {{ faderDb(a.idx).toFixed(1) }} dB
          </el-tag>
          <div class="fader-slider">
            <el-slider :model-value="faderPos(a.idx)" vertical :min="1" :max="1000" :step="1"
              height="100%" :disabled="!a.mapped" :marks="marksAux" placement="right"
              :format-tooltip="v => posToDb(v).toFixed(1) + ' dB'"
              @update:model-value="v => setFaderPos(a.idx, v)"
              @change="a.mapped && applyFader(a.idx)" />
          </div>
          <span class="fader-label" :title="a.using">{{ a.mapped ? a.using : '' }}</span>
        </div>
      </el-card>

      <!-- End of the chain: playback card with only the output VU meters,
           same row as the capture/master and the aux faders -->
      <el-card shadow="never" class="vol-fader playback-card">
        <template #header>{{ $t('Playback') }}</template>
        <div class="fader-col">
          <el-tag class="fader-value fader-value-ghost" type="info" effect="plain">0.0 dB</el-tag>
          <div class="fader-and-meter">
            <VuMeter :levels="pbRms" :peaks="pbPeak" :labels="outLabels" height="100%" />
          </div>
          <span class="fader-label">&nbsp;</span>
        </div>
      </el-card>
    </div>

    <!-- Mixer blocks exposed by the policy (user_gains): one card each
         with the gain matrix, behaving like the configuration page
         (presets, Other-mode cell dialog, destination mute, output label
         rename) but applying LIVE. -->
    <el-card v-for="m in mixers" :key="m.name" shadow="never" class="mixer-card">
      <template #header>{{ m.name }}</template>

      <div class="mixer-presets">
        <el-radio-group :model-value="mixSel[m.name]" @update:model-value="v => quickMix(m, v)">
          <el-radio-button label="0">{{ inName(m, m.sources[0]) }}</el-radio-button>
          <el-radio-button label="mix">{{ inName(m, m.sources[0]) }}+{{ inName(m, m.sources[1]) }}</el-radio-button>
          <el-radio-button label="1">{{ inName(m, m.sources[1]) }}</el-radio-button>
          <el-radio-button label="custom">{{ $t('Other') }}</el-radio-button>
        </el-radio-group>
      </div>

      <table class="mixer-matrix">
        <tr>
          <td class="matrix-cell matrix-corner" :rowspan="2" :colspan="2" />
          <td class="matrix-cell matrix-mute-head" :rowspan="2"
            :class="{ 'cell-disabled': mixSel[m.name] !== 'custom' }" />
          <td class="matrix-cell matrix-head" :colspan="m.sources.length">{{ $t('Input') }}</td>
        </tr>
        <tr>
          <td v-for="s in m.sources" :key="s" class="matrix-cell matrix-src"
            :class="{ 'matrix-hl-col': isHl(m.name, null, s) }"
            @mouseenter="setHover(m.name, null, s)" @mouseleave="setHover(null)">
            <el-tag type="info" effect="plain">{{ inName(m, s) }}</el-tag>
          </td>
        </tr>
        <tr v-for="d in m.dests" :key="d"
          :class="{ 'matrix-hl-row': isHl(m.name, d, null) }">
          <td v-if="d === m.dests[0]" class="matrix-cell matrix-rotate"
            :rowspan="m.dests.length"><div>{{ $t('Output') }}</div></td>
          <td class="matrix-cell matrix-idx">
            <el-popover :visible="editingOut(m.name, d)" placement="top" :width="240"
              popper-class="out-label-pop" trigger="manual">
              <template #reference>
                <el-tag type="success" effect="plain" class="label-tag"
                  :title="$t('Click to rename this output')" @click="startEditOut(m, d)">{{ outName(m, d) }}</el-tag>
              </template>
              <div class="out-edit" @mousedown.stop>
                <el-input :ref="el => setOutRef(m, d, el)" v-model="editOutValue" size="small"
                  maxlength="16" :placeholder="'CH' + d" @keyup.enter="commitOutLabel()" />
                <el-button type="primary" size="small" @click="commitOutLabel()">{{ $t('Save') }}</el-button>
              </div>
            </el-popover>
          </td>
          <td class="matrix-cell matrix-mute" :class="{ 'cell-disabled': mixSel[m.name] !== 'custom' }">
            <el-tooltip v-if="destClips(m, d)" :content="$t('Clipping risk')" placement="top">
              <el-tag type="warning" effect="dark" class="clip-tag">!</el-tag>
            </el-tooltip>
            <el-button :type="destMuted(m, d) ? 'danger' : 'info'" circle size="small"
              @click="toggleDestMute(m, d)">
              <svg viewBox="0 0 24 24" class="mx-icon-mute"><path d="M14,3.23V5.29C16.89,6.15 19,8.83 19,12C19,15.17 16.89,17.84 14,18.7V20.77C18,19.86 21,16.28 21,12C21,7.72 18,4.14 14,3.23M16.5,12C16.5,10.23 15.5,8.71 14,7.97V16C15.5,15.29 16.5,13.76 16.5,12M3,9V15H7L12,20V4L7,9H3Z" /></svg>
            </el-button>
          </td>
          <td v-for="s in m.sources" :key="s"
            class="matrix-cell matrix-cell-btn"
            :class="{ 'matrix-active': !!routeOf(m, d, s) && !destMuted(m, d),
                      'matrix-muted': destMuted(m, d),
                      'cell-disabled': mixSel[m.name] !== 'custom',
                      'matrix-hl': isHl(m.name, d, s) }"
            @click="mixSel[m.name] === 'custom' && openCell(m, d, s)"
            @mouseenter="setHover(m.name, d, s)" @mouseleave="setHover(null)">
            <template v-if="routeOf(m, d, s)">
              <span v-if="destMuted(m, d)" class="cell-muted">{{ $t('Muted') }}</span>
              <span v-else class="cell-gain">{{ routeDb(m, d, s) }} dB</span>
            </template>
          </td>
        </tr>
      </table>
      <div class="hint">{{ $t('Choose Other to edit the matrix; a cell click opens the gain dialog.') }}</div>
    </el-card>

    <el-empty v-if="!mixers.length"
      :description="$t('No mixers exposed by the policy. The source mixer is provisioned at build time.')" />

    <!-- gain dialog for one matrix cell (same as the configuration page) -->
    <el-dialog :title="cellDialogTitle" v-model="cellDialog" width="320px">
      <el-form label-width="auto">
        <el-form-item :label="$t('Mode')">
          <el-select v-model="cellMode" style="width: 120px">
            <el-option label="dB" value="dB" />
            <el-option :label="$t('Linear')" value="linear" />
          </el-select>
        </el-form-item>
        <el-form-item :label="$t('Gain')">
          <el-input-number v-model="cellValue" :min="cellMode === 'dB' ? -150 : 0"
            :max="cellMode === 'dB' ? 50 : 10" :step="cellMode === 'dB' ? 0.25 : 0.01"
            :precision="cellMode === 'dB' ? 2 : 4" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="cellDialog = false">{{ $t('Cancel') }}</el-button>
        <el-button type="primary" @click="applyCell">{{ $t('OK') }}</el-button>
      </template>
    </el-dialog>
  </section>
</template>

<script>
import VuMeter from '../VuMeter.vue'
import * as dsp from '../../dsp'
import { dbToLinear, linearToDb } from '../../lib/liveToUci'
import { initializeFromConfig } from '../../stores/eqStore'

const POLL_MS = 90
const FADER_POLL_MS = 500

/* Volume tab of the Live page: the capture card (input VUs + the MAIN
 * fader -- camilladsp applies it BEFORE the pipeline), the camilladsp
 * AUX1-4 faders (enabled when a Volume filter maps them), the
 * policy-exposed mixer blocks as gain matrices behaving like the
 * configuration page, and the end-of-chain playback VU card. Mixer and
 * fader edits go live over the page-owned websocket; persistence via
 * the page-level Save. */
export default {
  name: 'VolumeTab',
  components: { VuMeter },
  props: {
    active: { type: Boolean, default: false }
  },
  data() {
    return {
      error: '',
      faders: [0, 0, 0, 0, 0],  /* dB per fader: 0=Main, 1..4=Aux1..4 */
      faderPositions: [1000, 1000, 1000, 1000, 1000],
      auxes: [{ idx: 1, mapped: false, using: '' }, { idx: 2, mapped: false, using: '' },
              { idx: 3, mapped: false, using: '' }, { idx: 4, mapped: false, using: '' }],
      mixers: [],
      mixSel: {},
      capRms: [], capPeak: [], pbRms: [], pbPeak: [],
      inLabels: [], outLabels: [],
      hover: null,
      userFader: {},
      cellDialog: false, cellMixer: null, cellDest: 0, cellSource: 0,
      cellMode: 'dB', cellValue: 0,
      editOut: null, editOutValue: ''
    }
  },
  computed: {
    /* log-spaced notches with labels (audio taper) */
    /* marks render as notch dots only (blank labels): the readable dB
     * labels live in the fader-scale strip beside the slider */
    marksMain() { return this.marksFor([0, -6, -12, -24, -60]) },
    marksAux() { return this.marksFor([0, -6, -12, -24, -60]) },
    cellDialogTitle() {
      if (!this.cellMixer) return ''
      return `${this.outName(this.cellMixer, this.cellDest)} <- ${this.inName(this.cellMixer, this.cellSource)}`
    }
  },
  watch: {
    async active(v) {
      if (v) {
        try {
          await this.reload()
        } catch (e) { this.error = e?.value?.message ?? e?.message ?? String(e) }
        this.startMeters()
      } else {
        this.stopMeters()
      }
    }
  },
  async created() {
    /* Load only when already shown: the page mounts every tab at once and
     * the camilladsp websocket may not be up yet -- an eager failing load
     * here would flash the error alert until the first activation. */
    if (this.active) {
      try {
        await this.reload()
      } catch (e) { this.error = e?.message ?? String(e) }
    }
  },
  mounted() {
    if (this.active) this.startMeters()
    document.addEventListener('mousedown', this.closeOutEditor)
  },
  beforeUnmount() {
    this.stopMeters()
    document.removeEventListener('mousedown', this.closeOutEditor)
    for (const t of Object.values(this._ufTimers ?? {})) clearTimeout(t)
  },
  methods: {
    /* ---- log taper: pos (1..2000) <-> dB (-60..+6) ---- */
    posToDb(pos) {
      return Math.round(20 * Math.log10(Math.max(1, Number(pos)) / 1000) * 10) / 10
    },
    dbToPos(db) {
      return Math.max(1, Math.round(1000 * Math.pow(10, db / 20)))
    },
    marksFor(dbList) {
      /* native EP mark labels: EP places dots and text inside the runway
       * coordinate space, so labels stay glued to the notches */
      const out = {}
      for (const db of dbList) out[this.dbToPos(db)] = String(db)
      return out
    },
    faderDb(idx) { return Number(this.faders[idx] ?? 0) },
    faderPos(idx) { return this.faderPositions[idx] ?? 1000 },
    /* while the user drags (and until the daemon echo lands) the fader
       poll must not overwrite the position, or the handle snaps back */
    markUserFader(idx) {
      this.userFader[idx] = true
      this._ufTimers = this._ufTimers || {}
      clearTimeout(this._ufTimers[idx])
      this._ufTimers[idx] = setTimeout(() => { delete this.userFader[idx] }, 3000)
    },
    clearUserFader(idx) {
      delete this.userFader[idx]
      clearTimeout(this._ufTimers?.[idx])
    },
    setFaderPos(idx, pos) {
      this.faderPositions[idx] = pos
      this.faders[idx] = this.posToDb(pos)
      this.markUserFader(idx)
    },
    /* model from the daemon (mixers + labels), the running config and
     * the camilladsp faders */
    async reload() {
      const mix = await this.$oui.call('dsp', 'get_mixers').catch(() => ({ mixers: [] }))
      const m0 = (mix?.mixers ?? [])[0]
      this.inLabels = m0?.in_label ?? []
      this.outLabels = m0?.out_label ?? []

      let cfg = dsp.config.value
      if (!cfg) cfg = await dsp.downloadConfig()
      if (!cfg) { this.mixers = []; return }

      await this.readFaders()

      /* AUX1-4 availability: Volume filters in the running pipeline */
      const using = { 1: [], 2: [], 3: [], 4: [] }
      for (const step of (cfg.pipeline ?? [])) {
        for (const name of (step?.names ?? [])) {
          const f = cfg.filters?.[name]
          const m = f?.type === 'Volume' ? /^Aux([1-4])$/.exec(f.parameters?.fader ?? '') : null
          if (m) using[+m[1]].push(f.description || name)
        }
      }
      for (const a of this.auxes) {
        a.mapped = using[a.idx].length > 0
        a.using = using[a.idx].join(', ')
      }

      /* mixer matrices from the live mapping */
      const mixers = []
      for (const m of (mix?.mixers ?? [])) {
        const live = cfg.mixers?.[m.name]
        if (!live?.mapping) continue
        const sources = []
        for (const d of live.mapping)
          for (const s of (d.sources ?? []))
            if (!sources.includes(s.channel)) sources.push(s.channel)
        sources.sort((a, b) => a - b)
        const dests = live.mapping.map(d => d.dest).sort((a, b) => a - b)
        const mx = { name: m.name, mapping: live.mapping, sources, dests }
        mixers.push(mx)
        this.mixSel[m.name] = this.deriveSel(mx)
      }
      this.mixers = mixers
      this.error = ''
    },
    async readFaders() {
      const body = await dsp.request('GetFaders').catch(() => null)
      const list = body?.value
      if (!Array.isArray(list)) return
      for (let i = 0; i < 5 && i < list.length; i++) {
        if (this.userFader[i]) continue
        this.faders[i] = Number(list[i]?.volume ?? 0)
        this.faderPositions[i] = this.dbToPos(Math.max(-60, Math.min(6, this.faders[i])))
      }
    },
    /* camilladsp fader set (Main=0, Aux1..4=1..4); live */
    async applyFader(idx) {
      const db = this.posToDb(this.faderPos(idx))
      const body = await dsp.request('SetFaderVolume', [idx, db]).catch(e => e)
      const value = body?.value
      if (value && Number.isFinite(Number(value.volume))) {
        this.faders[idx] = Number(value.volume)
        this.faderPositions[idx] = this.dbToPos(Math.max(-60, Math.min(6, Number(value.volume))))
      } else {
        this.$message.error(this.$t('Update failed'))
      }
      this.clearUserFader(idx)
    },
    /* ---- mixer matrix model (config-page semantics, live-applied) ---- */
    routeOf(m, dest, source) {
      const d = m.mapping.find(x => x.dest === dest)
      return d?.sources?.find(s => s.channel === source) ?? null
    },
    routeLin(r) {
      return (r.scale === 'linear') ? Number(r.gain) : dbToLinear(Number(r.gain) || 0)
    },
    routeDb(m, dest, source) {
      const r = this.routeOf(m, dest, source)
      if (!r) return '—'
      const db = linearToDb(this.routeLin(r))
      if (!Number.isFinite(db) || db <= -99) return '-∞'
      if (db <= -0.005 && db >= -99) return String(+(db.toFixed(2)))
      return String(+(db.toFixed(2)))
    },
    destMuted(m, dest) {
      const d = m.mapping.find(x => x.dest === dest)
      return !!d?.mute
    },
    destClips(m, dest) {
      const d = m.mapping.find(x => x.dest === dest)
      if (!d || d.mute) return false
      let linear = 0
      for (const s of (d.sources ?? [])) {
        if (s.mute) continue
        linear += this.routeLin(s)
      }
      return linear > 1 + 1e-6
    },
    inName(m, s) { return this.inLabels[s]?.trim() || `CH${s}` },
    outName(m, d) { return this.outLabels[d]?.trim() || `CH${d}` },
    /* preset state from the live gains (mirrors the daemon mix_get):
     * all routes at 0.5 = mix; a single source feeding every dest with
     * the others at zero = that channel; anything else = custom */
    deriveSel(m) {
      let one = 0, mix = 0
      const routes = []
      for (const d of m.mapping)
        for (const s of (d.sources ?? [])) routes.push(s)
      for (const r of routes) {
        const lin = r.mute ? 0 : this.routeLin(r)
        if (Math.abs(lin - 1) < 1e-6) one++
        else if (Math.abs(lin - 0.5) < 1e-6) mix++
      }
      if (routes.length && mix === routes.length) return 'mix'
      if (one > 0) {
        let sel = null
        for (const d of m.mapping)
          for (const s of (d.sources ?? [])) {
            if (s.mute || Math.abs(this.routeLin(s) - 1) > 1e-6) continue
            const ch = String(s.channel)
            if (sel === null) sel = ch
            else if (sel !== ch) return 'custom'
          }
        if (sel !== null) return sel
      }
      return 'custom'
    },
    setHover(m, d, s) {
      this.hover = m == null ? null : { m, d: d === null ? null : String(d), s: s === null ? null : String(s) }
    },
    /* cross-highlight: the hovered cell plus its whole row and column */
    isHl(m, d, s) {
      const h = this.hover
      if (!h || h.m !== m) return false
      const sameRow = d !== null && h.d === String(d)
      const sameCol = s !== null && h.s === String(s)
      return (sameRow && s !== null && h.s === String(s)) || (sameCol && d !== null && h.d === String(d)) ||
             (sameRow && s === null) || (sameCol && d === null)
    },
    /* apply a new mapping to the running config + local model;
     * resolves false (with a toast) when the upload fails */
    async applyMapping(m, mapping) {
      this.hover = null
      const cfg = JSON.parse(JSON.stringify(dsp.config.value ?? {}))
      const live = cfg.mixers?.[m.name]
      if (!live) return false
      live.mapping = mapping
      try {
        const confirmed = await dsp.uploadConfig(cfg)
        if (confirmed && dsp.config.value) {
          initializeFromConfig(dsp.config.value)
          /* camilladsp applies asynchronously: sync from the local edit */
          m.mapping = JSON.parse(JSON.stringify(mapping))
          this.mixSel[m.name] = this.deriveSel(m)
        }
        return !!confirmed
      } catch (e) {
        this.$message.error(this.$t('Update failed') + (e?.value?.message ? `: ${e.value.message}` : ''))
        return false
      }
    },
    /* presets: 0 / mix / 1 (live); 'custom' only switches mode */
    async quickMix(m, v) {
      this.mixSel[m.name] = v
      this.hover = null
      if (v === 'custom') return
      const mapping = JSON.parse(JSON.stringify(m.mapping))
      for (const d of mapping)
        for (const s of (d.sources ?? [])) {
          let db
          if (v === 'mix') db = -6.02 /* 0.5 linear */
          else db = String(s.channel) === v ? 0 : -150
          s.gain = v === 'mix' ? 0.5 : (db === 0 ? 1 : 0)
          s.scale = 'linear'
        }
      const ok = await this.applyMapping(m, mapping)
      if (!ok) this.mixSel[m.name] = this.deriveSel(m)
    },
    openCell(m, dest, source) {
      this.cellMixer = m
      this.cellDest = dest
      this.cellSource = source
      const r = this.routeOf(m, dest, source)
      this.cellMode = 'dB'
      if (r) {
        const lin = this.routeLin(r)
        this.cellValue = +(20 * Math.log10(Math.max(1e-5, lin))).toFixed(2)
      } else {
        this.cellValue = 0
      }
      this.cellDialog = true
    },
    async applyCell() {
      this.cellDialog = false
      const m = this.cellMixer
      if (!m) return
      const lin = this.cellMode === 'dB' ? Math.pow(10, this.cellValue / 20) : this.cellValue
      const mapping = JSON.parse(JSON.stringify(m.mapping))
      const d = mapping.find(x => x.dest === this.cellDest)
      if (!d) return
      let s = d.sources?.find(x => x.channel === this.cellSource)
      if (!s) {
        d.sources = d.sources ?? []
        s = { channel: this.cellSource, gain: 1, scale: 'linear' }
        d.sources.push(s)
      }
      s.gain = lin
      s.scale = 'linear'
      await this.applyMapping(m, mapping)
    },
    async toggleDestMute(m, dest) {
      const mapping = JSON.parse(JSON.stringify(m.mapping))
      const d = mapping.find(x => x.dest === dest)
      if (!d) return
      d.mute = !d.mute
      await this.applyMapping(m, mapping)
    },
    /* output label rename: uci out_label via save_mixer_meta */
    editingOut(mixer, d) {
      return this.editOut?.mixer === mixer && this.editOut?.d === d
    },
    startEditOut(m, d) {
      this.editOut = { mixer: m.name, d }
      this.editOutValue = this.outName(m, d)
      this.$nextTick(() => {
        const input = this._outRefs?.[`${m.name}:${d}`]
        input?.focus?.()
        input?.select?.()
      })
    },
    setOutRef(m, d, el) {
      this._outRefs = this._outRefs || {}
      this._outRefs[`${m.name}:${d}`] = el
    },
    closeOutEditor(e) {
      if (!this.editOut) return
      const t = e.target
      if (t.closest && (t.closest('.out-label-pop') || t.closest('.label-tag'))) return
      this.editOut = null
    },
    async commitOutLabel() {
      const edit = this.editOut
      this.editOut = null
      if (!edit || this.editOutValue.trim() === this.outLabels[edit.d]?.trim()) return
      try {
        const mix = await this.$oui.call('dsp', 'get_mixers')
        const m0 = (mix?.mixers ?? []).find(x => x.name === edit.mixer)
        const out = [...(m0?.out_label ?? [])]
        while (out.length <= +edit.d) out.push('')
        out[+edit.d] = String(this.editOutValue ?? '').trim().slice(0, 16)
        const r = await this.$oui.call('dsp', 'save_mixer_meta', {
          mixer: edit.mixer, out_label: out.filter(x => x || out.lastIndexOf(x) >= 0)
        })
        if (r?.error) throw new Error(r.error.message)
        this.outLabels = out
      } catch (e) {
        this.$message.error(this.$t('Update failed') + (e?.message ? `: ${e.message}` : ''))
      }
    },
    /* ---- VU polling: last-chunk peak + rms per channel ---- */
    startMeters() {
      if (this._vuTimer) return
      const read = async () => {
        const capR = await this.safeLevels('GetCaptureSignalRms')
        const capP = await this.safeLevels('GetCaptureSignalPeak')
        const pbR = await this.safeLevels('GetPlaybackSignalRms')
        const pbP = await this.safeLevels('GetPlaybackSignalPeak')
        if (capR) this.capRms = capR
        if (capP) this.capPeak = capP
        if (pbR) this.pbRms = pbR
        if (pbP) this.pbPeak = pbP
      }
      this._vuTimer = setInterval(read, POLL_MS)
      read()
      /* faders: slower poll keeps the sliders in sync with external changes */
      this._faderTimer = setInterval(() => { void this.readFaders() }, FADER_POLL_MS)
    },
    stopMeters() {
      clearInterval(this._vuTimer)
      this._vuTimer = null
      clearInterval(this._faderTimer)
      this._faderTimer = null
    },
    async safeLevels(command) {
      const body = await dsp.request(command).catch(() => null)
      const value = body?.value
      return Array.isArray(value) ? value : null
    }
  }
}
</script>

<i18n src="../../locale.json"/>

<style scoped>
.volume-page {
  padding: 12px 10px;
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.fader-row {
  display: flex;
  align-items: stretch;
  gap: 14px;
  height: 60vh;
  min-height: 480px;
}

.vol-fader {
  min-width: 130px;
  height: 100%;
  max-height: 100%;
  box-sizing: border-box;
  overflow: hidden;
  display: flex;
  flex-direction: column;
}

.vol-fader :deep(.el-card__body) {
  flex: 1;
  min-height: 0;
  padding: 10px 14px;
  display: flex;
  flex-direction: column;
}

.vol-fader.fader-off :deep(.el-card__header) {
  color: var(--el-text-color-secondary);
}

.fader-value-ghost {
  visibility: hidden;
}

.fader-hint,
.vol-fader .fader-label {
  color: var(--el-text-color-secondary);
}

.playback-card :deep(.el-card__body) {
  display: flex;
  justify-content: center;
}

.fader-col {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
}

.fader-value {
  flex-shrink: 0;
}

.fader-value {
  min-width: 72px;
  text-align: center;
}

.fader-and-meter {
  flex: 1;
  min-height: 0;
  display: flex;
  align-items: stretch;
  gap: 12px;
}

/* Native EP mark labels ride on the runway, so they track the notch dots
 * exactly. The runway is inset vertically: the 0 dB handle stays inside
 * the card (no overlap with the value tag) and every fader in every card
 * gets the same runway length. */
.vol-fader :deep(.el-slider__marks-text) {
  font-size: var(--el-font-size-base);
  color: var(--el-text-color-secondary);
}

.vol-fader :deep(.el-slider__runway) {
  height: calc(100% - 28px) !important;
  margin: 14px 10px !important;
}

.fader-and-meter .vu-vertical {
  padding: 14px 0;
}

.fader-slider {
  position: relative;
  display: flex;
  align-items: stretch;
  height: 100%;
  /* room for the built-in mark labels EP draws right of the runway */
  min-width: 56px;
}

.fader-label {
  color: var(--el-text-color-secondary);
  font-size: var(--el-font-size-base);
  max-width: 130px;
  height: 20px;
  line-height: 20px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  flex-shrink: 0;
}

/* ---- mixer matrix (mirrors the configuration page) ---- */
.mixer-presets {
  margin: 4px 0 8px;
}

.mixer-matrix {
  border-collapse: collapse;
  margin-top: 4px;
}

.matrix-cell {
  border: 1px solid var(--el-border-color-lighter);
  padding: 3px 8px;
  text-align: center;
  min-width: 52px;
  height: 34px;
}

.matrix-head { font-weight: 600; }

.matrix-corner { min-width: 0; width: 40px; }

.matrix-rotate div {
  writing-mode: vertical-rl;
  transform: rotate(180deg);
  font-size: 12px;
  color: var(--el-text-color-secondary);
  margin: 0 auto;
}

.matrix-mute { padding: 2px; }

.matrix-mute-head { min-width: 48px; }

.matrix-idx {
  width: 96px;
  min-width: 96px;
  max-width: 96px;
}

.matrix-src { text-align: right; }

.matrix-active { background: rgba(103, 194, 58, 0.15); }

.matrix-cell-btn { cursor: pointer; }

.cell-gain {
  font-size: 12px;
  font-variant-numeric: tabular-nums;
}

.matrix-muted .cell-muted,
.cell-muted {
  font-size: 12px;
  color: var(--el-text-color-secondary);
}

.mx-icon-mute {
  width: 16px;
  height: 16px;
  fill: currentColor;
}

.label-tag { cursor: pointer; }

.cell-disabled {
  opacity: 0.45;
  pointer-events: none;
}

.clip-tag {
  font-weight: 700;
  margin-right: 4px;
}

/* live-page addition: hover cross-highlight */
.matrix-hl,
.matrix-hl-col {
  background: var(--el-fill-color-light);
}

tr.matrix-hl-row td {
  background: var(--el-fill-color-light);
}

.matrix-active.matrix-hl {
  background: rgba(103, 194, 58, 0.35);
}

.out-edit {
  display: flex;
  align-items: center;
  gap: 6px;
}

.hint {
  color: var(--el-text-color-secondary);
  font-size: 12px;
  margin-top: 6px;
}
</style>
