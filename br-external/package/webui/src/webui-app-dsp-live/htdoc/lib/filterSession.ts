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

export function sessionDisable(name: string, stepIndex: number, def: any): void {
  const s = loadSession()
  s[name] = { stepIndex, def }
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
    /* user_slot_* anchors are structural: they are never legitimate
     * session entries. Purge them (stale state from older builds)
     * instead of stripping them from the config, which the manifest
     * would reject ("placeholder missing"). Entries without a def are
     * corrupt/unrecoverable (older builds clobbered them) -- purge. */
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
