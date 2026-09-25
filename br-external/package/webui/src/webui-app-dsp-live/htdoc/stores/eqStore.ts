/**
 * EQ band state management
 * Single source of truth for all band parameters (Vue port of CamillaEQ eqStore)
 *
 * dante distinction: state is scoped to ONE pipeline Filter block at a time
 * (selectedStepIndex). Switching blocks commits pending edits for the previous
 * block, then re-extracts the bands of the newly selected one.
 */

import { computed, reactive } from 'vue'
import type { EqBand } from '../lib/filterResponse'
import { generateCurvePath, generateBandCurvePath } from '../lib/eqSvgRenderer'
import type { CamillaDSPConfig } from '../lib/camillaTypes'
import {
  extractEqBandsFromConfig,
  applyEqBandsToConfig,
  listFilterSteps,
  mapEqBandTypeToCamilla,
  type ExtractedEqData,
  type FilterStepInfo,
} from '../lib/camillaEqMapping'
import { debounceCancelable } from '../lib/debounce'
import * as dsp from '../dsp'
import { clampFreqHz, clampGainDb, clampQ } from '../lib/eqParamClamp'
import { disableFilterInStep, enableFilterInStep } from '../lib/filterEnablement'
import { reconcileSession, loadSession } from '../lib/filterSession'

// Upload debounce time (ms)
const UPLOAD_DEBOUNCE_MS = 200

export type UploadState = 'idle' | 'pending' | 'success' | 'error'

export interface UploadStatus {
  state: UploadState
  message?: string
}

export interface EqStoreState {
  /** Editable (non-bypassed) Filter blocks of the running pipeline */
  steps: FilterStepInfo[]
  /** Pipeline index of the block being edited */
  selectedStepIndex: number | null
  bands: EqBand[]
  filterNames: string[]
  bandOrderNumbers: number[]
  selectedBandIndex: number | null
  preampGain: number
  preampAvailable: boolean
  soloActiveBandIndex: number | null
  /** DSP sample rate of the running config (response curves stop at Nyquist) */
  sampleRate: number
  uploadStatus: UploadStatus
}

export const eq = reactive<EqStoreState>({
  steps: [],
  selectedStepIndex: null,
  bands: [],
  filterNames: [],
  bandOrderNumbers: [],
  selectedBandIndex: null,
  preampGain: 0,
  preampAvailable: false,
  soloActiveBandIndex: null,
  sampleRate: 48000,
  uploadStatus: { state: 'idle' },
})

// Internal state (not reactive)
let lastConfig: CamillaDSPConfig | null = null
let extractedData: ExtractedEqData | null = null

/**
 * Bumped on every local edit. An upload snapshots this value when it is built;
 * the confirmed server state is only mirrored back into the UI when the user
 * has NOT edited anything since. Otherwise the mirror would snap the slider
 * back to the uploaded snapshot and the follow-up upload would carry the
 * stale snapshot instead of the user's newer edit.
 */
let localRevision = 0
/** True while edits are waiting in the debounce window. */
let editsPending = false
/** Serialization chain: uploads must never overlap on the websocket. */
let uploadQueue: Promise<void> = Promise.resolve()

/**
 * Re-extract the bands of the currently selected block from lastConfig.
 */
function extractForSelection(): void {
  if (!lastConfig || eq.selectedStepIndex === null) {
    extractedData = null
    eq.bands = []
    eq.filterNames = []
    eq.bandOrderNumbers = []
    eq.preampGain = 0
    eq.preampAvailable = false
    return
  }

  const extracted = extractEqBandsFromConfig(lastConfig, eq.selectedStepIndex)
  applyExtraction(extracted)
}

/**
 * Publish an extraction into the store, appending the DISABLED filters of
 * this block (session store) as grayed bands: they stay visible with
 * their toggle switch so they can be re-enabled in place. Bands of other
 * blocks are NOT shown here -- those are offered by the Restore dropdown.
 */
