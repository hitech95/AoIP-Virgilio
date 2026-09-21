/**
 * Disabled filters overlay
 * UI-only state tracking which filters are temporarily disabled (removed from pipeline)
 * Persists in localStorage to survive reconnect/browser reload
 * (ported from CamillaEQ src/lib/disabledFiltersOverlay.ts; storage key scoped to dante)
 */

const STORAGE_KEY = 'dante.eq.disabledFilters'
const STORAGE_VERSION = 2

export interface DisabledFilterLocation {
  stepKey: string // Stable identifier for the Filter step (channels + original index)
  index: number // Position within that step's names array
  filterName: string
}

export interface DisabledFiltersState {
  version: number
  disabled: Record<string, DisabledFilterLocation[]>
}

/**
 * Generate stable step key from Filter step properties
 * Format: "Filter:ch0,1:idx2" (channels sorted, original pipeline index)
 */
export function getStepKey(channels: number[], stepIndex: number): string {
  const sortedCh = [...channels].sort((a, b) => a - b).join(',')
  return `Filter:ch${sortedCh}:idx${stepIndex}`
}

/**
 * Load disabled filters state from localStorage with migration
 */
export function loadDisabledFilters(): DisabledFiltersState {
  try {
    const stored = localStorage.getItem(STORAGE_KEY)
    if (!stored) {
      return { version: STORAGE_VERSION, disabled: {} }
    }

    const parsed = JSON.parse(stored)

    // Version 1 -> Version 2 migration
    if (parsed.version === 1) {
      const migratedDisabled: Record<string, DisabledFilterLocation[]> = {}

      for (const [filterName, location] of Object.entries(parsed.disabled)) {
        migratedDisabled[filterName] = [location as DisabledFilterLocation]
      }

      const migrated: DisabledFiltersState = {
        version: STORAGE_VERSION,
        disabled: migratedDisabled,
      }

      saveDisabledFilters(migrated)
      return migrated
    }

    if (parsed.version !== STORAGE_VERSION) {
      console.warn('Disabled filters state version mismatch, resetting')
      return { version: STORAGE_VERSION, disabled: {} }
    }

    return parsed
  } catch (error) {
    console.error('Error loading disabled filters:', error)
    return { version: STORAGE_VERSION, disabled: {} }
  }
}

/**
 * Save disabled filters state to localStorage
 */
export function saveDisabledFilters(state: DisabledFiltersState): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state))
  } catch (error) {
    console.error('Error saving disabled filters:', error)
  }
}

/**
 * Clear all disabled filters
 */
export function clearDisabledFilters(): void {
  try {
    localStorage.removeItem(STORAGE_KEY)
  } catch (error) {
    console.error('Error clearing disabled filters:', error)
  }
}

/**
 * Mark filter as disabled (adds to location list)
 */
export function markFilterDisabled(filterName: string, stepKey: string, index: number): void {
  const state = loadDisabledFilters()

  const location: DisabledFilterLocation = {
    stepKey,
    index,
    filterName,
  }

  if (!state.disabled[filterName]) {
    state.disabled[filterName] = []
  }

  const existing = state.disabled[filterName].find((loc) => loc.stepKey === stepKey)
  if (existing) {
    existing.index = index
  } else {
    state.disabled[filterName].push(location)
  }

  saveDisabledFilters(state)
}

/**
 * Mark filter as enabled globally (remove all locations from disabled list)
 */
export function markFilterEnabled(filterName: string): void {
  const state = loadDisabledFilters()
  delete state.disabled[filterName]
  saveDisabledFilters(state)
}

/**
 * Mark filter as enabled for a specific step (remove that step's location only)
 */
export function markFilterEnabledForStep(filterName: string, stepKey: string): void {
  const state = loadDisabledFilters()

  const locations = state.disabled[filterName]
  if (!locations) {
    return
  }

  state.disabled[filterName] = locations.filter((loc) => loc.stepKey !== stepKey)

  if (state.disabled[filterName].length === 0) {
    delete state.disabled[filterName]
  }

  saveDisabledFilters(state)
}

/**
 * Check if filter is disabled (in any step)
 */
export function isFilterDisabled(filterName: string): boolean {
  const state = loadDisabledFilters()
  return filterName in state.disabled && state.disabled[filterName].length > 0
}

/**
 * Get all disabled filters for a given step
 */
export function getDisabledFiltersForStep(stepKey: string): DisabledFilterLocation[] {
  const state = loadDisabledFilters()

  const result: DisabledFilterLocation[] = []

  for (const locations of Object.values(state.disabled)) {
    for (const loc of locations) {
      if (loc.stepKey === stepKey) {
        result.push(loc)
      }
    }
  }

  return result.sort((a, b) => a.index - b.index)
}

/**
 * Get all disabled filter locations (if disabled)
 */
export function getDisabledFilterLocations(filterName: string): DisabledFilterLocation[] {
  const state = loadDisabledFilters()
  return state.disabled[filterName] || []
}

/**
 * Remove all disabled filter locations for a specific step
 */
export function removeDisabledLocationsForStep(stepKey: string): void {
  const state = loadDisabledFilters()
  const updated: Record<string, DisabledFilterLocation[]> = {}

  for (const [filterName, locations] of Object.entries(state.disabled)) {
    const filtered = locations.filter((loc) => loc.stepKey !== stepKey)
    if (filtered.length > 0) {
      updated[filterName] = filtered
    }
  }

  state.disabled = updated
  saveDisabledFilters(state)
}

/**
 * Remap disabled filter step indices after pipeline reorder
 */
export function remapDisabledFiltersAfterPipelineReorder(fromIndex: number, toIndex: number): void {
  if (fromIndex === toIndex) {
    return
  }

  const state = loadDisabledFilters()
  const updated: Record<string, DisabledFilterLocation[]> = {}

  const computeNewIndex = (oldIndex: number): number => {
    if (oldIndex === fromIndex) {
      return toIndex
    } else if (fromIndex < toIndex) {
      if (oldIndex > fromIndex && oldIndex <= toIndex) {
        return oldIndex - 1
      }
    } else {
      if (oldIndex >= toIndex && oldIndex < fromIndex) {
        return oldIndex + 1
      }
    }
    return oldIndex
  }

  for (const [filterName, locations] of Object.entries(state.disabled)) {
    updated[filterName] = locations.map((location) => {
      const match = location.stepKey.match(/^Filter:ch(.+):idx(\d+)$/)
      if (!match) {
        return location
      }

      const channels = match[1]
      const oldStepIndex = parseInt(match[2], 10)
      const newStepIndex = computeNewIndex(oldStepIndex)

      const newStepKey = `Filter:ch${channels}:idx${newStepIndex}`

      return { ...location, stepKey: newStepKey }
    })
  }

  state.disabled = updated
  saveDisabledFilters(state)
}

/**
 * Remap disabled filter step key after Filter step channels change
 */
export function remapDisabledFiltersAfterFilterStepChannelsChange(
  oldStepKey: string,
  newStepKey: string
): void {
  if (oldStepKey === newStepKey) {
    return
  }

  const state = loadDisabledFilters()
  const updated: Record<string, DisabledFilterLocation[]> = {}

  for (const [filterName, locations] of Object.entries(state.disabled)) {
    updated[filterName] = locations.map((location) => {
      if (location.stepKey === oldStepKey) {
        return { ...location, stepKey: newStepKey }
      }
      return location
    })
  }

  state.disabled = updated
  saveDisabledFilters(state)
}
