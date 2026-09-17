/*
 * Overview (home) -- gauges row + audio / network / system info cards.
 * Recycles oui-app-home's gauges (as GaugeCard) and system info; the
 * WAN panels are replaced by our LAN table and the AudioInfoTable block.
 */
<template>
  <div class="row gauges">
    <GaugeCard :label="$t('CPU Usage')" :percentage="cpuUsage['cpu']" :color="cpuUsageColor">
      <div v-for="name in Object.keys(cpuUsage).sort()" :key="name">{{ name + ': ' + cpuUsage[name] + '%' }}</div>
    </GaugeCard>
    <GaugeCard :label="$t('Memory Usage')" :percentage="memUsage" :color="memUsageColor">
      <div v-for="item in memInfo" :key="item[0]">{{ $t(item[0]) + ': ' + bytesToHuman(item[1]) }}</div>
    </GaugeCard>
    <GaugeCard v-if="sysinfo && sysinfo.root" :label="$t('Storage Usage')" :percentage="storageUsage" :color="storageUsageColor">
      <div>{{ $t('Total') + ': ' + bytesToHuman(sysinfo.root.total * 1024) }}</div>
      <div>{{ $t('Used') + ': ' + bytesToHuman(sysinfo.root.used * 1024) }}</div>
    </GaugeCard>
  </div>

  <el-divider/>

  <div class="row info">
    <AudioInfoTable/>
    <NetworkInfoTable v-for="net in lanNetworks" :key="net.interface" :rows="renderNetworkInfo(net)"/>
    <SystemInfoTable :rows="renderSysinfo"/>
  </div>
</template>

<script>
import GaugeCard from './GaugeCard.vue'
import AudioInfoTable from './AudioInfoTable.vue'
import SystemInfoTable from './SystemInfoTable.vue'
import NetworkInfoTable from './NetworkInfoTable.vue'

export default {
  data() {
    return {
      cpuTimes: [],
      sysinfo: null,
      boardinfo: null,
      lanNetworks: []
    }
  },
  components: {
    GaugeCard,
    AudioInfoTable,
    SystemInfoTable,
    NetworkInfoTable
  },
  computed: {
    cpuUsage() {
      if (this.cpuTimes.length < 2)
        return {cpu: 0}

      const values = {}

      Object.keys(this.cpuTimes[0]).forEach(name => {
        values[name] = this.calcCpuUsage(this.cpuTimes[0][name], this.cpuTimes[1][name])
      })

      return values
    },
    cpuUsageColor() {
      const val = this.cpuUsage['cpu']

      if (val > 95)
        return 'maroon'
      else if (val > 80)
        return 'red'
      else if (val > 60)
        return 'orange'
      return undefined
    },
    memUsage() {
      if (!this.sysinfo)
        return 0
      const memory = this.sysinfo.memory
      return parseFloat(((memory.total - memory.free) * 100 / memory.total).toFixed(2))
    },
    memUsageColor() {
      const val = this.memUsage

      if (val > 95)
        return 'maroon'
      else if (val > 80)
        return 'red'
      else if (val > 60)
        return 'orange'
      return undefined
    },
    memInfo() {
      if (!this.sysinfo)
        return []
      const memory = this.sysinfo.memory
      return [
        ['Total', memory.total],
        ['Free', memory.free],
        ['Shared', memory.shared],
        ['Buffered', memory.buffered]
      ]
    },
    storageUsage() {
      if (!this.sysinfo || !this.sysinfo.root)
        return 0
      const root = this.sysinfo.root
      return parseFloat((root.used * 100 / root.total).toFixed(2))
    },
    storageUsageColor() {
      const val = this.storageUsage

      if (val > 95)
        return 'maroon'
      else if (val > 80)
        return 'red'
      else if (val > 60)
        return 'orange'
      return undefined
    },
    renderSysinfo() {
      if (!this.boardinfo)
        return []

      const info = [
        ['Device', this.boardinfo.model],
        ['Architecture', this.boardinfo.system],
        ['Kernel', this.boardinfo.kernel],
        ['Hostname', this.boardinfo.hostname]
      ]

      if (this.sysinfo) {
        const second = this.sysinfo.uptime
        const days = Math.floor(second / 86400)
        const hours = Math.floor((second % 86400) / 3600)
        const minutes = Math.floor(((second % 86400) % 3600) / 60)
        const seconds = Math.floor(((second % 86400) % 3600) % 60)
        info.push(['Uptime', `${days}d ${hours}h ${minutes}m ${seconds}s`])
      }

      return info
    }
  },
  created() {
    this.$timer.create('getCpuTimes', this.getCpuTimes, {repeat: true, immediate: true, time: 3000})
    this.$timer.create('getSysinfo', this.getSysinfo, {repeat: true, immediate: true, time: 3000})
    this.$timer.create('getLanNetworks', this.getLanNetworks, {repeat: true, immediate: true, time: 5000})

    this.$oui.ubus('system', 'board').then(r => {
      this.boardinfo = r
    })
  },
  methods: {
    bytesToHuman(bytes) {
      if (bytes === 0)
        return '0 B'
      const k = 1024
      const sizes = ['B', 'KB', 'MB', 'GB', 'TB']
      const i = Math.floor(Math.log(bytes) / Math.log(k))
      return (bytes / Math.pow(k, i)).toFixed(2) + ' ' + sizes[i]
    },
    secondsToHuman(second) {
      const days = Math.floor(second / 86400)
      const hours = Math.floor((second % 86400) / 3600)
      const minutes = Math.floor(((second % 86400) % 3600) / 60)
      const seconds = Math.floor(((second % 86400) % 3600) % 60)
      return `${days}d ${hours}h ${minutes}m ${seconds}s`
    },
    calcCpuUsage(times0, times1) {
      const times0CPU = times0[0] + times0[1] + times0[2]
      const times1CPU = times1[0] + times1[1] + times1[2]

      const val = (times1CPU - times0CPU) * 100.0 / ((times1CPU + times1[3]) - (times0CPU + times0[3]))

      return parseFloat(val.toFixed(2))
    },
    getCpuTimes() {
      this.$oui.call('system', 'get_cpu_time').then(({ times }) => {
        this.cpuTimes.push(times)
        if (this.cpuTimes.length === 3)
          this.cpuTimes.shift()
      })
    },
    getSysinfo() {
      this.$oui.ubus('system', 'info').then(r => {
        this.sysinfo = r
      })
    },
    getLanNetworks() {
      this.$oui.call('network', 'get_lan_networks').then(({ networks }) => {
        this.lanNetworks = networks
      })
    },
    renderNetworkInfo(net) {
      return [
        ['Protocol', net.proto],
        ['Address', (net['ipv4-address'] ?? []).map(a => a.address + '/' + a.mask)[0] ?? '—'],
        ['Gateway', (net.route ?? []).filter(r => r.target === '0.0.0.0' && r.mask === 0).map(r => r.nexthop)[0] ?? '—'],
        ['DNS', (net['dns-server'] ?? []).join(', ') || '—'],
        ['Connected', this.secondsToHuman(net.uptime)]
      ]
    }
  }
}
</script>

<style scoped>
.row { display: flex; gap: 40px; align-items: flex-start; flex-wrap: wrap; }
.row.info { gap: 20px; }
</style>

<i18n src="./locale.json"/>
