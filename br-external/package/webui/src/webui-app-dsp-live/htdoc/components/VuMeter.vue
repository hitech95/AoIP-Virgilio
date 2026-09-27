<template>
  <!-- Vertical VU meters (camillagui scale): one column per channel,
       RMS fill bottom-up + peak line, piecewise dB scale with shared
       tick labels, gradient colored by level, red peak when clipped
       (> 0 dBFS). levels/peaks: per-channel dBFS (0 dB = full scale).
       height: px number, or '100%' to fill the parent box (fluid). -->
  <div class="vu-vertical" :class="{ 'is-fluid': trackH === '100%' }"
    :style="trackH === '100%' ? {} : { height: trackH }">
    <div v-if="title" class="vu-title">{{ title }}</div>
    <div class="vu-body">
      <!-- shared dB scale column (tick label + notch per mark) -->
      <div class="vu-scale">
        <span v-for="m in ticks" :key="m" class="vu-scale-tick"
          :style="{ bottom: pct(m) + '%' }">{{ m }}</span>
      </div>
      <div class="vu-channels">
        <div v-for="ch in shown" :key="ch" class="vu-channel">
          <div class="vu-track">
            <div class="vu-fill" :style="{ height: pct(rmsOf(ch)) + '%' }" />
            <div class="vu-peak" :class="{ clipped: peakOf(ch) > 0 }"
              :style="{ bottom: pct(peakOf(ch)) + '%' }" />
            <span class="vu-zero" :style="{ bottom: pct(0) + '%' }" />
          </div>
          <span class="vu-ch-label" :title="label(ch)">{{ label(ch) }}</span>
        </div>
      </div>
    </div>
  </div>
</template>

<script lang="ts">
/* dB tick marks (camillagui set, +6..-72) */
const TICKS = [6, 0, -6, -12, -24, -48, -72]

/**
 * dBFS -> percent, piecewise linear (camillagui): 24 dB/div low,
 * 12 dB/div mid, 6 dB/div high. -108 dB -> 0%, +9 dB -> 100%.
 */
export function levelAsPercent(dbfs: number): number {
  const db = Number.isFinite(dbfs) ? dbfs : -108
  let value
  if (db >= -12) value = 81.25 + (12.5 * db) / 6
  else if (db >= -24) value = 68.75 + (12.5 * db) / 12
  else value = 56.25 + (12.5 * db) / 24
  return Math.max(0, Math.min(100, value))
}

export default {
  name: 'VuMeter',
  props: {
    title: { type: String, default: '' },
    /* per-channel RMS levels (dBFS) of the whole side */
    levels: { type: Array, default: () => [] },
    /* per-channel peak levels (dBFS) of the whole side */
    peaks: { type: Array, default: () => [] },
    /* restrict to these channel indices */
    channels: { type: Array, default: null },
    /* human labels per channel index */
    labels: { type: Array, default: () => [] },
    /* track height: px number, or '100%' (fill the parent box) */
    height: { type: [Number, String], default: 200 }
  },
  computed: {
    ticks() { return TICKS },
    trackH() { return typeof this.height === 'number' ? `${this.height}px` : this.height },
    shown() {
      const n = this.levels.length
      if (!n) return []
      return this.channels ?? Array.from({ length: n }, (_, i) => i)
    }
  },
  methods: {
    pct(db) { return levelAsPercent(db) },
    rmsOf(ch) { return Number(this.levels[ch]) },
    peakOf(ch) { return Number(this.peaks[ch]) },
    label(ch) { return (this.labels[ch] ?? '').trim() || String(ch) }
  }
}
</script>

<style scoped lang="scss">
.vu-vertical {
  display: inline-flex;
  flex-direction: column;
  gap: 4px;

  &.is-fluid {
    height: 100%;
    align-self: stretch;

    .vu-body,
    .vu-channels,
    .vu-channel {
      height: 100%;
    }

    .vu-body {
      flex: 1;
      min-height: 0;
    }

    .vu-track {
      flex: 1;
      min-height: 0;
    }
  }

  /* shared dB scale: labels at their scale position */
  .vu-scale {
    position: relative;
    width: 40px;
    flex-shrink: 0;
  }

  .vu-scale-tick {
    position: absolute;
    transform: translateY(50%);
    right: 4px;
    font-size: var(--el-font-size-base);
    line-height: 1;
    color: var(--el-text-color-secondary);
  }

  .vu-track {
    flex: 1;
    min-height: 0;
  }
}

.vu-title {
  font-size: var(--el-font-size-base);
  font-weight: 600;
  color: var(--el-text-color-regular);
  text-align: center;
}

.vu-body {
  display: flex;
  gap: 6px;
  align-items: stretch;
}

.vu-channels {
  display: flex;
  gap: 6px;
}

.vu-channel {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 3px;
}

.vu-track {
  position: relative;
  width: 16px;
  border-radius: 3px;
  background: var(--el-fill-color-darker, #2a2f36);
  overflow: hidden;
}

/* gradient REVEALED by the fill height: the color at the bar top is
 * the color of the level it is showing (green -> amber -> red) */
.vu-fill {
  position: absolute;
  left: 0;
  right: 0;
  bottom: 0;
  background: linear-gradient(to top,
    #35a06a 0%,
    #43b97c 55%,
    #8fce5a 72%,
    #e6b23c 84%,
    #e0812f 92%,
    #d9513c 97%,
    #d9513c 100%);
  transition: height 90ms linear;
}

/* peak-hold line: dark, red when clipped */
.vu-peak {
  position: absolute;
  left: 0;
  right: 0;
  height: 2px;
  margin-bottom: -1px;
  background: var(--el-text-color-primary);
  box-shadow: 0 0 0 1px rgba(0, 0, 0, 0.25);

  &.clipped {
    background: #d93a3a;
  }
}

/* 0 dBFS line through the bar */
.vu-zero {
  position: absolute;
  left: 0;
  right: 0;
  height: 1px;
  background: var(--el-text-color-secondary);
  opacity: 0.6;
}

.vu-ch-label {
  font-size: var(--el-font-size-base);
  color: var(--el-text-color-secondary);
  max-width: 48px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
</style>