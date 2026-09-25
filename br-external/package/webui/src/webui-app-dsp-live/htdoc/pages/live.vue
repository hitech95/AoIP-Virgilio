<template>
  <section class="live-page">
    <!-- Split header: tab selector left, active-tab toolbar (teleported)
         + connection state right -->
    <header class="live-head">
      <div class="live-tabs" role="tablist">
        <button v-for="t in tabs" :key="t.id" type="button" role="tab"
          class="live-tab" :class="{ active: tab === t.id }"
          :aria-selected="tab === t.id" @click="tab = t.id">{{ t.label }}</button>
      </div>
      <div id="live-toolbar" class="live-toolbar"><!-- teleported by the tabs --></div>
      <!-- ONE save for the whole page: persists the live edits of every
           editable slot + the policy-exposed mixer route gains to UCI -->
      <el-button type="primary" :loading="saving" :disabled="!connected"
        :title="$t('Persist the live edits of every editable block (and mixer route gains) to UCI')"
        class="page-save" @click="saveAll">{{ $t('Save') }}</el-button>
      <el-tag :type="connected ? 'success' : 'danger'" class="conn-tag">
        {{ connected ? $t('Connected') : $t('Offline') }}
      </el-tag>
    </header>

    <!-- Both tabs stay mounted (state + teleports survive switches);
         visibility is toggled inside each tab through its active prop -->
    <div class="live-body">
      <EqTab :active="tab === 'eq'" />
      <VolumeTab :active="tab === 'volume'" />
      <AdvancedTab :active="tab === 'advanced'" />
    </div>
  </section>
</template>

<script>
import EqTab from '../components/tabs/EqTab.vue'
import VolumeTab from '../components/tabs/VolumeTab.vue'
import AdvancedTab from '../components/tabs/AdvancedTab.vue'
import * as dsp from '../dsp'
import { eq, flushLiveEdits } from '../stores/eqStore'
import { liveDefToUci } from '../lib/liveToUci'

/* Live page: EQ + Advanced (former pipeline) tabs over ONE camilladsp
 * websocket (dsp.ts singleton). This page owns the connection, the OUI
 * session guard, the upload-error surfacing and the connection tag; the
 * tabs own their content and teleports their toolbar into the header. */
