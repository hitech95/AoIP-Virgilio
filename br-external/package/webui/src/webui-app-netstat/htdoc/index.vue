/*
 * Network status (/status/network): management LAN interface state via
 * webuid's network.get_lan_networks (ubus lan status), 3 s refresh.
 */
<template>
  <div class="netstat-page">
    <el-alert v-if="error" :title="error" type="warning" :closable="false" show-icon/>

    <el-descriptions v-for="net in networks" :key="net.interface"
                     :title="$t('Management LAN') + ' (' + net.l3_device + ')'" border :column="2">
      <el-descriptions-item :label="$t('State')">
        <el-tag :type="net.up ? 'success' : 'danger'">
          {{ net.up ? $t('Up') : $t('Down') }}
        </el-tag>
      </el-descriptions-item>
      <el-descriptions-item :label="$t('Protocol')">{{ net.proto }}</el-descriptions-item>
      <el-descriptions-item :label="$t('Address')">
        {{ (net['ipv4-address'] ?? []).map(a => a.address + '/' + a.mask).join(', ') || '—' }}
      </el-descriptions-item>
      <el-descriptions-item :label="$t('Gateway')">
        {{ (net.route ?? []).filter(r => r.target === '0.0.0.0' && r.mask === 0).map(r => r.nexthop).join(', ') || '—' }}
      </el-descriptions-item>
      <el-descriptions-item :label="$t('DNS')">{{ (net['dns-server'] ?? []).join(', ') || '—' }}</el-descriptions-item>
      <el-descriptions-item :label="$t('Connected')">{{ secondsToHuman(net.uptime) }}</el-descriptions-item>
    </el-descriptions>

    <el-empty v-if="!networks.length && !error" :description="$t('No data')"/>
  </div>
</template>

<script>
const POLL_MS = 3000

export default {
  data() {
    return {
      networks: [],
      error: '',
      timer: null
    }
  },
  created() {
    this.refresh()
    this.timer = setInterval(() => this.refresh(), POLL_MS)
  },
  unmounted() {
    clearInterval(this.timer)
  },
  methods: {
    secondsToHuman(second) {
      const days = Math.floor(second / 86400)
      const hours = Math.floor((second % 86400) / 3600)
      const minutes = Math.floor(((second % 86400) % 3600) / 60)
      return `${days}d ${hours}h ${minutes}m`
    },
    async refresh() {
      try {
        const r = await this.$oui.call('network', 'get_lan_networks')
        this.networks = r?.networks ?? []
        this.error = ''
      } catch {
        this.error = this.$t('No data')
      }
    }
  }
}
</script>

<style scoped>
.netstat-page { padding: 0 10px; }
</style>

<i18n src="./locale.json"/>
