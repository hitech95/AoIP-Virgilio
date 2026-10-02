/**
 * CamillaDSP connection layer (dante adaptation)
 *
 * CamillaEQ talks to CamillaDSP directly on its control/spectrum ports; in
 * dante the daemon proxies the CamillaDSP websocket (plus its spectrum
 * extension commands) at `/ws` on the same origin. This module provides:
 * - a serialized request queue over the single websocket
 * - reactive connection state and config
 * - config download/upload helpers
 * - spectrum helpers (GetSpectrumLevels / SetSpectrum* extension commands)
 */

import { ref, shallowRef } from 'vue'
import type { CamillaDSPConfig } from './lib/camillaTypes'
import type { SpectrumSource } from './rendering/spectrumVizController'

export type ConnectionState = 'disconnected' | 'connecting' | 'connected' | 'error'

export type SpectrumTap = 'capture' | 'playback'

export const connectionState = ref<ConnectionState>('disconnected')
export const config = shallowRef<CamillaDSPConfig | null>(null)

let ws: WebSocket | null = null
let intentionalClose = false
let reconnectTimer: ReturnType<typeof setTimeout> | null = null
let requestSeq = 0
let spectrumTap: SpectrumTap = 'capture'

interface PendingRequest {
  command: string
  resolve: (body: any) => void
  reject: (err: any) => void
  timer: ReturnType<typeof setTimeout>
}

const pending = new Map<number, PendingRequest>()

function nextSeq(): number {
  requestSeq = (requestSeq + 1) % Number.MAX_SAFE_INTEGER
  return requestSeq
}

function rejectAllPending(reason: string) {
  for (const [, p] of pending) {
    clearTimeout(p.timer)
    p.reject(new Error(reason))
  }
  pending.clear()
}

function scheduleReconnect() {
  if (intentionalClose || reconnectTimer !== null) return
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null
    connect()
  }, 3000)
}

/**
 * Connect to the CamillaDSP websocket proxy.
 */
export function connect(): void {
  if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) {
    return
  }

  intentionalClose = false
  connectionState.value = 'connecting'

  const proto = location.protocol === 'https:' ? 'wss:' : 'ws:'
  ws = new WebSocket(`${proto}//${location.host}/ws`)

  ws.onopen = () => {
    connectionState.value = 'connected'
    downloadConfig().catch(() => {})
  }

  ws.onmessage = (e) => {
    try {
      const parsed = JSON.parse(e.data)
      // Response shape: { [command]: { result: 'Ok'|'Error', value: ... } }
      const command = Object.keys(parsed)[0]
      for (const [seq, p] of pending) {
        if (p.command === command) {
          clearTimeout(p.timer)
          pending.delete(seq)
          const body = parsed[command]
          body?.result === 'Ok' ? p.resolve(body) : p.reject(body)
          return
        }
      }
    } catch {
      // ignore malformed messages
    }
  }

  ws.onclose = () => {
    rejectAllPending('Websocket closed')
    connectionState.value = 'error'
    ws = null
    scheduleReconnect()
  }

  ws.onerror = () => {
    // close handler does the cleanup
  }
}

/**
 * Disconnect and stop auto-reconnect.
 */
export function disconnect(): void {
  intentionalClose = true
  if (reconnectTimer !== null) {
    clearTimeout(reconnectTimer)
    reconnectTimer = null
  }
  rejectAllPending('Disconnected')
  ws?.close(1000, 'Page unload')
  ws = null
  connectionState.value = 'disconnected'
  config.value = null
}

function isOpen(): boolean {
  return !!ws && ws.readyState === WebSocket.OPEN
}

/* Responses carry no sequence number: they are matched by command name.
 * Commands of DIFFERENT names run in parallel; a request of a given name
 * waits for the previous same-name request to settle first, so at most
 * one request per name is ever in flight and responses can never be
 * matched by the wrong pending entry. (A single global FIFO would let
 * the meter/spectrum polling starve interactive commands.) */
const lanes = new Map<string, Promise<unknown>>()

/**
 * Send a command and wait for the matching response. Same-name requests
 * are serialized per command; different commands may interleave.
 *
 * Use object form, including {"Cmd": null} for valueless commands. The
 * daemon also accepts correctly JSON-quoted strings for those commands.
 */
export function request<T = any>(command: string, value?: unknown): Promise<T> {
  const run = () =>
    new Promise<T>((resolve, reject) => {
      if (!isOpen()) {
        reject(new Error('Websocket is not connected'))
        return
      }
      const seq = nextSeq()
      const timer = setTimeout(() => {
        pending.delete(seq)
        reject(new Error(`${command} timed out`))
      }, 5000)
      pending.set(seq, { command, resolve, reject, timer })
      ws!.send(JSON.stringify({ [command]: value ?? null }))
    })

  const prev = lanes.get(command) ?? Promise.resolve()
  const serialized = prev.then(run, run)
  /* keep the lane alive when a request rejects */
  lanes.set(command, serialized.catch(() => {}))
  return serialized
}