function applyExtraction(extracted: ExtractedEqData): void {
  const bands = [...extracted.bands]
  const names = [...extracted.filterNames]
  const orders = [...extracted.orderNumbers]

  const stepIndex = eq.selectedStepIndex
  for (const [name, entry] of Object.entries(loadSession())) {
    if (entry.stepIndex !== stepIndex) continue
    const def = entry.def
    if (!def || def.type !== 'Biquad') continue
    const params = def.parameters ?? {}
    // the live config cannot hold the def (camilladsp refuses orphans):
    // guard against a stale session entry that is actually enabled
    if ((lastConfig?.pipeline?.[stepIndex]?.names ?? []).includes(name)) continue
    bands.push({
      enabled: false,
      type: mapEqBandTypeToCamilla(params.type) ?? 'Peaking',
      freq: Math.max(10, Math.min(30000, Number(params.freq) || 1000)),
      gain: Math.max(-24, Math.min(24, Number(params.gain) || 0)),
      q: Math.max(0.1, Math.min(10, Number(params.q) || 1)),
    } as EqBand)
    names.push(name)
    orders.push(orders.length + 1)
  }

  /* the merged view must be the SINGLE source: runUpload spreads
   * extractedData and overrides bands with eq.bands -- a filterNames
   * without the grayed entries made the counts diverge and every
   * following upload throw "Band count and filter name count must
   * match". */
  extracted.bands = bands
  extracted.filterNames = names
  extracted.orderNumbers = orders
  extractedData = extracted

  eq.bands = bands
  eq.filterNames = names
  eq.bandOrderNumbers = orders
  eq.preampGain = extracted.preampGain
  eq.preampAvailable = extracted.preampAvailable
}

// Upload runner: builds the payload from CURRENT state and serializes through
// uploadQueue so an in-flight SetConfigJson always completes (and refreshes
// lastConfig) before the next upload builds its own payload.
async function runUpload(): Promise<void> {
  const stepIndex = eq.selectedStepIndex
  if (!lastConfig || !extractedData || stepIndex === null) {
    return
  }

  try {
    eq.uploadStatus = { state: 'pending' }

    const uploadedRevision = localRevision
    const updatedData: ExtractedEqData = {
      ...extractedData,
      bands: eq.bands,
      preampGain: eq.preampGain,
    }
    const updatedConfig = applyEqBandsToConfig(lastConfig, updatedData, stepIndex)
    editsPending = false

    const success = await dsp.uploadConfig(updatedConfig)

    if (success) {
      // OPTIMISTIC: the daemon answered Ok -- extract from the config we
      // just sent. An immediate re-download can race the apply and
      // momentarily return the previous config, which made freshly
      // added/removed bands vanish from the UI until the next reload.
      lastConfig = updatedConfig

      // Refresh the base extraction for the block that is selected NOW (it
      // may have changed while the upload was in flight).
      const extracted = extractEqBandsFromConfig(lastConfig, stepIndex)

      // Mirror the server state into the UI only when nothing was edited
      // after this upload was built; otherwise keep local (newer) values so
      // the slider never jumps back mid-interaction. (applyExtraction also
      // re-appends the disabled bands of this block as grayed faders.)
      if (!soloSessionActive && uploadedRevision === localRevision) {
        applyExtraction(extracted)
      } else {
        extractedData = extracted
      }

      eq.uploadStatus = { state: 'success' }

      // Clear success state after 2 seconds
      setTimeout(() => {
        if (eq.uploadStatus.state === 'success') {
          eq.uploadStatus = { state: 'idle' }
        }
      }, 2000)
    } else {
      eq.uploadStatus = { state: 'error', message: 'Upload failed' }

      try {
        // Best-effort resync with the DSP's current config
        const resynced = await dsp.downloadConfig()
        if (resynced) {
          console.warn('Upload failed, resynced with DSP config')
          lastConfig = resynced
          extractForSelection()
        }
      } catch (resyncError) {
        console.warn('Could not resync after upload failure:', resyncError)
      }
    }
  } catch (error: any) {
    console.error('Error uploading config:', error)
    eq.uploadStatus = {
      state: 'error',
      message: error instanceof Error ? error.message : 'Upload failed',
    }
  }
}

function queueUpload(): void {
  uploadQueue = uploadQueue.then(runUpload)
}

/** Entry point for setters: marks edits pending inside the debounce window. */
function requestUpload(): void {
  editsPending = true
  debouncedUpload.call()
}

/**
 * Structural changes (band added/removed) upload IMMEDIATELY: the band
 * must not live in a local-only debounce window, where a racing upload
 * or re-init could mirror it away ("fader appears, then vanishes").
 */
