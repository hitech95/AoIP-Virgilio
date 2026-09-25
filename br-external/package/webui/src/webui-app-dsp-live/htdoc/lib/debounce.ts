

export function debounceCancelable<T extends (...args: any[]) => void>(
  func: T,
  wait: number
): {
  call: (...args: Parameters<T>) => void
  cancel: () => void
  flush: () => void
} {
  let timeoutId: ReturnType<typeof setTimeout> | null = null
  let lastArgs: Parameters<T> | null = null

  function cancel() {
    if (timeoutId !== null) {
      clearTimeout(timeoutId)
      timeoutId = null
      lastArgs = null
    }
  }

  function flush() {
    if (timeoutId !== null && lastArgs !== null) {
      clearTimeout(timeoutId)
      func(...lastArgs)
      timeoutId = null
      lastArgs = null
    }
  }

  function call(...args: Parameters<T>) {
    lastArgs = args

    if (timeoutId !== null) {
      clearTimeout(timeoutId)
    }

    timeoutId = setTimeout(() => {
      if (lastArgs !== null) {
        func(...lastArgs)
      }
      timeoutId = null
      lastArgs = null
    }, wait)
  }

  return { call, cancel, flush }
}
