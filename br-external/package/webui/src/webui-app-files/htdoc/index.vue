<template>
  <div class="files-page">
    <el-alert type="info" :closable="false" show-icon
      :title="$t('Uploaded files (FIR coefficients, EQ presets) are inert until a conv filter references them (DSP > Filters).')"/>

    <el-upload
      :show-file-list="false"
      :http-request="upload"
      accept=".txt,.csv,.raw,.wav,.json,.yml,.yaml"
      style="margin: 16px 0">
      <el-button type="primary" :loading="uploading">{{ $t('Upload') }}</el-button>
    </el-upload>

    <el-table :data="files" size="small" empty-text="">
      <el-table-column prop="name" :label="$t('Name')"/>
      <el-table-column :label="$t('Size')" width="120">
        <template #default="s">{{ human(s.size) }}</template>
      </el-table-column>
      <el-table-column width="90">
        <template #default="s">
          <el-button size="small" type="danger" @click="del(s.name)">✕</el-button>
        </template>
      </el-table-column>
    </el-table>
  </div>
</template>

<script>
export default {
  data() {
    return {
      files: [],
      uploading: false
    }
  },
  async created() {
    await this.reload()
  },
  methods: {
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
      await this.$oui.call('files', 'delete', { name })
      await this.reload()
    }
  }
}
</script>

<style scoped>
.files-page { padding: 0 10px; }
</style>

<i18n src="./locale.json"/>
