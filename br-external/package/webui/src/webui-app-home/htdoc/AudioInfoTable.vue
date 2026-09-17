/*
 * AudioInfoTable -- at-a-glance audio chain block for the overview page,
 * rendered as an el-descriptions table like System/Network (PTP lock,
 * camilladsp state + rate, volume, source selection). Polls status.all +
 * mix.get (2.5 s). Tags share one style (dark, semantic color).
 */
<template>
  <el-descriptions :title="$t('AoIP')" border :column="1">
    <el-descriptions-item :label="$t('PTP')">
      <el-tag size="small" :type="ptp === null ? 'info' : (ptp ? 'success' : 'danger')">
        {{ ptp === null ? '—' : (ptp ? $t('Locked') : $t('Not locked')) }}
      </el-tag>
    </el-descriptions-item>
    <el-descriptions-item :label="$t('DSP')">
      <el-tag size="small" :type="dspState === 'Running' ? 'success' : 'info'">
        {{ dspState === null ? '—' : (dspState === 'Running' ? $t('Running') : $t('Stopped'))  }}
      </el-tag>
    </el-descriptions-item>
    <el-descriptions-item :label="$t('FS Rate')">
      {{ rate === null ? '—' : rate + ' Hz' }}
    </el-descriptions-item>
    <el-descriptions-item :label="$t('Volume')">
      {{ volume === null ? '—' : volume + ' dB' }}
    </el-descriptions-item>
    <el-descriptions-item :label="$t('Source')">
      {{ sourceLabel }}
    </el-descriptions-item>
  </el-descriptions>
</template>

<script>
const POLL_MS = 2500

export default {
  data() {
    return {
      ptp: null,
      dspState: null,
      rate: null,
      volume: null,
      source: null,
      timer: null
    }
  },
  computed: {
    sourceLabel() {
      if (this.source == null)
        return '—'
      if (this.source == 'mix')
        return this.$t('Mix (L+R)/2')
      return `${this.$t('Channel')} ${this.source}`
    }
  },
  async created() {
    await this.refresh()
    this.timer = setInterval(() => this.refresh(), POLL_MS)
  },
  unmounted() {
    clearInterval(this.timer)
  },
  methods: {
    async refresh() {
      try {
        const st = await this.$oui.call('status', 'all')
        this.ptp = st?.ptp?.locked ?? null
        this.dspState = st?.dsp?.state ?? null
        this.rate = st?.dsp?.capture_rate || null
        this.volume = (typeof st?.dsp?.volume === 'number')
          ? st.dsp.volume.toFixed(0) : null
        const settings = await this.$oui.call('dsp', 'get_settings')
        this.source = settings?.source ?? null
      } catch {
        /* keep last known values */
      }
    }
  }
}
</script>