function uploadNow(): void {
  debouncedUpload.cancel()
  editsPending = true
  queueUpload()
}

// Debounced upload entry point (uploads the selected block only)
const debouncedUpload = debounceCancelable(queueUpload, UPLOAD_DEBOUNCE_MS)

/**
 * Drop the debounce window and wait until every queued upload has completed.
 * Config-level mutations (block switch, mute toggle, solo patch) must run on
 * a config that already contains the user's pending edits.
 */
async function flushPendingUpload(): Promise<void> {
  debouncedUpload.cancel()
  if (editsPending) {
    queueUpload()
  }
  await uploadQueue
}

/**
 * Commit any pending live edits immediately (used before UCI persistence
 * so the saved slot matches exactly what the UI currently shows).
 */
export async function flushLiveEdits(): Promise<void> {
  await flushPendingUpload()
}

/**
 * Initialize EQ store from a CamillaDSP config.
 * Preserves the block selection when still valid, otherwise selects the first.
 */
export function initializeFromConfig(cfg: CamillaDSPConfig): boolean {
  if (!cfg) {
    console.error('No config provided')
    return false
  }

  lastConfig = cfg
  eq.sampleRate = Number(cfg.devices?.samplerate) || 48000

  try {
    // disabled-filter session: drop stale entries, re-disable filters
    // whose removal was lost (failed upload / clobbered by another
    // client), keeping the mute state stable across reloads
    const removed = reconcileSession(cfg)
    if (removed.length) {
      void dsp.uploadConfig(cfg).catch((e) => console.warn('Unable to re-apply muted filters', e))
    }

    eq.steps = listFilterSteps(cfg)

    const stillValid =
      eq.selectedStepIndex !== null &&
      eq.steps.some((s) => s.index === eq.selectedStepIndex)
    if (!stillValid) {
      eq.selectedStepIndex = eq.steps.length ? eq.steps[0].index : null
      eq.selectedBandIndex = null
    }

    extractForSelection()

    return true
  } catch (error) {
    console.error('Error initializing from config:', error)
    return false
  }
}

/**
 * Switch the block being edited.
 * Commits pending edits for the previous block (flush), then re-extracts.
 */
export async function selectStep(pipelineIndex: number): Promise<void> {
  if (eq.selectedStepIndex === pipelineIndex) return

  // Solo patches the selected block's pipeline names[]: end it before switching
  if (soloSessionActive) {
    await endSoloEditSession()
  }

  // Commit in-flight edits so they are applied with the OLD block context
  await flushPendingUpload()

  eq.selectedStepIndex = pipelineIndex
  eq.selectedBandIndex = null
  extractForSelection()
}
export function setBandFreq(index: number, freq: number) {
  if (eq.selectedStepIndex === null) return
  const updated = [...eq.bands]
  updated[index] = { ...updated[index], freq: clampFreqHz(freq) }
  eq.bands = updated
  localRevision++
  requestUpload()
}

export function setBandGain(index: number, gain: number) {
  if (eq.selectedStepIndex === null) return
  const updated = [...eq.bands]
  updated[index] = { ...updated[index], gain: clampGainDb(gain) }
  eq.bands = updated
  localRevision++
  requestUpload()
}

export function setBandQ(index: number, q: number) {
  if (eq.selectedStepIndex === null) return
  const updated = [...eq.bands]
  updated[index] = { ...updated[index], q: clampQ(q) }
  eq.bands = updated
  localRevision++
  requestUpload()
}

export function setBandType(index: number, type: EqBand['type']) {
  if (eq.selectedStepIndex === null) return
  const updated = [...eq.bands]
  const currentBand = updated[index]

  // Preserve freq and q, but handle gain based on type
  const supportsGain = type === 'Peaking' || type === 'LowShelf' || type === 'HighShelf'

  updated[index] = {
    ...currentBand,
    type,
    gain: supportsGain ? currentBand.gain : 0,
  }

  eq.bands = updated
  localRevision++
  requestUpload()
}

