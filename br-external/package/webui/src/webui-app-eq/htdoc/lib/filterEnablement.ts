/**
 * Filter enablement operations, scoped to a single Filter step.
 *
 * dante distinction: CamillaEQ mutes a filter everywhere in the pipeline; here
 * mute/unmute only affects the block being edited. Other blocks keep the filter
 * untouched.
 */

import type { CamillaDSPConfig } from './camillaTypes'
import { normalizePipelineStep } from './camillaTypes'
import {
  markFilterDisabled,
  getStepKey,
  getDisabledFilterLocations,
  getDisabledFiltersForStep,
  markFilterEnabledForStep,
} from './disabledFiltersOverlay'

function getStep(
  config: CamillaDSPConfig,
  stepIndex: number
): { names: string[]; stepKey: string } | null {
  const step = normalizePipelineStep(config.pipeline?.[stepIndex])
  if (!step || step.type !== 'Filter' || !step.channels) return null
  return { names: step.names || [], stepKey: getStepKey(step.channels, stepIndex) }
}

/**
 * Disable (mute) a filter within one Filter step.
 * Removes filterName from that step's names[] and records the original
 * position in the overlay so enable can restore it exactly.
 */
export function disableFilterInStep(
  config: CamillaDSPConfig,
  filterName: string,
  stepIndex: number
): CamillaDSPConfig {
  const updated = JSON.parse(JSON.stringify(config)) as CamillaDSPConfig
  const step = getStep(updated, stepIndex)
  if (!step) return updated

  const index = step.names.indexOf(filterName)
  if (index === -1) {
    return updated // Not enabled in this step
  }

  // Reconstruct the full ordered name list (enabled names + disabled-at-
  // original-positions) to find the correct original index of filterName.
  const alreadyDisabled = getDisabledFiltersForStep(step.stepKey)
  const fullNames: string[] = [...step.names]
  for (const loc of alreadyDisabled) {
    const insertIdx = Math.max(0, Math.min(fullNames.length, loc.index))
    fullNames.splice(insertIdx, 0, loc.filterName)
  }
  const originalIndex = fullNames.indexOf(filterName)

  step.names.splice(index, 1)
  ;(updated.pipeline![stepIndex] as any).names = step.names

  markFilterDisabled(filterName, step.stepKey, originalIndex)

  return updated
}

/**
 * Enable (unmute) a filter within one Filter step.
 * Restores the filter at its original position in that step's names[].
 */
export function enableFilterInStep(
  config: CamillaDSPConfig,
  filterName: string,
  stepIndex: number
): CamillaDSPConfig {
  const updated = JSON.parse(JSON.stringify(config)) as CamillaDSPConfig
  const step = getStep(updated, stepIndex)
  if (!step) return updated

  const location = getDisabledFilterLocations(filterName).find(
    (loc) => loc.stepKey === step.stepKey
  )
  if (!location) {
    return updated // Not disabled in this step
  }

  // Subtract the gaps of OTHER filters in this step that are still disabled
  // with an original index before this one.
  const disabledBefore = getDisabledFiltersForStep(step.stepKey).filter(
    (loc) => loc.filterName !== filterName && loc.index < location.index
  ).length
  const insertIndex = Math.max(0, Math.min(step.names.length, location.index - disabledBefore))
  step.names.splice(insertIndex, 0, filterName)
  ;(updated.pipeline![stepIndex] as any).names = step.names

  markFilterEnabledForStep(filterName, step.stepKey)

  return updated
}
