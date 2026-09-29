/**
 * Disabled-filter session (localStorage).
 *
 * camilladsp REJECTS configurations that keep unreferenced filter
 * definitions ("filter X is not used by any pipeline step"), so a
 * disabled filter cannot live in the running config at all: disabling
 * removes name AND definition from the live config, and the full
 * definition is preserved HERE for restore. On page load the session is
 * reconciled: entries whose filter is back in the config (another
 * client re-added it, or the disable upload was lost) are re-disabled
 * and the cleaned config is uploaded once.
 */

const KEY = 'dante.filterSession.v1'

export interface SessionEntry {
  /** pipeline index of the block the filter came from */
  stepIndex: number
  /** camilladsp filter definition (type/parameters), for restore */
  def: any
  /** original position per disabled step, so enable restores in place */
  positions?: Record<string, number>
}

/**
 * Stable key for a Filter step: "Filter:ch0,1:idxN" (channels sorted,
 * pipeline index). Positions are recorded per step key.
 */
export function getStepKey(channels: number[], stepIndex: number): string {
  const sortedCh = [...channels].sort((a, b) => a - b).join(',')
  return `Filter:ch${sortedCh}:idx${stepIndex}`
}

export type FilterSession = Record<string, SessionEntry>

export function loadSession(): FilterSession {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return {}
    const parsed = JSON.parse(raw)
    return parsed && typeof parsed === 'object' ? parsed : {}
  } catch {
    return {}
  }
}

export function saveSession(s: FilterSession): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(s))
  } catch {
    /* storage full/blocked: session is best-effort */
  }
}

export function sessionDisable(
  name: string,
  stepIndex: number,
  def: any,
  stepKey?: string,
  originalIndex?: number
): void {
  const s = loadSession()
  const prev = s[name]
  const entry: SessionEntry = {
    stepIndex: prev?.stepIndex ?? stepIndex,
    def: def ?? prev?.def,
    positions: { ...(prev?.positions ?? {}) },
  }
  if (stepKey && originalIndex !== undefined && originalIndex >= 0)
    entry.positions![stepKey] = originalIndex
  s[name] = entry
  saveSession(s)
}

/** Original index of the filter within a step, when disabled there. */
export function sessionPositionOf(name: string, stepKey: string): number | null {
  const positions = loadSession()[name]?.positions
  return positions && positions[stepKey] !== undefined ? positions[stepKey] : null
}

/**
 * The filter was re-enabled in one step: drop that position. When no
 * position remains the filter is fully back in the config -- forget it.
 */
export function sessionForgetStep(name: string, stepKey: string): void {
  const s = loadSession()
  const entry = s[name]
  if (!entry) return
  if (entry.positions && stepKey in entry.positions) delete entry.positions[stepKey]
  if (!entry.positions || Object.keys(entry.positions).length === 0) delete s[name]
  saveSession(s)
}

export function sessionForget(name: string): void {
  const s = loadSession()
  if (name in s) {
    delete s[name]
    saveSession(s)
  }
}

/** The filter type shown in restore UIs (biquad subtype when present). */
export function sessionTypeOf(entry: SessionEntry): string {
  const d = entry?.def
  if (!d) return '?'
  return d.type === 'Biquad' ? (d.parameters?.type ?? 'Biquad') : d.type
}

/**
 * Reconcile the session against a live config (mutates it): every
 * entry that is still present (name referenced or definition left
 * over) is fully removed -- camilladsp refuses orphaned definitions.
 * Returns the removed names; a non-empty list means the caller should
 * upload the cleaned config.
 */
export function reconcileSession(config: any): string[] {
  const s = loadSession()
  const removed: string[] = []
  let dirty = false

  for (const [name, info] of Object.entries(s)) {
    /* user_slot_* was the old placeholder-anchor convention: never a
     * legitimate session entry. Purge stale state from older builds
     * instead of stripping it from the config, which the manifest
     * would reject. Entries without a def are corrupt/unrecoverable
     * (older builds clobbered them) -- purge. */
    if (name.startsWith('user_slot_') || !info?.def) {
      delete s[name]
      dirty = true
      continue
    }

    let present = false

    if (config?.filters?.[name]) {
      delete config.filters[name]
      present = true
    }
    for (const st of config?.pipeline ?? []) {
      const names: string[] = st.names ?? []
      const i = names.indexOf(name)
      if (i >= 0) {
        names.splice(i, 1)
        present = true
        const idx = (config.pipeline ?? []).indexOf(st)
        if (idx >= 0 && idx !== info.stepIndex) info.stepIndex = idx
      }
    }

    if (present) {
      removed.push(name)
      dirty = true
    }
  }

  if (dirty) saveSession(s)
  return removed
}
