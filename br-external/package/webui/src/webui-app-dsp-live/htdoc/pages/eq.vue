<template>
  <el-container ref="pageEl" class="eq-page" :style="{ '--eq-page-h': pageHeight }">

    <el-alert v-if="error" type="error" :title="error" :closable="false" show-icon class="eq-alert" />

    <el-header height="auto" class="toolbar">
      <!-- Filter block selector: edits apply to ONE pipeline block at a time.
           The save button lives here so the block context and its persistence
           are one control group. -->
      <el-space>
        <el-icon class="icon" :size="18">
          <Filter />
        </el-icon>
        <span class="title">{{ $t('Filter Block') }}</span>
        <el-select class="select" v-model="selectedStep" :disabled="!eq.steps.length"
          popper-class="eq-block-dd"
          :placeholder="eq.steps.length ? $t('Select a filter block') : $t('No editable blocks')">
          <!-- selected rendering: name left + chips right, justified like
               the option rows (the wrapper is stretched in the scoped CSS).
               Colors: filter count = primary, channel chips = success. -->
          <template #label="{ label }">
            <span class="sel-name">{{ label }}</span>
            <span class="sel-tags">
              <el-tag v-if="selectedStepInfo" size="small" type="primary" effect="light" class="sel-chip">
                {{ selectedStepInfo.names.length }} {{ $t('filters') }}
              </el-tag>
              <el-tag v-for="c in (selectedStepInfo?.channels ?? [])" :key="c" size="small"
                type="success" effect="light" class="sel-chip">ch {{ c }}</el-tag>
            </span>
          </template>
          <el-option v-for="s in eq.steps" :key="s.index" :value="s.index" :label="stepName(s)">
            <div class="opt-row">
              <span class="opt-name">{{ stepName(s) }}</span>
              <span class="opt-tags">
                <el-tag size="small" type="primary" effect="light">{{ s.names.length }} {{ $t('filters') }}</el-tag>
                <el-tag v-for="c in s.channels" :key="c" size="small" type="success" effect="light">ch {{ c }}</el-tag>
              </span>
            </div>
          </el-option>
        </el-select>

        <el-button
          type="primary"
          plain
          :disabled="!canAddBand"
          :title="$t('Add a new EQ band to this block')"
          @click="doAddBand"
        >
          {{ $t('Add band') }}
        </el-button>

        <el-button
          type="primary"
          plain
          :loading="savingToUci"
          :disabled="eq.selectedStepIndex === null"
          :title="$t('Persist the selected block\'s live filters to UCI')"
          @click="saveToUci"
        >
          {{ $t('Save to UCI') }}
        </el-button>
      </el-space>

      <el-space>
        <el-tag v-if="policyTag" :type="policyTag.type" class="policy-tag">
          {{ policyTag.text }}
        </el-tag>
        <el-tag :type="connected ? 'success' : 'danger'">
          {{ connected ? $t('Connected') : $t('Offline') }}
        </el-tag>
      </el-space>
    </el-header>

    <el-container class="body">

      <!-- Chart sidebar: response and visualization controls -->
      <el-aside width="68%" class="chart-aside">
        <EqPlotCard />
        <section class="visual-options" aria-label="Visualization options">
          <VizOptionsBar />
        </section>
      </el-aside>

      <!-- Filter main: preamp + one card per EQ band of the selected block -->
      <el-main class="filters-container">
        <div class="bands-col" @wheel="scrollBandRail">
          <template v-if="eq.selectedStepIndex !== null">
            <PreampCard :read-only="selectedLocked" />
            <BandCard v-for="(b, i) in eq.bands" :key="`${eq.filterNames[i] ?? 'band'}-${i}`" :band="b" :band-index="i"
              :order-number="eq.bandOrderNumbers[i] ?? i + 1" :filter-name="eq.filterNames[i] ?? ''"
              :selected="eq.selectedBandIndex === i" :read-only="selectedLocked" />
            <el-empty v-if="!eq.bands.length" :description="$t('This block has no EQ (biquad) filters')" :image-size="70"
              class="bands-empty" />
          </template>
          <el-empty v-else :description="$t('Select a filter block to edit its EQ bands')" :image-size="70"
            class="bands-empty" />
        </div>
      </el-main>
    </el-container>
  </el-container>
</template>

