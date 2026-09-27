<template>
  <el-container v-show="active" ref="pageEl" class="eq-page" :style="{ '--eq-page-h': pageHeight }">

    <!-- Toolbar: teleported into the Live page header (right side).
         Rendered only while this tab is active; the page-level
         connection tag lives outside the teleport. -->
    <Teleport v-if="inDoc && active" to="#live-toolbar">
      <!-- classed for the scoped rules below: the teleport moves this
           OUTSIDE .eq-page, so .eq-page-prefixed selectors never match -->
      <el-space class="eq-toolbar">
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
              <el-tag v-if="selectedLocked" size="small" type="info" effect="plain" class="sel-chip">
                {{ $t('Protected') }}
              </el-tag>
              <el-tag v-if="selectedStepInfo" size="small" type="primary" effect="light" class="sel-chip">
                {{ selectedStepInfo.names.length }} {{ $t('filters') }}
              </el-tag>
              <el-tag v-for="c in (selectedStepInfo?.channels ?? [])" :key="c" size="small"
                type="success" effect="light" class="sel-chip">{{ channelLabel(c) }}</el-tag>
            </span>
          </template>
          <el-option v-for="s in eq.steps" :key="s.index" :value="s.index" :label="stepName(s)">
            <div class="opt-row">
              <span class="opt-name">{{ stepName(s) }}</span>
              <span class="opt-tags">
                <el-tag v-if="stageOf(s.index)?.kind === 'locked'" size="small" type="info" effect="plain">
                  {{ $t('Protected') }}
                </el-tag>
                <el-tag size="small" type="primary" effect="light">{{ s.names.length }} {{ $t('filters') }}</el-tag>
                <el-tag v-for="c in s.channels" :key="c" size="small" type="success" effect="light">{{ channelLabel(c) }}</el-tag>
              </span>
            </div>
          </el-option>
        </el-select>

        <el-dropdown split-button type="primary" :disabled="!canAddBand"
          :title="$t('Add a new EQ band to this block')"
          @click="doAddBand" @command="doAddOrphan">
          {{ $t('Add filter') }}
          <template #dropdown>
            <el-dropdown-menu>
              <el-dropdown-item v-for="o in orphanFilters" :key="o.name" :command="o.name"
                :disabled="!orphanAllowed(o)">
                {{ o.name }} <span class="opt-meta-inline">({{ o.type }}) · {{ orphanBlockLabel(o) }}</span>
              </el-dropdown-item>
              <el-dropdown-item v-if="!orphanFilters.length" disabled>
                {{ $t('No orphaned filters') }}
              </el-dropdown-item>
            </el-dropdown-menu>
          </template>
        </el-dropdown>

        <el-tag v-if="policyTag" :type="policyTag.type" class="policy-tag">
          {{ policyTag.text }}
        </el-tag>
      </el-space>
    </Teleport>

    <el-alert v-if="error" type="error" :title="error" :closable="false" show-icon class="eq-alert" />

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

<style scoped lang="scss">
.eq-page {
  .eq-alert {
    margin: 0;
  }

  .body {
    flex: 1;
    min-height: 0;
    padding: 0;
    /* Vertical spacing inside the page: margins would sit outside the flex
       item's assigned height and re-introduce the outer scrollbar. */
    padding-block: 8px;
  }

  .chart-aside {
    display: flex;
    flex-direction: column;
    min-width: 0;
    min-height: 0;
    overflow-x: hidden;
    overflow-y: auto;
  }

  .filters-container {
    display: flex;
    min-width: 0;
    min-height: 0;
    padding: 0;
    overflow: hidden;
  }

  .visual-options {
    flex: 0 0 var(--eq-vizbar-h);
    position: relative;
    min-width: 0;
    width: 100%;
    padding-right: var(--eq-gainscale-w);
    box-sizing: border-box;
  }
}

