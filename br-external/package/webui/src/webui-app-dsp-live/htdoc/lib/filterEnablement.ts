/**
 * Filter enable/disable operations, scoped to a single Filter step.
 *
 * The filterSession store is the single source of truth: a disabled
 * filter's definition AND its original position(s) live there (the
 * running config cannot hold unreferenced definitions). These helpers
 * mutate a config and keep the session in sync, so every tab (EQ band
 * switches, the advanced block editor) shares one behavior.
 */

import type { CamillaDSPConfig } from './camillaTypes'
import { normalizePipelineStep } from './camillaTypes'
import { getStepKey, loadSession, sessionDisable, sessionForgetStep, sessionPositionOf } from './filterSession'

function getStep(
  config: CamillaDSPConfig,
  stepIndex: number
): { names: string[]; stepKey: string } | null {
  const step = normalizePipelineStep(config.pipeline?.[stepIndex])
  if (!step || step.type !== 'Filter' || !step.channels) return null
  return { names: step.names || [], stepKey: getStepKey(step.channels, stepIndex) }
}

/** Names disabled in a step, in their recorded original order. */
function disabledNamesFor(stepKey: string): Array<{ name: string; index: number }> {
  return Object.entries(loadSession())
    .filter(([, e]) => e.positions && e.positions[stepKey] !== undefined)
    .map(([name, e]) => ({ name, index: e.positions![stepKey] }))
}

/**
 * Disable (mute) a filter within one Filter step: removes the name from
 * the step, moves the definition into the session and records the
 * original position so enable restores it exactly.
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
  if (index === -1) return updated // not enabled in this step

  // Reconstruct the full ordered name list (enabled names + disabled-at-
  // original-positions) to find the correct original index of filterName.
  const fullNames: string[] = [...step.names]
  for (const loc of disabledNamesFor(step.stepKey)) {
    const insertIdx = Math.max(0, Math.min(fullNames.length, loc.index))
    fullNames.splice(insertIdx, 0, loc.name)
  }
  const originalIndex = fullNames.indexOf(filterName)

  step.names.splice(index, 1)
  ;(updated.pipeline![stepIndex] as any).names = step.names

  // camilladsp refuses unreferenced defs: the definition moves into the
  // session store; the orphan panel restores from there
  const def = updated.filters?.[filterName]
  if (updated.filters) delete updated.filters[filterName]
  sessionDisable(filterName, stepIndex, def, step.stepKey, originalIndex)

  return updated
}

/**
 * Enable (unmute) a filter within one Filter step: restores the
 * definition and re-inserts the name at its original position.
 */
export function enableFilterInStep(
  config: CamillaDSPConfig,
  filterName: string,
  stepIndex: number
): CamillaDSPConfig {
  const updated = JSON.parse(JSON.stringify(config)) as CamillaDSPConfig
  const step = getStep(updated, stepIndex)
  if (!step) return updated

  const def = loadSession()[filterName]?.def
  const position = sessionPositionOf(filterName, step.stepKey)

  if (!updated.filters) updated.filters = {}
  if (def && !updated.filters[filterName]) updated.filters[filterName] = def

  if (position === null) {
    // no record (stale / restored in another browser): still restore the
    // filter, appended at the end -- returning without re-adding the name
    // would orphan the definition and camilladsp rejects the whole config
    step.names.push(filterName)
  } else {
    // subtract the gaps of OTHER filters in this step still disabled
    // with an original index before this one
    const disabledBefore = disabledNamesFor(step.stepKey).filter(
      (loc) => loc.name !== filterName && loc.index < position
    ).length
    const insertIndex = Math.max(0, Math.min(step.names.length, position - disabledBefore))
    step.names.splice(insertIndex, 0, filterName)
  }
  ;(updated.pipeline![stepIndex] as any).names = step.names

  sessionForgetStep(filterName, step.stepKey)
  return updated
}
