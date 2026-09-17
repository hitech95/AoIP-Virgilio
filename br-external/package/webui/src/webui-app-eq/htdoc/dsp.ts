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
    if (connectionState.value !== 'connecting') connectionState.value = 'error'
    else connectionState.value = 'error'
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

/**
 * Send a command and wait for the matching response.
 * Serialized through a promise chain so responses cannot interleave.
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
      ws!.send(JSON.stringify(value === undefined ? command : { [command]: value }))
    })

  return run()
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
  if (on) {
    await request('SetSpectrumInterval', 100)
    await setSpectrumTap(spectrumTap)
  }
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
 * Fetch the latest spectrum levels (dBFS array) for the selected tap.
 */
export async function getSpectrumLevels(): Promise<number[] | null> {
  const body = await request<any>('GetSpectrumLevels')
  return body?.value?.[spectrumTap]?.levels ?? null
}

/**
 * SpectrumSource adapter handed to the spectrum viz controller.
 */
export function getSpectrumSource(): SpectrumSource {
  return {
    isSpectrumSocketOpen: () => isOpen(),
    getSpectrumData: () => getSpectrumLevels(),
  }
}

/**
 * True when the websocket is open.
 */
export function isConnected(): boolean {
  return isOpen()
}
