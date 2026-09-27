/**
 * VizLayoutManager: Responsive collapse/expand logic for viz-options groups
 *
 * Manages which visualization option groups are expanded in the horizontal
 * strip, based on available space and user interaction. Layout DECISIONS
 * only: the outcome is written to the reactive vizAccordionState, and the
 * VizSection components render it. The manager never touches the DOM
 * (a Vue patch would wipe manager-added classes).
 * (ported from CamillaEQ src/pages/eq/vizOptions/vizLayoutManager.ts)
 */

import { vizAccordionState } from './vizAccordion'

export interface VizGroup {
  id: string
  priority: number
  expandedWidth: number
}

export interface VizLayoutManagerOptions {
  stubWidth?: number
}

export class VizLayoutManager {
  private host: HTMLElement
  private viewport: HTMLElement
  private strip: HTMLElement
  private groups: VizGroup[]
  private S: number // stub width
  private capExpandedCount: number
  private userChosen: Set<string>
  private lastUser: string | null
  private ro: ResizeObserver
  private _t: number | null = null

  constructor(
    hostEl: HTMLElement,
    viewportEl: HTMLElement,
    stripEl: HTMLElement,
    groups: VizGroup[],
    opts: VizLayoutManagerOptions = {}
  ) {
    this.host = hostEl
    this.viewport = viewportEl
    this.strip = stripEl
    this.groups = groups

    this.S = opts.stubWidth ?? 44
    this.capExpandedCount = this.N(groups)

    this.userChosen = new Set()
    this.lastUser = null

    this.strip.style.minWidth = this.minScrollWidth() + 'px'

    this.ro = new ResizeObserver(() => this.scheduleLayout())
    this.ro.observe(hostEl)

    this.viewport.addEventListener('scroll', () => this.updateOverflowAffordances())
    this.layout(true)
    this.updateOverflowAffordances()
  }

  private N(groups: VizGroup[]): number {
    return groups.length
  }

  minScrollWidth(): number {
    const maxWi = Math.max(...this.groups.map((g) => g.expandedWidth))
    return (this.groups.length - 1) * this.S + maxWi
  }

  scheduleLayout() {
    if (this._t !== null) clearTimeout(this._t)
    this._t = window.setTimeout(() => {
      this.layout(false)
      this.updateOverflowAffordances()
    }, 30)
  }

  availableWidth() {
    return this.host.clientWidth
  }

  constrained() {
    return this.availableWidth() < this.minScrollWidth()
  }

  groupById(id: string): VizGroup | null {
    return this.groups.find((g) => g.id === id) ?? null
  }

  sortedByPriorityAsc(list: VizGroup[]): VizGroup[] {
    return [...list].sort((a, b) => a.priority - b.priority)
  }

  totalWidthForExpandedSet(E: Set<string>): number {
    let total = this.groups.length * this.S
    for (const id of E) {
      const g = this.groupById(id)
      if (g) total += g.expandedWidth - this.S
    }
    return total
  }

  defaultExpandedSetResponsive(): Set<string> {
    const E = new Set<string>()
    const budget = this.availableWidth() - this.groups.length * this.S
    let used = 0
    for (const g of this.sortedByPriorityAsc(this.groups)) {
      if (E.size >= this.capExpandedCount) break
      const extra = g.expandedWidth - this.S
      if (used + extra <= budget) {
        E.add(g.id)
        used += extra
      }
    }
    if (E.size === 0) E.add(this.sortedByPriorityAsc(this.groups)[0].id)
    return E
  }

  evictUntilFits(E: Set<string>, protectId: string | null = null) {
    while (E.size > this.capExpandedCount) {
      const v = this.pickEvictionCandidate(E, protectId)
      if (!v) break
      E.delete(v.id)
      this.userChosen.delete(v.id)
      if (this.lastUser === v.id) this.lastUser = null
    }
    while (this.totalWidthForExpandedSet(E) > this.availableWidth()) {
      const v = this.pickEvictionCandidate(E, protectId)
      if (!v) break
      E.delete(v.id)
      this.userChosen.delete(v.id)
      if (this.lastUser === v.id) this.lastUser = null
    }
  }

