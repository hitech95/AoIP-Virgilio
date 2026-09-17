/* Logs (/status/logs): RAM ring buffer tail via webuid's logs.read,
 * refreshed every 2 s while visible. */
<template>
  <div class="logs-page">
    <div class="toolbar">
      <el-button size="small" @click="refresh">{{ $t('Refresh') }}</el-button>
      <el-checkbox v-model="follow">{{ $t('Follow') }}</el-checkbox>
    </div>
    <div class="logs mono">{{ logs || $t('No data') }}</div>
  </div>
</template>

<script>
const POLL_MS = 2000

export default {
  data() {
    return {
      logs: '',
      follow: true,
      timer: null
    }
  },
  created() {
    this.refresh()
    this.timer = setInterval(() => {
      if (this.follow)
        this.refresh()
    }, POLL_MS)
  },
  unmounted() {
    clearInterval(this.timer)
  },
  methods: {
    async refresh() {
      this.logs = (await this.$oui.call('logs', 'read', { n: 300 })) ?? ''
    }
  }
}
</script>

<style scoped>
.logs-page { padding: 0 10px; }
.toolbar { margin-bottom: 8px; display: flex; gap: 16px; align-items: center; }
.logs { background: #1e1e1e; color: #d4d4d4; border-radius: 4px; padding: 12px;
        max-height: 70vh; overflow: auto; white-space: pre; font-size: 12px; }
.mono { font-family: ui-monospace, 'Cascadia Mono', 'Source Code Pro', Menlo, Consolas, monospace; }
</style>

<i18n src="./locale.json"/>
