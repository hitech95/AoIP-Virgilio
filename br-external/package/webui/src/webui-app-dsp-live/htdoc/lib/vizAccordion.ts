/**
 * Reactive bridge between VizLayoutManager (layout decisions) and the
 * VizSection components (DOM ownership).
 *
 * The manager must never touch classList directly: the section roots are
 * Vue-rendered, and a Vue patch would wipe any class the manager added.
 * Instead the manager writes its decisions here and the sections bind
 * their expanded/constrained state from this store.
 */
import { reactive } from 'vue'

export const vizAccordionState = reactive({
  /** ids of the groups currently expanded */
  expanded: [] as string[],
  /** the strip is narrower than all groups expanded: stubs + one expanded */
  constrained: false,
  hasLeftOverflow: false,
  hasRightOverflow: false,
})

export function isGroupExpanded(groupId: string): boolean {
  return vizAccordionState.expanded.includes(groupId)
}