export default {
  name: 'LivePage',
  components: { EqTab, VolumeTab, AdvancedTab },
  data() {
    return {
      tab: 'eq',
      saving: false
    }
  },
  computed: {
    tabs() {
      return [
        { id: 'eq', label: this.$t('EQ') },
        { id: 'volume', label: this.$t('Volume') },
        { id: 'advanced', label: this.$t('Advanced') }
      ]
    },
    connected() { return dsp.connectionState.value === 'connected' }
  },
  mounted() {
    dsp.connect()

    // Surface upload errors as toasts regardless of the active tab
    this._stopUpload = this.$watch(
      () => eq.uploadStatus,
      (status) => {
        if (status?.state === 'error') {
          this.$message?.error?.(
            this.$t('Upload failed') + (status.message ? `: ${status.message}` : ''))
        }
      },
      { deep: true }
    )

    // Session guard: bounce to login when the Oui session expires
    this._sessionTimer = setInterval(() => {
      void (async () => {
        const alive = await this.$oui.isAlived()
        if (alive) return
        this.$router.replace('/login')
      })()
    }, 5000)

    // Development-only live reload (see scripts/webui/; keep the eq-dev
    // query name for continuity with the existing tooling)
    if (new URLSearchParams(window.location.search).has('eq-dev')) {
      let version = null
      this._devReloadTimer = setInterval(() => {
        void fetch(`/views/live.version?_=${Date.now()}`, { cache: 'no-store' })
          .then((response) => (response.ok ? response.text() : null))
          .then((nextVersion) => {
            if (!nextVersion) return
            if (version !== null && version !== nextVersion) {
              window.location.reload()
              return
            }
            version = nextVersion
          })
          .catch(() => { })
      }, 1000)
    }
  },
  methods: {
    /* page-level Save: commit pending EQ edits, then persist every
     * editable slot's user filters + the user_gains mixer route gains
     * (both RPCs run the daemon's genconf dry-run + reload txn) */
    async saveAll() {
      this.saving = true
      try {
        await flushLiveEdits()

        let cfg = dsp.config.value
        if (!cfg) cfg = await dsp.downloadConfig()
        if (!cfg) throw new Error(this.$t('Offline'))

        const stages = (await this.$oui.call('dsp', 'get_pipeline'))?.stages ?? []
        const schema = await this.$oui.call('dsp', 'get_saved_filters').catch(() => null)

        const steps = {}
        for (const stage of stages) {
          if (stage.kind !== 'editable') continue
          const step = cfg.pipeline?.[stage.index]
          if (!step || step.type !== 'Filter') continue
          const filters = []
          for (const name of (step.names ?? [])) {
            if (name.startsWith('user_slot_')) continue
            const u = liveDefToUci(cfg.filters?.[name])
            if (u) filters.push(u)
          }
          steps[stage.label] = filters
        }
        if (Object.keys(steps).length) {
          const r = await this.$oui.call('dsp', 'save_filters', { steps })
          if (r?.error) throw new Error(r.error.message)
        }

        // user_gains mixers: live route gains (uci gains are LINEAR)
        for (const mixer of (schema?.user_gains ?? [])) {
          const live = cfg.mixers?.[mixer]
          if (!live?.mapping) continue
          const routes = []
          for (const d of live.mapping)
            for (const s of (d.sources ?? []))
              routes.push({
                dest: d.dest, source: s.channel,
                gain: (s.scale === 'linear') ? Number(s.gain) : Math.pow(10, (Number(s.gain) || 0) / 20),
                mute: s.mute ? 1 : 0
              })
          if (routes.length) {
            const r = await this.$oui.call('dsp', 'save_mixer', { mixer, routes })
            if (r?.error) throw new Error(r.error.message)
          }
        }

        // refresh the shared config (the daemon reloaded camilladsp)
        const fresh = await dsp.downloadConfig().catch(() => null)
        if (fresh) cfg = fresh
        this.$message.success(this.$t('Saved live edits to UCI'))
      } catch (e) {
        this.$message.error(this.$t('Update failed') + (e?.message ? `: ${e.message}` : ''))
      } finally {
        this.saving = false
      }
    },
  },
  beforeUnmount() {
    this._stopUpload?.()
    clearInterval(this._sessionTimer)
    clearInterval(this._devReloadTimer)
    dsp.disconnect()
  },
}
</script>

<i18n src="../locale.json"/>

<style scoped>
.live-page {
  display: flex;
  flex-direction: column;
  min-height: 0;
}

.live-head {
  display: flex;
  align-items: center;
  gap: 16px;
  flex-wrap: wrap;
  padding: 6px 0;
  border-bottom: 1px solid var(--el-border-color);
}

.live-tabs {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 3px;
  border-radius: 8px;
  background: var(--el-fill-color-light);
}

.live-tab {
  appearance: none;
  border: 0;
  background: transparent;
  color: var(--el-text-color-regular);
  font: inherit;
  font-weight: 500;
  line-height: 1;
  padding: 7px 16px;
  border-radius: 6px;
  cursor: pointer;
  white-space: nowrap;
}

.live-tab:hover {
  color: var(--el-color-primary);
}

.live-tab.active {
  background: var(--el-bg-color);
  color: var(--el-color-primary);
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.12);
}

.live-toolbar {
  flex: 1;
  min-width: 0;
  display: flex;
  align-items: center;
  justify-content: flex-end;
  overflow: hidden;
}

.page-save {
  flex-shrink: 0;
}

.conn-tag {
  flex-shrink: 0;
}

.live-body {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
}
</style>