<style scoped>
.eq-page .toolbar {
  display: flex;
  flex-wrap: wrap;
  justify-content: space-between;
  position: relative;
  box-sizing: border-box;

  padding: 8px 0;
  border-bottom: 1px solid var(--el-border-color);
}

.eq-page .body {
  flex: 1;
  min-height: 0;
  padding: 0;
  /* Vertical spacing inside the page: margins would sit outside the flex
     item's assigned height and re-introduce the outer scrollbar. */
  padding-block: 8px;
}

.eq-page .toolbar .icon {
  color: var(--el-color-primary);
}

.eq-page .toolbar .title {
  color: var(--el-text-color-primary);
  white-space: nowrap;
}

.eq-page .toolbar .select {
  width: 340px;
  max-width: 100%;
}

.eq-page .toolbar .policy-tag {
  max-width: 220px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* collapsed selection: stretch the EP wrapper so the label-slot content
   justifies exactly like an option row (name left, chips right) */
.eq-page .select :deep(.el-select__selected-item.el-select__placeholder) {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 6px;
  width: 100%;
}
.eq-page .select .sel-name {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.eq-page .select .sel-tags {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  flex-shrink: 0;
}

.eq-page .chart-aside {
  display: flex;
  flex-direction: column;
  min-width: 0;
  min-height: 0;
  overflow-x: hidden;
  overflow-y: auto;
}

.eq-page .filters-container {
  display: flex;
  min-width: 0;
  min-height: 0;
  padding: 0;
  overflow: hidden;
}

.eq-page .visual-options {
  flex: 0 0 var(--eq-vizbar-h);
  position: relative;
  min-width: 0;
  width: 100%;
  padding-right: var(--eq-gainscale-w);
  box-sizing: border-box;
}
</style>

<style>
/* custom el-option rows: block name left, badge chips (filter count +
   one chip per channel) right. GLOBAL on purpose: the dropdown popper
   teleports to <body>, so scoped selectors (.eq-page ...) never match. */
.eq-block-dd .opt-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  width: 100%;
}
.eq-block-dd .opt-name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.eq-block-dd .opt-tags {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  flex-shrink: 0;
}
/* el-option content must fill the row for space-between alignment */
.eq-block-dd .el-select-dropdown__item {
  display: flex;
  align-items: center;
}
</style>

<script lang="ts">
import { defineComponent, computed, ref, onBeforeUnmount, getCurrentInstance } from 'vue'
import { Filter } from '@element-plus/icons-vue'
import EqPlotCard from '../components/chart/EqPlotCard.vue'
import VizOptionsBar from '../components/VizOptionsBar.vue'
import PreampCard from '../components/faders/FaderPreampCard.vue'
import BandCard from '../components/faders/FaderBandCard.vue'
import '../styles/eq.scss'
import { eq, initializeFromConfig, selectStep, flushLiveEdits, addBand } from '../stores/eqStore'
import { initializeVizOptions, setupVizOptionsPersistence } from '../stores/vizOptions'
import * as dsp from '../dsp'
import type { FilterStepInfo } from '../lib/camillaEqMapping'
import { planSlotSave, type FiltersSchema, type PipelineStage } from '../lib/uciSync'

function scrollBandRail(event: WheelEvent): void {
  const rail = event.currentTarget as HTMLElement
  if (Math.abs(event.deltaY) <= Math.abs(event.deltaX)) return
  if (rail.scrollWidth <= rail.clientWidth + 1) return
  event.preventDefault()
  rail.scrollLeft += event.deltaY
}

export default defineComponent({
  name: 'EqPage',
  components: { EqPlotCard, VizOptionsBar, PreampCard, BandCard },
  setup() {
    const pageEl = ref<HTMLDivElement | null>(null)
    const error = ref('')
    // $t access inside setup (the shell installs vue-i18n globally; the
    // <i18n> block below adds this component's own messages)
    const labelCtx = getCurrentInstance()?.proxy as any
    // Definite height so the plot column can fill the viewport exactly
    // (measured from the Oui scroll container; small screens fall back to auto).
    const pageHeight = ref('auto')

    // UCI policies: pipeline stage classification + editable slot schema.
    const pipelineStages = ref<PipelineStage[]>([])
    const filtersSchema = ref<FiltersSchema | null>(null)
    const savingToUci = ref(false)

    const selectedStep = computed<number | null>({
      get: () => eq.selectedStepIndex,
      set: (v) => {
        if (v !== null) void selectStep(v)
      },
    })

    const connected = computed(() => dsp.connectionState.value === 'connected')

    const stageOf = (index: number | null): PipelineStage | null =>
      index === null ? null : pipelineStages.value.find((s) => s.index === index) ?? null

    /* Block name ONLY -- the same label the filters page uses (the uci
     * slot name for editable stages); counts/channels live in the chips. */
    const stepName = (s: FilterStepInfo): string => {
      const stage = stageOf(s.index)
      if (stage) return stage.label
      return `Block ${s.position}`
    }

    const selectedStepInfo = computed<FilterStepInfo | null>(() =>
      eq.steps.find((s) => s.index === eq.selectedStepIndex) ?? null
    )

    /* Add-band policy: free blocks always, editable slots while under
     * max_steps, locked/mixer blocks never. */
    const canAddBand = computed(() => {
      if (eq.selectedStepIndex === null || dsp.connectionState.value !== 'connected')
        return false
      const stage = stageOf(eq.selectedStepIndex)
      if (!stage) return true
      if (stage.kind !== 'editable') return false
      const max = stage.max_steps != null ? Number(stage.max_steps) : null
      return max == null || (selectedStepInfo.value?.names.length ?? 0) < max
    })

    const doAddBand = async () => {
      const ok = await addBand('Peaking')
      if (!ok)
        labelCtx.$message?.error?.(labelCtx.$t('Cannot add a band to this block'))
    }

    /* policy tag: only for states the selector does NOT already show --
     * editable blocks are named by their slot in the selector, a second
     * "slot: X" tag would be redundant */
    const policyTag = computed(() => {
      const stage = stageOf(eq.selectedStepIndex)
      if (!stage) return null
      switch (stage.kind) {
        case 'editable':
          return null
        case 'locked':
          return { type: 'danger' as const, text: labelCtx.$t('protected — read only') }
        case 'mixer':
          return { type: 'warning' as const, text: labelCtx.$t('mixer') }
        default:
          return { type: 'info' as const, text: labelCtx.$t('free edit') }
      }
    })

    /* locked block: every fader/control freezes (manifest would reject
     * live edits anyway -- fail loudly in the UI instead of in toasts) */
    const selectedLocked = computed(() =>
      stageOf(eq.selectedStepIndex)?.kind === 'locked'
    )

    let scrollWrap: HTMLElement | null = null
    let ro: ResizeObserver | null = null

    const measure = () => {
      if (scrollWrap) {
        pageHeight.value = `${Math.max(560, scrollWrap.clientHeight)}px`
      } else {
        pageHeight.value = 'auto'
      }
    }

    const loadPolicies = async (oui: any) => {
      try {
        const [pipeline, schema] = await Promise.all([
          oui.call('dsp', 'get_pipeline'),
          oui.call('dsp', 'get_saved_filters'),
        ])
        pipelineStages.value = pipeline?.stages ?? []
        filtersSchema.value = schema ?? null
      } catch {
        // Policies unavailable: the save falls back to free edit on the
        // raw pipeline step; live tuning is unaffected.
        filtersSchema.value = null
        pipelineStages.value = []
      }
    }

    onBeforeUnmount(() => {
      ro?.disconnect()
      ro = null
      window.removeEventListener('resize', measure)
      dsp.disconnect()
    })

    return {
      pageEl,
      error,
      pageHeight,
      eq,
      selectedStep,
      connected,
      selectStep,
      stepName,
      selectedStepInfo,
      selectedLocked,
      canAddBand,
      doAddBand,
      scrollBandRail,
      pipelineStages,
      filtersSchema,
      savingToUci,
      policyTag,
      // exposed for the Options-API hooks below
      _measure: measure,
      _loadPolicies: loadPolicies,
      _scrollWrapRef: () => scrollWrap,
      _setScrollWrap: (el: HTMLElement | null) => (scrollWrap = el),
      _setRo: (o: ResizeObserver | null) => (ro = o),
    }
  },
  mounted() {
    const self = this as any

    initializeVizOptions()
    self._cleanupVizPersistence = setupVizOptionsPersistence()

    // Fill the available viewport inside the Oui scroll container
    const pageElement = (self.pageEl?.$el ?? self.pageEl) as HTMLElement | null
    self._setScrollWrap(pageElement?.closest('.el-scrollbar__wrap') as HTMLElement | null)
    self._measure()
    if (self._scrollWrapRef()) {
      const ro = new ResizeObserver(self._measure)
      ro.observe(self._scrollWrapRef())
      self._setRo(ro)
    }
    window.addEventListener('resize', self._measure)

    // UCI policies for the save feature (daemon-side classification of every
    // runtime pipeline index + the editable slot schema).
    void self._loadPolicies(this.$oui)

    // Connect to the CamillaDSP websocket proxy and load the running config
    dsp.connect()
    self._stopConn = this.$watch(
      () => dsp.connectionState.value,
      async (state: string) => {
        if (state === 'connected') {
          self.error = ''
          try {
            const cfg = await dsp.downloadConfig()
            if (cfg) initializeFromConfig(cfg)
          } catch (e: any) {
            self.error = e?.value ?? self.$t('Unable to read CamillaDSP configuration')
          }
        }
      },
      { immediate: true }
    )

    // Surface upload errors as toasts
    self._stopUpload = this.$watch(
      () => eq.uploadStatus,
      (status: any) => {
        if (status?.state === 'error' && status?.message) {
          self.$message?.error?.(status.message)
        }
      },
      { deep: true }
    )

    // Session guard: bounce to login when the Oui session expires
    self._sessionTimer = setInterval(() => {
      void (async () => {
        const alive = await self.$oui.isAlived()
        if (alive) return
        self.$router.replace('/login')
      })()
    }, 5000)

    // Development-only live reload. scripts/webui/watch-eq.sh updates the
    // version marker inside the running snapshot guest. Keeping this behind a
    // query flag avoids polling in normal appliance use.
    if (new URLSearchParams(window.location.search).has('eq-dev')) {
      let version: string | null = null
      self._devReloadTimer = setInterval(() => {
        void fetch(`/views/eq.version?_=${Date.now()}`, { cache: 'no-store' })
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
  beforeUnmount() {
    const self = this as any
    self._stopConn?.()
    self._stopUpload?.()
    clearInterval(self._sessionTimer)
    clearInterval(self._devReloadTimer)
    self._cleanupVizPersistence?.()
    dsp.disconnect()
  },
  methods: {
    /**
     * Persist the selected block's live filters.
     * - editable slot present: save_filters validates the slot policy
     *   (locked chains are never written; allow/max_steps when set).
     * - policies unset or unavailable: free edit — the daemon writes the
     *   raw pipeline step (user-owned filters only) with a genconf dry-run.
     */
    async saveToUci() {
      const self = this as any
      const plan = planSlotSave(
        self.pipelineStages as PipelineStage[],
        self.filtersSchema as FiltersSchema | null,
        eq.selectedStepIndex,
        eq.bands
      )
      if (plan.errors.length) {
        self.$message?.error?.(plan.errors.join(' '))
        return
      }

      const payload = plan.mode === 'free'
        ? { pipeline: { index: plan.pipelineIndex, filters: plan.steps } }
        : { steps: { [plan.slot as string]: plan.steps } }

      self.savingToUci = true
      try {
        // Commit pending live edits first so the saved state matches the UI.
        await flushLiveEdits()

        const result = await self.$oui.call('dsp', 'save_filters', payload)
        if (result?.error) {
          const message = plan.mode === 'free' && result.error.message === 'pipeline index out of range'
            ? self.$t('Free edit cannot be persisted: UCI has no pipeline step for this live block. Import the runtime pipeline into UCI first so its topology can be saved safely.')
            : result.error.message
          self.$message?.error?.(message)
          return
        }

        const target = plan.mode === 'free'
          ? self.$t('pipeline step {index} (free edit)', { index: plan.pipelineIndex })
          : self.$t('UCI slot "{slot}"', { slot: plan.slot })
        self.$message?.success?.(
          plan.steps.length === 1
            ? self.$t('Saved {n} filter to {target}', { n: plan.steps.length, target })
            : self.$t('Saved {n} filters to {target}', { n: plan.steps.length, target })
        )

        // The daemon rewrote filter sections and reloaded camilladsp:
        // resync the cached config and refresh the policy view.
        try {
          const cfg = await dsp.downloadConfig()
          if (cfg) initializeFromConfig(cfg)
        } catch {
          // Live state stays valid; the next block switch re-extracts.
        }
        await self._loadPolicies(self.$oui)
      } catch (e: any) {
        self.$message?.error?.(String(e))
      } finally {
        self.savingToUci = false
      }
    },
  },
})
</script>

<i18n src="../locale.json"/>
