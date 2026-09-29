<template>
  <div class="files-page">
    <el-alert type="info" :closable="false" show-icon
      :title="$t('Profiles are YAML presets of the editable filter blocks. Applying replaces the stored UCI configuration (Save-to-UCI semantics) or the live DSP config of those blocks. Topology follows the policy: mixers and locked blocks are never touched. Other files (FIR coefficients) stay inert until a conv filter references them.')"/>

    <div class="toolbar">
      <el-upload :show-file-list="false" :http-request="upload"
        accept=".txt,.csv,.raw,.wav,.json,.yml,.yaml">
        <el-button type="primary" plain :loading="uploading">{{ $t('Upload') }}</el-button>
      </el-upload>

      <el-input v-model="newName" :placeholder="$t('my-eq.yml')"
        class="name-input" size="default" clearable/>
      <el-button type="primary" :loading="saving" @click="saveProfile">
        {{ $t('Save current as profile') }}
      </el-button>
    </div>

    <el-table :data="files" size="small" empty-text="">
      <el-table-column prop="name" :label="$t('Name')"/>
      <el-table-column :label="$t('Size')" width="110">
        <template #default="{ row }">{{ human(row.size) }}</template>
      </el-table-column>
      <el-table-column :label="$t('Actions')" width="330">
        <template #default="{ row }">
          <template v-if="isProfile(row.name)">
            <el-button size="small" type="primary" :loading="applying === row.name"
              @click="applyUci(row.name)">{{ $t('Apply (UCI)') }}</el-button>
            <el-button size="small" type="success" :loading="applying === row.name"
              @click="applyLive(row.name)">{{ $t('Apply (live)') }}</el-button>
            <el-button size="small" @click="download(row.name)">{{ $t('Download') }}</el-button>
          </template>
          <el-button size="small" type="danger" @click="del(row.name)">✕</el-button>
        </template>
      </el-table-column>
    </el-table>
  </div>
</template>

<script>
import yaml from 'js-yaml'

/* uci filter -> camilladsp filter, mirroring camilladsp-genconf's
 * render_filter (the allow-listed child types). Keep in sync with it. */
function uciToCamilla(f) {
  const num = (v, d) => (v == null || v === '' ? d : Number(v))
  switch (f.type) {
    case 'peak':
      return { type: 'Biquad', parameters: { type: 'Peaking', freq: num(f.f), gain: num(f.gain), q: num(f.q, 1.0) } }
    case 'hs':
    case 'ls':
      return { type: 'Biquad', parameters: {
        type: f.type === 'hs' ? 'Highshelf' : 'Lowshelf',
        freq: num(f.f), gain: num(f.gain),
        ...(f.slope != null ? { slope: f.slope } : { q: num(f.q, 0.707) })
      } }
    case 'notch':
    case 'ap':
      return { type: 'Biquad', parameters: {
        type: f.type === 'notch' ? 'Notch' : 'Allpass',
        freq: num(f.f), q: num(f.q, 0.707)
      } }
    case 'gain':
      return { type: 'Gain', parameters: { gain: num(f.gain) } }
    case 'conv':
      return { type: 'Conv', parameters: { type: 'Raw', format: 'TEXT', filename: f.filename } }
    default:
      throw new Error(`unsupported filter type: ${f.type}`)
  }
}