  pickEvictionCandidate(E: Set<string>, protectId: string | null = null): VizGroup | null {
    const candidates = [...E]
      .map((id) => this.groupById(id))
      .filter((g): g is VizGroup => g !== null)
      .filter((g) => g.id !== protectId)
    if (!candidates.length) return null
    candidates.sort((a, b) => b.priority - a.priority)
    return candidates[0]
  }

  /** Called by the sections when their collapsed stub is activated. */
  toggleChoice(id: string) {
    const already = this.userChosen.has(id)
    if (already) {
      this.userChosen.delete(id)
      if (this.lastUser === id) this.lastUser = null
    } else {
      this.userChosen.add(id)
      this.lastUser = id
    }
    this.layout(false)
    const target = this.groupById(this.lastUser ?? id)
    if (target) requestAnimationFrame(() => this.scrollGroupIntoView(target))
  }

  expandedIdConstrained(): string {
    if (this.lastUser) return this.lastUser
    return this.sortedByPriorityAsc(this.groups)[0].id
  }

  layout(first: boolean) {
    const isCon = this.constrained()
    vizAccordionState.constrained = isCon

    if (isCon) {
      const id = this.expandedIdConstrained()
      const g = this.groupById(id) ?? this.sortedByPriorityAsc(this.groups)[0]
      vizAccordionState.expanded = [g.id]
      if (this._frozenId !== g.id || first) {
        this._frozenId = g.id
        requestAnimationFrame(() => this.scrollGroupIntoView(g))
      }
      return
    }

    let E = this.defaultExpandedSetResponsive()
    const orderedChosen: VizGroup[] = []
    if (this.lastUser) {
      const lu = this.groupById(this.lastUser)
      if (lu) orderedChosen.push(lu)
    }
    for (const g of this.sortedByPriorityAsc(
      [...this.userChosen]
        .map((id) => this.groupById(id))
        .filter((g): g is VizGroup => g !== null)
    )) {
      if (!orderedChosen.find((x) => x.id === g.id)) orderedChosen.push(g)
    }
    for (const cg of orderedChosen) {
      E.add(cg.id)
      this.evictUntilFits(E, this.lastUser ?? cg.id)
    }
    for (const g of this.sortedByPriorityAsc(this.groups)) {
      if (E.size >= this.capExpandedCount) break
      if (E.has(g.id)) continue
      const t = new Set(E)
      t.add(g.id)
      if (this.totalWidthForExpandedSet(t) <= this.availableWidth()) E = t
    }
    if (E.size === 0) E.add(this.sortedByPriorityAsc(this.groups)[0].id)
    vizAccordionState.expanded = [...E]
  }

  private _frozenId: string | null = null

  scrollGroupIntoView(group: VizGroup) {
    if (!this.viewport.classList.contains('constrained')) return
    const vp = this.viewport
    const el = this.strip.querySelector(`[data-group='${group.id}']`)
    if (!el) return
    const vpR = vp.getBoundingClientRect()
    const elR = el.getBoundingClientRect()
    if (elR.left >= vpR.left && elR.right <= vpR.right) return
    const ld = elR.left - vpR.left
    const rd = elR.right - vpR.right
    let t = vp.scrollLeft
    if (ld < 0) t += ld - 16
    else if (rd > 0) t += rd + 16
    vp.scrollTo({ left: t, behavior: 'smooth' })
  }

  updateOverflowAffordances() {
    const vp = this.viewport
    const hasOverflow = vizAccordionState.constrained && vp.scrollWidth > vp.clientWidth + 1
    vizAccordionState.hasLeftOverflow = hasOverflow && vp.scrollLeft > 2
    vizAccordionState.hasRightOverflow =
      hasOverflow && vp.scrollLeft < vp.scrollWidth - vp.clientWidth - 2
  }

  destroy() {
    this.ro.disconnect()
  }
}