export async function toggleBandEnabled(index: number): Promise<void> {
  const stepIndex = eq.selectedStepIndex
  if (!lastConfig || !extractedData || stepIndex === null) {
    console.error('Cannot toggle band: no block selected or no config loaded')
    return
  }

  // The mute toggle rewrites the config directly: commit pending edits first
  // so they are not lost when the block is re-extracted below.
  await flushPendingUpload()

  const filterName = extractedData.filterNames[index]
  if (!filterName) {
    console.error(`No filter name found for band index ${index}`)
    return
  }

  const isCurrentlyEnabled = eq.bands[index]?.enabled ?? false

  // End any active solo session first (restores the block's names[])
  if (soloSessionActive) {
    await endSoloEditSession()
  }

  try {
    // Mute/unmute within THIS block only. The shared helpers own the
    // session bookkeeping: a disable moves the definition out of the
    // live config (camilladsp refuses unreferenced defs) and records
    // the original position; an enable restores both.
    let updatedConfig
    if (isCurrentlyEnabled) {
      updatedConfig = disableFilterInStep(lastConfig, filterName, stepIndex)
    } else {
      updatedConfig = enableFilterInStep(lastConfig, filterName, stepIndex)
    }

    lastConfig = updatedConfig
    extractForSelection()
    localRevision++

    requestUpload()
  } catch (error: any) {
    console.error('Error toggling band enabled state:', error)
    eq.uploadStatus = {
      state: 'error',
      message: error instanceof Error ? error.message : 'Failed to toggle band',
    }
  }
}

// ─── Band add/remove on the selected block ─────────────────────────────────

/**
 * Append a new EQ band (biquad) to the selected block and upload it.
 * Policy gating (editable/free stage, max_steps) is done by the caller
 * (the toolbar button state).
 */
export async function addBand(type: EqBand['type'] = 'Peaking'): Promise<boolean> {
  const stepIndex = eq.selectedStepIndex
  if (!lastConfig || stepIndex === null || !dsp.isConnected()) {
    return false
  }

  // Config-level mutation: build on a config that has every pending edit
  await flushPendingUpload()
  if (soloSessionActive) {
    await endSoloEditSession()
  }

  const step = lastConfig.pipeline[stepIndex]
  if (!step || step.type !== 'Filter' || !step.names) {
    return false
  }

  const camillaType = mapEqBandTypeToCamilla(type)
  let n = 1
  while (lastConfig.filters?.[`eq_b${n}`]) n++
  const name = `eq_b${n}`

  const parameters: Record<string, number | string> = { type: camillaType, freq: 1000, q: 1 }
  if (type === 'Peaking' || type === 'LowShelf' || type === 'HighShelf') {
    parameters.gain = 0
  }

  if (!lastConfig.filters) lastConfig.filters = {}
  lastConfig.filters[name] = { type: 'Biquad', description: 'EQ band', parameters }
  step.names = [...step.names, name]

  extractForSelection()
  localRevision++
  eq.selectedBandIndex = eq.bands.length - 1
  uploadNow()
  return true
}

/**
 * Remove one EQ band (by index) from the selected block and upload it.
 */
export async function removeBand(index: number): Promise<boolean> {
  const stepIndex = eq.selectedStepIndex
  if (!lastConfig || stepIndex === null || !dsp.isConnected()) {
    return false
  }
  await flushPendingUpload()
  if (soloSessionActive) {
    await endSoloEditSession()
  }

  const step = lastConfig.pipeline[stepIndex]
  const filterName = extractedData?.filterNames[index]
  if (!step || step.type !== 'Filter' || !step.names || !filterName) {
    return false
  }

  step.names = step.names.filter((n) => n !== filterName)
  if (lastConfig.filters) delete lastConfig.filters[filterName]
  sessionForget(filterName)

  extractForSelection()
  localRevision++
  if (eq.selectedBandIndex !== null && eq.selectedBandIndex >= eq.bands.length) {
    eq.selectedBandIndex = eq.bands.length ? eq.bands.length - 1 : null
  }
  uploadNow()
  return true
}

/**
 * Append an EXISTING (orphaned) filter definition to the selected block
 * and upload immediately -- the restore path for disabled filters.
 */