export default {
  data() {
    return {
      files: [],
      uploading: false,
      saving: false,
      applying: '',
      newName: ''
    }
  },
  async created() {
    await this.reload()
  },
  methods: {
    isProfile(name) {
      return /\.ya?ml$/i.test(name)
    },
    async reload() {
      const r = await this.$oui.call('files', 'list')
      this.files = r?.files ?? []
    },
    human(n) {
      if (n > 1048576) return (n / 1048576).toFixed(1) + ' MB'
      if (n > 1024) return (n / 1024).toFixed(1) + ' KB'
      return n + ' B'
    },
    async upload(req) {
      this.uploading = true
      const fd = new FormData()
      fd.append('file', req.file, req.file.name)
      try {
        const r = await fetch('/oui-upload', { method: 'POST', body: fd })
        const j = await r.json()
        if (j?.result?.saved?.length)
          this.$message.success(j.result.saved.map(s => s.name).join(', '))
        else if (j?.result?.errors?.length)
          this.$message.error(j.result.errors.join('; '))
        await this.reload()
      } catch (e) {
        this.$message.error(String(e))
      }
      this.uploading = false
    },
    async del(name) {
      try {
        await this.$confirm(
          this.$t('Delete profile "{name}"? This cannot be undone.', { name }),
          this.$t('Delete'),
          { type: 'warning', confirmButtonText: this.$t('Delete'), cancelButtonText: this.$t('Cancel') }
        )
      } catch { return /* dismissed */ }
      try {
        await this.$oui.call('files', 'delete', { name })
        await this.reload()
      } catch (e) {
        this.$message.error(this.$t('Update failed') + (e?.message ? `: ${e.message}` : ''))
      }
    },
    async fetchDoc(name) {
      const r = await this.$oui.call('files', 'read', { name })
      if (r?.error)
        throw new Error(r.error.message)
      const doc = yaml.load(r.content)
      if (!doc || typeof doc !== 'object' || typeof doc.blocks !== 'object' || doc.blocks == null)
        throw new Error(this.$t('Not a profile: expected a "blocks:" mapping'))
      for (const list of Object.values(doc.blocks))
        if (!Array.isArray(list))
          throw new Error(this.$t('Not a profile: "blocks:" values must be lists'))
      return doc.blocks
    },
    /* editable slots per the policy schema */
    async editableSlots() {
      const schema = await this.$oui.call('dsp', 'get_saved_filters')
      return schema?.editable ?? {}
    },
    /* Apply = REPLACE every editable slot: slots missing from the profile
     * are cleared. Locked/unknown slots in the profile are refused. */
    async applyUci(name) {
      this.applying = name
      try {
        const blocks = await this.fetchDoc(name)
        const editable = await this.editableSlots()
        const unknown = Object.keys(blocks).filter(k => !editable[k])
        if (unknown.length)
          throw new Error(this.$t('Not an editable slot: {slots}', { slots: unknown.join(', ') }))
        const steps = {}
        for (const slot of Object.keys(editable))
          steps[slot] = blocks[slot] ?? []
        const r = await this.$oui.call('dsp', 'save_filters', { steps })
        if (r?.error)
          this.$message.error(r.error.message)
        else
          this.$message.success(this.$t('Profile applied to UCI'))
      } catch (e) {
        this.$message.error(String(e.message ?? e))
      }
      this.applying = ''
    },
    /* Live: swap the user (u_*) filters of every editable block in the
     * running config via SetConfigJson. Topology untouched. */
    async applyLive(name) {
      this.applying = name
      let ws = null
      try {
        const blocks = await this.fetchDoc(name)
        const stages = (await this.$oui.call('dsp', 'get_pipeline'))?.stages ?? []
        const editable = stages.filter(s => s.kind === 'editable' && s.label)
        const unknown = Object.keys(blocks).filter(k => !editable.some(s => s.label === k))
        if (unknown.length)
          throw new Error(this.$t('Not an editable slot: {slots}', { slots: unknown.join(', ') }))
        /* policy sanity: the profile must not change topology -- it only
         * can't (blocks carry filter lists, nothing else) */

        const proto = location.protocol === 'https:' ? 'wss:' : 'ws:'
        ws = new WebSocket(`${proto}//${location.host}/ws`)
        await new Promise((res, rej) => {
          ws.onopen = res
          ws.onerror = () => rej(new Error(this.$t('CamillaDSP websocket connection failed')))
        })
        const request = (command, value) => new Promise((res, rej) => {
          const to = setTimeout(() => rej(new Error(this.$t('{command} timed out', { command }))), 5000)
          const onMessage = event => {
            clearTimeout(to)
            ws.removeEventListener('message', onMessage)
            const reply = JSON.parse(event.data)
            const body = reply[Object.keys(reply)[0]]
            body?.result === 'Ok' ? res(body.value) : rej(body?.value ?? new Error(this.$t('{command} failed', { command })))
          }
          ws.addEventListener('message', onMessage)
          ws.send(JSON.stringify(value === undefined ? command : { [command]: value }))
        })

        const raw = await request('GetConfigJson')
        const cfg = typeof raw === 'string' ? JSON.parse(raw) : raw
        for (const stage of editable) {
          const list = blocks[stage.label] ?? []
          const step = cfg.pipeline[stage.index]
          if (!step || step.type !== 'Filter')
            continue
          /* keep every non-webui filter (the board-shipped base gains and
           * locked tails): only the u_* content is replaced (topology is
           * locked) */
          const keep = (step.names ?? []).filter(n => !n.startsWith('u_'))
          for (const old of step.names ?? [])
            if (old.startsWith('u_'))
              delete cfg.filters[old]
          const names = []
          let i = 0
          for (const f of list) {
            i++
            const fname = `u_${stage.label}_${i}`
            cfg.filters[fname] = uciToCamilla(f)
            names.push(fname)
          }
          step.names = [...keep, ...names]
        }
        await request('SetConfigJson', JSON.stringify(cfg))
        this.$message.success(this.$t('Profile applied live'))
      } catch (e) {
        this.$message.error(String(e.message ?? e))
      }
      ws?.close()
      this.applying = ''
    },
    async download(name) {
      try {
        const r = await this.$oui.call('files', 'read', { name })
        if (r?.error)
          throw new Error(r.error.message)
        const url = URL.createObjectURL(new Blob([r.content], { type: 'text/yaml' }))
        const a = document.createElement('a')
        a.href = url
        a.download = name
        a.click()
        URL.revokeObjectURL(url)
      } catch (e) {
        this.$message.error(String(e.message ?? e))
      }
    },
    async saveProfile() {
      let name = this.newName.trim().replace(/[^a-zA-Z0-9._-]/g, '')
      if (!name)
        return this.$message.error(this.$t('Profile name required'))
      if (!/\.ya?ml$/i.test(name))
        name += '.yml'
      this.saving = true
      try {
        const schema = await this.$oui.call('dsp', 'get_saved_filters')
        const editable = schema?.editable ?? {}
        const blocks = {}
        for (const [slot, def] of Object.entries(editable))
          blocks[slot] = (def.filters ?? []).map(f => {
            const { name, ...params } = f
            return params
          })
        const content = yaml.dump({ version: 1, blocks }, { lineWidth: 120 })
        const r = await this.$oui.call('files', 'write', { name, content })
        if (r?.error)
          throw new Error(r.error.message)
        this.$message.success(this.$t('Profile saved'))
        this.newName = ''
        await this.reload()
      } catch (e) {
        this.$message.error(String(e.message ?? e))
      }
      this.saving = false
    }
  }
}
</script>

<style scoped>
.files-page { padding: 0 10px; }
.toolbar { display: flex; gap: 12px; align-items: center; margin: 16px 0; flex-wrap: wrap; }
.name-input { width: 240px; }
</style>

<i18n src="./locale.json"/>