/**
 * Download the currently running config from CamillaDSP.
 */
export async function downloadConfig(): Promise<CamillaDSPConfig | null> {
  const body = await request<any>('GetConfigJson')
  const value = typeof body.value === 'string' ? JSON.parse(body.value) : body.value
  config.value = value
  return value
}

/**
 * Upload a config to CamillaDSP and re-download the confirmed result.
 */
export async function uploadConfig(next: CamillaDSPConfig): Promise<boolean> {
  await request('SetConfigJson', JSON.stringify(next))
  const confirmed = await downloadConfig()
  return !!confirmed
}

// ─── Spectrum (dante daemon extension commands) ─────────────────────────────

/**
 * Enable/disable the daemon spectrum pipeline.
 */
export async function setSpectrumEnabled(on: boolean): Promise<void> {
  await request('SetSpectrumEnabled', on)
}

/**
 * Select which signal tap feeds the spectrum (capture = pre-EQ, playback = post-EQ).
 */
export async function setSpectrumTap(tap: SpectrumTap): Promise<void> {
  spectrumTap = tap
  if (!isOpen()) return
  try {
    await request('SetSpectrumChannel', [tap, 0])
  } catch (e: any) {
    console.warn('Unable to select FFT tap:', e?.value ?? e)
  }
}

/**
 * Number of log-spaced output buckets the analyzer returns (8..256).
 */
export async function setSpectrumBins(n: number): Promise<void> {
  try {
    await request('SetSpectrumBins', n)
  } catch (e: any) {
    console.warn('Unable to set spectrum bins:', e?.value ?? e)
  }
}

/**
 * FFT size (1024..8192). Derived from the sample rate: smallest power of
 * two with sr/fft <= 15 Hz base target (44.1/48k -> 4096, 96k -> 8192) so
 * the first bin covers the 10 Hz start of the display axis on all FS.
 */
export async function setSpectrumFftSize(n: number): Promise<void> {
  try {
    await request('SetSpectrumFftSize', n)
  } catch (e: any) {
    console.warn('Unable to set spectrum FFT size:', e?.value ?? e)
  }
}

export function fftForSampleRate(sr: number): number {
  let fft = 1024
  while (fft < 8192 && sr / fft > 15) fft *= 2
  return fft
}

/**
 * Analyzer update interval in ms (50..1000; 50 = 20 Hz).
 */
export async function setSpectrumInterval(ms: number): Promise<void> {
  try {
    await request('SetSpectrumInterval', ms)
  } catch (e: any) {
    console.warn('Unable to set spectrum interval:', e?.value ?? e)
  }
}

/**
 * Daemon-side EMA smoothing factor (0..0.99). RTA mode uses a lower factor
 * (0.45): at the default 0.7 the transients are crushed and the bars read
 * as a slow average.
 */
export async function setSpectrumSmoothing(factor: number): Promise<void> {
  try {
    await request('SetSpectrumSmoothing', factor)
  } catch (e: any) {
    console.warn('Unable to set spectrum smoothing:', e?.value ?? e)
  }
}

/**
 * One analyzer tap as served by GetSpectrumLevels: the smoothed levels
 * plus the LOG-SPACED bin center frequencies the daemon computed them
 * for (needed to place the bins on the log axis of the plot) and the
 * DSP sample rate.
 */
export interface SpectrumTapData {
  levels: number[] | null
  frequencies: number[]
  samplerate: number
}

/**
 * Fetch the latest spectrum frame (levels + bin frequencies) for the
 * selected tap.
 */
export async function getSpectrumTap(): Promise<SpectrumTapData | null> {
  const body = await request<any>('GetSpectrumLevels')
  const tap = body?.value?.[spectrumTap]
  if (!tap) return null
  return {
    levels: Array.isArray(tap.levels) ? tap.levels : null,
    frequencies: Array.isArray(tap.frequencies) ? tap.frequencies : [],
    samplerate: Number(tap.samplerate) || 0,
  }
}

/**
 * SpectrumSource adapter handed to the spectrum viz controller.
 */
export function getSpectrumSource(): SpectrumSource {
  return {
    isSpectrumSocketOpen: () => isOpen(),
    getSpectrumData: () => getSpectrumTap(),
  }
}

/**
 * True when the websocket is open.
 */
export function isConnected(): boolean {
  return isOpen()
}
