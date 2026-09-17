<template>
  <el-alert type="warning" :closable="false" show-icon
            :title="$t('Changing these settings can lock you out of the web UI. Double-check the address before applying.')"/>
  <el-form ref="form" size="large" label-width="auto" label-suffix=":" :model="form" style="margin-top: 16px; max-width: 560px">
    <el-form-item :label="$t('Interface')">
      <el-input value="lan (eth0)" disabled/>
    </el-form-item>
    <el-form-item :label="$t('Protocol')">
      <el-radio-group v-model="form.proto">
        <el-radio-button label="dhcp">DHCP</el-radio-button>
        <el-radio-button label="static">{{ $t('Static') }}</el-radio-button>
      </el-radio-group>
    </el-form-item>
    <template v-if="form.proto === 'static'">
      <el-form-item :label="$t('IP address')">
        <el-input v-model="form.ipaddr" placeholder="192.168.1.100"/>
      </el-form-item>
      <el-form-item :label="$t('Netmask')">
        <el-input v-model="form.netmask" placeholder="255.255.255.0"/>
      </el-form-item>
      <el-form-item :label="$t('Gateway')">
        <el-input v-model="form.gateway" placeholder="192.168.1.1"/>
      </el-form-item>
      <el-form-item :label="$t('DNS')">
        <el-input v-model="form.dns" :placeholder="$t('optional, space separated')"/>
      </el-form-item>
    </template>
  </el-form>

  <el-divider/>
  <div style="text-align: right; padding-right: 100px">
    <el-button type="primary" :loading="loading" @click="save">{{ $t('Save & Apply') }}</el-button>
  </div>
</template>

<script>
export default {
  data() {
    return {
      loading: false,
      form: {
        proto: 'dhcp',
        ipaddr: '',
        netmask: '255.255.255.0',
        gateway: '',
        dns: ''
      }
    }
  },
  async created() {
    const lan = await this.$oui.call('uci', 'load', { config: 'network' })
    const s = lan?.lan ?? {}
    this.form.proto = s.proto ?? 'dhcp'
    this.form.ipaddr = s.ipaddr ?? ''
    this.form.netmask = s.netmask ?? '255.255.255.0'
    this.form.gateway = s.gateway ?? ''
    this.form.dns = Array.isArray(s.dns) ? s.dns.join(' ') : (s.dns ?? '')
  },
  methods: {
    async save() {
      this.loading = true
      try {
        const values = { proto: this.form.proto }
        if (this.form.proto === 'static') {
          values.ipaddr = this.form.ipaddr
          values.netmask = this.form.netmask
          if (this.form.gateway)
            values.gateway = this.form.gateway
          if (this.form.dns)
            values.dns = this.form.dns.split(/\s+/)
        }

        /* wipe stale static options when switching back to dhcp */
        const del = ['ipaddr', 'netmask', 'gateway', 'dns']
          .filter(k => !(k in values))

        await this.$oui.call('uci', 'set', { config: 'network', section: 'lan', values })
        await this.$oui.call('uci', 'delete', { config: 'network', section: 'lan', options: del })

        /* netifd re-reads the config without dropping the link */
        await this.$oui.ubus('network', 'reload')

        this.$message.success(this.$t('Configuration has been applied'))
      } catch {
        this.$message.error(this.$t('Failed to apply'))
      }
      this.loading = false
    }
  }
}
</script>

<i18n src="./locale.json"/>