.eq-toolbar {
  .icon {
    color: var(--el-color-primary);
  }

  .title {
    color: var(--el-text-color-primary);
    white-space: nowrap;
  }

  .select {
    width: 340px;
    max-width: 100%;
  }

  .policy-tag {
    max-width: 220px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  /* collapsed selection: stretch the EP wrapper so the label-slot content
     justifies exactly like an option row (name left, chips right) */
  .select :deep(.el-select__selected-item.el-select__placeholder) {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 6px;
    width: 100%;
  }

  .sel-name {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .sel-tags {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    flex-shrink: 0;
  }
}
</style>

<style lang="scss">
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
import { useInDocument } from '../../lib/inDocument'
import { Filter } from '@element-plus/icons-vue'
import EqPlotCard from '../chart/EqPlotCard.vue'
import VizOptionsBar from '../VizOptionsBar.vue'
import PreampCard from '../faders/FaderPreampCard.vue'
import BandCard from '../faders/FaderBandCard.vue'
import '../../styles/eq.scss'
import { eq, initializeFromConfig, selectStep, addBand, addOrphanFilter } from '../../stores/eqStore'
import { loadSession, sessionTypeOf } from '../../lib/filterSession'
import { initializeVizOptions, setupVizOptionsPersistence } from '../../stores/vizOptions'
import * as dsp from '../../dsp'
import type { FilterStepInfo } from '../../lib/camillaEqMapping'
import type { FiltersSchema, PipelineStage } from '../../lib/uciSync'

function scrollBandRail(event: WheelEvent): void {
  const rail = event.currentTarget as HTMLElement
  if (Math.abs(event.deltaY) <= Math.abs(event.deltaX)) return
  if (rail.scrollWidth <= rail.clientWidth + 1) return
  rail.preventDefault()
  rail.scrollLeft += event.deltaY
}

/* EQ tab of the Live page. The websocket connection, session guard and
 * connection tag are owned by the Live page; this tab owns the block
 * selection, band editing, chart and the save-to-UCI action. */
export default defineComponent({
  name: 'EqTab',
  components: { EqPlotCard, VizOptionsBar, PreampCard, BandCard },
  props: {
    active: { type: Boolean, default: false },
  },
  setup(props) {
    const pageEl = ref<HTMLDivElement | null>(null)
    const error = ref('')
    // $t access inside setup (the shell installs vue-i18n globally; the
    // <i18n> block below adds this component's own messages)
    const labelCtx = getCurrentInstance()?.proxy as any
    // Definite height so the plot column can fill the viewport exactly
    // (measured from the Oui scroll container; small screens fall back to auto).
    const pageHeight = ref('auto')

    // Teleports into the Live header must wait until the shell attached
    // this view to the document (see lib/inDocument.ts)
    const inDoc = useInDocument(() => (pageEl.value?.$el ?? pageEl.value) as HTMLElement | null)

    // UCI policies: pipeline stage classification + editable slot schema.
    const pipelineStages = ref<PipelineStage[]>([])
    const filtersSchema = ref<FiltersSchema | null>(null)

    const selectedStep = computed<number | null>({
      get: () => eq.selectedStepIndex,
      set: (v) => {
        if (v !== null) void selectStep(v)
      },
    })

    const stageOf = (index: number | null): PipelineStage | null =>
      index === null ? null : pipelineStages.value.find((s) => s.index === index) ?? null

    /* Block name ONLY -- the custom uci block name when set, else the
     * slot name (the filters-page label); counts/channels live in the
     * chips. */
    const stepName = (s: FilterStepInfo): string => {
      const stage = stageOf(s.index)
      if (stage) return (stage as any).name ?? stage.label
      return `Block ${s.position}`
    }

    /* disabled/orphaned filters: the definitions live in the SESSION
     * store (camilladsp refuses unreferenced defs in the live config);
     * restorable into the selected block through the Restore dropdown.
     * The session has no reactive signal: band-count and selection
     * changes are the invalidation triggers. */
    const orphanFilters = computed(() => {
      void eq.bands.length
      void eq.selectedStepIndex
      return Object.entries(loadSession()).map(([name, entry]) => ({
        name,
        type: sessionTypeOf(entry)
      }))
    })
    const UCI_OF_CAMILLA: Record<string, string> = {
      Peaking: 'peak', Highshelf: 'hs', Lowshelf: 'ls', Highpass: 'hp',
      Lowpass: 'lp', Bandpass: 'bp', Notch: 'notch', Allpass: 'ap'
    }
    const orphanAllowed = (o: { name: string; type: string }): boolean => {
      const idx = eq.selectedStepIndex
      const stage = idx === null ? null : stageOf(idx)
      if (!stage) return true
      if (stage.kind === 'locked' || stage.kind === 'mixer') return false
      /* the origin block already shows the disabled band as a grayed
       * fader (its toggle restores it): only OTHER blocks can pull it */
      const entry = loadSession()[o.name]
      if (entry && entry.stepIndex === idx) return false
      if (stage.kind !== 'editable') return true
      const def = loadSession()[o.name]?.def
      const uci = def?.type === 'Gain' ? 'gain' : def?.type === 'Conv' ? 'conv' : UCI_OF_CAMILLA[def?.parameters?.type]
      const allow = filtersSchema.value?.editable?.[stage.label]?.allow ?? []
      return !allow.length || (!!uci && allow.includes(uci))
    }
    /* original block of an orphan (for the dropdown label) */
    const orphanBlockLabel = (o: { name: string }): string => {
      const entry = loadSession()[o.name]
      const stage = entry ? stageOf(entry.stepIndex) : null
      return stage ? ((stage as any).name ?? stage.label) : '—'
    }

    const doAddOrphan = async (name: string) => {
      const ok = await addOrphanFilter(name)
      if (!ok) labelCtx.$message?.error?.(labelCtx.$t('Cannot add a band to this block'))
    }

    /* mixer channel labels (uci in_label): chips show them when set */
    const channelLabels = ref<string[]>([])
    const channelLabel = (c: number) => channelLabels.value[c]?.trim() || `ch ${c}`

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

    /* policy tag: only for states the selector does NOT already show.
     * Locked blocks are tagged "Protected" in the selector itself; the
     * read-only controls speak for themselves. */
    const policyTag = computed(() => {
      const stage = stageOf(eq.selectedStepIndex)
      if (!stage) return null
      switch (stage.kind) {
        case 'editable':
        case 'locked':
          return null
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
      const el = (pageEl.value?.$el ?? pageEl.value) as HTMLElement | null
      if (!scrollWrap || !el) {
        pageHeight.value = 'auto'
        return
      }
      const elRect = el.getBoundingClientRect()
      // v-show hides the tab with display:none: rects collapse to zero
      if (!elRect.width && !elRect.height) return
      // The page shares the Oui scroll content with the Live header above
      // it: fill only the space that is actually left, so the tab never
      // pushes the outer container into scrolling. Below the graph's
      // 560px floor the page grows and the outer scrollbar is expected.
      const wrapRect = scrollWrap.getBoundingClientRect()
      const topOffset = elRect.top - wrapRect.top + scrollWrap.scrollTop
      const view = el.parentElement
      let below = 0
      if (view) {
        const cs = getComputedStyle(view)
        below = parseFloat(cs.paddingBottom) + (parseFloat(cs.borderBottomWidth) || 0)
      }
      const avail = scrollWrap.clientHeight - topOffset - below
      pageHeight.value = `${Math.max(560, Math.floor(avail))}px`
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
    })

    return {
      pageEl,
      inDoc,
      error,
      pageHeight,
      eq,
      selectedStep,
      selectStep,
      stepName,
      selectedStepInfo,
      selectedLocked,
      channelLabel,
      orphanFilters,
      orphanAllowed,
      doAddOrphan,
      orphanBlockLabel,
      canAddBand,
      doAddBand,
      scrollBandRail,
      pipelineStages,
      filtersSchema,
      policyTag,
      stageOf,
      // exposed for the Options-API hooks below
      _measure: measure,
      _loadPolicies: loadPolicies,
      _scrollWrapRef: () => scrollWrap,
      _setScrollWrap: (el: HTMLElement | null) => (scrollWrap = el),
      _setRo: (o: ResizeObserver | null) => (ro = o),
      _setChannelLabels: (l: string[]) => (channelLabels.value = l),
    }
  },
  mounted() {
    const self = this as any

    initializeVizOptions()
    self._cleanupVizPersistence = setupVizOptionsPersistence()

    // Fill the available viewport inside the Oui scroll container.
    // The tab may still be hidden (display:none) at mount when the user
    // lands on the Advanced tab first: re-measure on every activation.
    self._remeasure = () => self._measure()
    if (self.active) self._measureNow()

    // UCI policies for the save feature (daemon-side classification of every
    // runtime pipeline index + the editable slot schema).
    void self._loadPolicies(this.$oui)

    // mixer channel labels for the chips (best effort)
    this.$oui.call('dsp', 'get_mixers').then(r => {
      const l = r?.mixers?.[0]?.in_label
      if (Array.isArray(l)) self._setChannelLabels(l)
    }).catch(() => {})

    // Load the running config into the EQ store whenever the (page-owned)
    // websocket connection establishes.
    self._stopConn = this.$watch(
      () => dsp.connectionState.value,
      async (state: string) => {
        if (state === 'connected') {
          self.error = ''
          try {
            const cfg = await dsp.downloadConfig()
            if (cfg) initializeFromConfig(cfg)
          } catch (e: any) {
            self.error = e?.value ?? this.$t('Unable to read CamillaDSP configuration')
          }
        }
      },
      { immediate: true }
    )
  },
  watch: {
    active(v: boolean) {
      // display:none breaks height measurement: re-measure on activation
      if (v) (this as any)._measureNow?.()
    },
  },
  methods: {
    _measureNow() {
      const self = this as any
      const pageElement = (self.pageEl?.$el ?? self.pageEl) as HTMLElement | null
      if (!self._scrollWrapRef()) {
        self._setScrollWrap(pageElement?.closest('.el-scrollbar__wrap') as HTMLElement | null)
        if (self._scrollWrapRef()) {
          const ro = new ResizeObserver(self._remeasure)
          ro.observe(self._scrollWrapRef())
          self._setRo(ro)
        }
      }
      self._measure()
      window.addEventListener('resize', self._remeasure)
    },
  },
  beforeUnmount() {
    const self = this as any
    self._stopConn?.()
    self._cleanupVizPersistence?.()
    window.removeEventListener('resize', self._remeasure)
  },
})
</script>

<i18n src="../../locale.json"/>
