<template>
  <div class="inferno-page">
    <el-alert v-if="error" :title="error" type="error" :closable="false" show-icon/>

    <el-form v-else label-width="auto" label-suffix=":" class="inferno-form" v-loading="loading">
      <el-form-item :label="$t('Device name')">
        <el-switch v-model="form.useHostname" :active-text="$t('Follow hostname')"
          :inactive-text="$t('Override')" @change="!form.useHostname && $refs.nameInput?.focus()"/>
        <el-input v-if="!form.useHostname" ref="nameInput" v-model="form.name"
          class="name-input" :placeholder="hostname" maxlength="64"
          :disabled="form.useHostname"/>
        <div v-else class="hint">{{ $t('Advertising as') }}: <b>{{ hostname }}</b></div>
      </el-form-item>

      <el-form-item :label="$t('Interface')">
        <el-select v-model="form.interface" :disabled="!form.interfaces.length">
          <el-option v-for="i in form.interfaces" :key="i" :label="i" :value="i"/>
        </el-select>
        <div class="hint">{{ $t('The network interface the AoIP stack binds to.') }}</div>
      </el-form-item>
    </el-form>

    <el-divider/>
    <div class="save-row">
      <el-button type="primary" :loading="saving" @click="save">{{ $t('Save & Apply') }}</el-button>
      <span class="hint">{{ $t('Applying restarts the audio DSP.') }}</span>
    </div>
  </div>
</template>

<script>
export default {
  data() {
    return {
      loading: true,
      saving: false,
      error: '',
      hostname: '',
      form: { useHostname: true, name: '', interface: '', interfaces: [] }
    }
  },
  async created() {
    try {
      const r = await this.$oui.call('inferno', 'get')
      this.form = {
        useHostname: !!r?.use_hostname,
        name: r?.name ?? '',
        interface: r?.interface ?? '',
        interfaces: r?.interfaces ?? []
      }
      this.hostname = r?.hostname ?? ''
    } catch (e) {
      this.error = String(e)
    }
    this.loading = false
  },
  methods: {
    async save() {
      const name = this.form.useHostname ? '' : this.form.name.trim()
      if (!this.form.useHostname && !name)
        return this.$message.error(this.$t('Name required when the override is enabled'))
      this.saving = true
      try {
        const r = await this.$oui.call('inferno', 'save', {
          name, interface: this.form.interface, apply: true
        })
        if (r?.error)
          this.$message.error(r.error.message)
        else
          this.$message.success(this.$t('Configuration has been applied'))
      } catch (e) {
        this.$message.error(String(e))
      }
      this.saving = false
    }
  }
}
</script>

<style scoped>
.inferno-page { padding: 0 10px; }
.inferno-form { max-width: 560px; }
.name-input { width: 260px; margin-left: 12px; }
.hint { color: #888; font-size: 12px; margin-top: 4px; }
.save-row { display: flex; align-items: center; gap: 12px; margin: 12px 0; }
</style>

<i18n src="./locale.json"/>