export async function addOrphanFilter(filterName: string): Promise<boolean> {
  const stepIndex = eq.selectedStepIndex
  if (!lastConfig || stepIndex === null || !dsp.isConnected()) {
    return false
  }
  await flushPendingUpload()
  if (soloSessionActive) {
    await endSoloEditSession()
  }

  const step = lastConfig.pipeline[stepIndex]
  if (!step || step.type !== 'Filter' || !step.names) {
    return false
  }
  // the definition lives in the session, not the live config
  const entry = loadSession()[filterName]
  if (!entry?.def) return false
  if (step.names.includes(filterName)) return false

  if (!lastConfig.filters) lastConfig.filters = {}
  lastConfig.filters[filterName] = entry.def
  step.names = [...step.names, filterName]
  sessionForget(filterName)
  extractForSelection()
  localRevision++
  eq.selectedBandIndex = eq.bands.length - 1
  uploadNow()
  return true
}

// ─── Solo session state (scoped to the selected block) ─────────────────────

let soloSessionActive = false
/** Snapshot of the selected block's names[], captured at session start. */
let soloSnapshot: { stepIndex: number; names: string[] } | null = null
/**
 * Start a solo-edit session: mute every OTHER band of the selected block,
 * upload the temporary config directly (no debounce), and set the flag.
 */
export async function startSoloEditSession(bandIndex: number): Promise<void> {
  const stepIndex = eq.selectedStepIndex
  if (!lastConfig || !extractedData || stepIndex === null) return
  if (!dsp.isConnected()) return

  // The solo patch is built from lastConfig: commit pending edits first so
  // they are included (and not silently reverted by the solo upload).
  await flushPendingUpload()

  // Band-switch: end the current session silently before starting a new one
  if (soloSessionActive) {
    await endSoloEditSession()
  }

  const activeName = extractedData.filterNames[bandIndex]
  if (!activeName) return

  const updatedConfig = JSON.parse(JSON.stringify(lastConfig)) as CamillaDSPConfig
  const step = updatedConfig.pipeline?.[stepIndex]
  if (!step || step.type !== 'Filter' || !Array.isArray(step.names)) return

  const snapshot = { stepIndex, names: [...step.names] }

  const newNames: string[] = step.names.includes(activeName) ? [activeName] : []
  let changed = newNames.length !== step.names.length
  step.names = newNames

  if (changed) {
    const success = await dsp.uploadConfig(updatedConfig)
    if (!success) return
    lastConfig = updatedConfig
  }

  soloSnapshot = snapshot
  soloSessionActive = true
  eq.soloActiveBandIndex = bandIndex
}

/**
 * End the current solo-edit session: restore the block's names[] and upload.
 */
export async function endSoloEditSession(): Promise<void> {
  if (!soloSessionActive) return

  // Commit pending edits before restoring the names[] snapshot.
  await flushPendingUpload()

  soloSessionActive = false
  eq.soloActiveBandIndex = null

  if (!soloSnapshot || !lastConfig) {
    soloSnapshot = null
    return
  }

  if (!dsp.isConnected()) {
    soloSnapshot = null
    return
  }

  const updatedConfig = JSON.parse(JSON.stringify(lastConfig)) as CamillaDSPConfig
  const { stepIndex, names } = soloSnapshot
  soloSnapshot = null

  const step = updatedConfig.pipeline?.[stepIndex]
  if (step) {
    step.names = names
  }

  await dsp.uploadConfig(updatedConfig)
  lastConfig = updatedConfig
  extractForSelection()
}

/**
 * UI convenience wrapper — checks the soloWhileEditing toggle first.
 */
export function startSoloSession(bandIndex: number, soloEnabled: boolean): void {
  if (!soloEnabled) return
  void startSoloEditSession(bandIndex)
}

export function endSoloSession(): void {
  void endSoloEditSession()
}

export function selectBand(index: number | null) {
  eq.selectedBandIndex = index
}

export function setPreampGain(gain: number) {
  if (eq.selectedStepIndex === null || !eq.preampAvailable) return
  eq.preampGain = clampGainDb(gain)
  localRevision++
  requestUpload()
}

// Derived curve paths (reactive to bands changes)
export const sumCurvePath = computed(() => {
  return generateCurvePath(eq.bands, {
    width: 1000,
    height: 400,
    numPoints: 256,
    freqMax: Math.min(30000, eq.sampleRate / 2),
    sampleRate: eq.sampleRate,
  })
})

export const perBandCurvePaths = computed(() => {
  return eq.bands.map((band) =>
    generateBandCurvePath(band, {
      width: 1000,
      height: 400,
      numPoints: 128,
      freqMax: Math.min(30000, eq.sampleRate / 2),
      sampleRate: eq.sampleRate,
    })
  )
})
