<template>
  <div class="status-page">
    <el-alert v-if="error" :title="error" type="warning" :closable="false" show-icon/>

    <el-tabs v-model="tab" @tab-change="refresh">
      <el-tab-pane :label="$t('PTP')" name="ptp">
        <el-descriptions v-if="st && st.ptp" border :column="2">
          <el-descriptions-item :label="$t('State')">
            <el-tag :type="st.ptp.locked ? 'success' : 'danger'">
              {{ st.ptp.locked ? $t('Locked') : $t('Not locked') }}
            </el-tag>
          </el-descriptions-item>
          <el-descriptions-item :label="$t('Mode')">{{ st.ptp.mode ?? '?' }}</el-descriptions-item>
          <el-descriptions-item :label="$t('PTP version')">{{ st.ptp.ptp_version }}</el-descriptions-item>
          <el-descriptions-item :label="$t('Domain')">{{ st.ptp.domain }}</el-descriptions-item>
          <el-descriptions-item :label="$t('Priority1')">{{ st.ptp.priority1 }}</el-descriptions-item>
          <el-descriptions-item :label="$t('Freq correction')">{{ freqPpm }}</el-descriptions-item>
          <el-descriptions-item :label="$t('Updates')">{{ st.ptp.updates }}</el-descriptions-item>
        </el-descriptions>
        <el-empty v-else :description="$t('ptp monitor is not answering')"/>
      </el-tab-pane>

      <el-tab-pane :label="$t('CamillaDSP')" name="dsp">
        <template v-if="st && st.dsp">
          <el-descriptions border :column="2">
            <el-descriptions-item :label="$t('State')">
              <el-tag :type="st.dsp.state === 'Running' ? 'success' : 'info'">{{ st.dsp.state }}</el-tag>
            </el-descriptions-item>
            <el-descriptions-item :label="$t('Sample rate')">{{ st.dsp.capture_rate || '—' }}</el-descriptions-item>
            <el-descriptions-item :label="$t('Processing load')">{{ st.dsp.processing_load.toFixed(1) + ' %' }}</el-descriptions-item>
            <el-descriptions-item :label="$t('Buffer level')">{{ st.dsp.buffer_level }}</el-descriptions-item>
            <el-descriptions-item :label="$t('Clipped samples')">{{ st.dsp.clipped_samples }}</el-descriptions-item>
            <el-descriptions-item :label="$t('Stop reason')">{{ st.dsp.stop_reason }}</el-descriptions-item>
            <el-descriptions-item :label="$t('Volume')">{{ typeof st.dsp.volume === 'number' ? st.dsp.volume.toFixed(1) + ' dB' : '—' }}</el-descriptions-item>
          </el-descriptions>
        </template>
        <el-empty v-else :description="$t('camilladsp is not answering')"/>
      </el-tab-pane>
    </el-tabs>
  </div>
</template>

<script>
const POLL_MS = 2000

export default {
  data() {
    return {
      tab: 'ptp',
      st: null,
      error: '',
      timer: null,
    }
  },
  computed: {
    freqPpm() {
      if (!this.st?.ptp?.freq_ppm == null)
        return '—'
      return this.st.ptp.freq_ppm.toFixed(2) + ' ppm'
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
    async refresh() {
      try {
        this.st = await this.$oui.call('status', 'all')
        this.error = ''
      } catch {
        this.error = this.$t('No data')
      }
    }
  }
}
</script>

<style scoped>
.status-page { padding: 0 10px; }
</style>

<i18n src="./locale.json"/>
