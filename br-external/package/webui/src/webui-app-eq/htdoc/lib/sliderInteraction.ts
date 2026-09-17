/**
 * Element Plus sliders jump the thumb to wherever the runway is clicked.
 * The EQ faders must only move when the handle itself is dragged, so presses
 * anywhere else inside the slider are blocked (capture phase) before the
 * component sees them. Keyboard arrows and handle drags keep working.
 */
export function blockRunwayPointer(root: HTMLElement | null | undefined): () => void {
  if (!root) return () => {}

  const block = (event: Event) => {
    const target = event.target as HTMLElement | null
    if (target?.closest('.el-slider__button-wrapper')) return
    event.stopPropagation()
  }

  const types = ['pointerdown', 'mousedown', 'touchstart'] as const
  for (const type of types) {
    root.addEventListener(type, block, true)
  }

  return () => {
    for (const type of types) {
      root.removeEventListener(type, block, true)
    }
  }
}
