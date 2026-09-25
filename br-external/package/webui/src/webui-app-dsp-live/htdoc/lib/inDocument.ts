import { ref, onMounted, onBeforeUnmount, type Ref } from 'vue'

/**
 * true once the component's root element is attached to the document.
 *
 * The OUI shell mounts views into a detached container first; a
 * <Teleport> targeting a node INSIDE the view (like the Live page
 * toolbar row) fails at mount time with "Invalid Teleport target" --
 * the subtree is then silently never rendered. Gate such teleports on
 * this flag: v-if="inDoc && active".
 */
export function useInDocument(getEl: () => HTMLElement | null | undefined): Ref<boolean> {
  const inDoc = ref(false)
  let raf = 0

  const check = () => {
    const el = getEl()
    if (el && document.contains(el)) {
      inDoc.value = true
      return
    }
    raf = requestAnimationFrame(check)
  }

  onMounted(check)
  onBeforeUnmount(() => cancelAnimationFrame(raf))

  return inDoc
}
