import { useEffect, useRef } from 'react'

/**
 * Escape closes only the topmost dismissible.
 *
 * Each overlay used to attach its own document keydown listener, so a sheet
 * opened inside another sheet dismissed both at once: the listeners sit on the
 * same node, so neither stopPropagation nor phase ordering separates them.
 * Ownership has to be explicit, so open dismissibles register on one stack in
 * mount order and only the last one reacts.
 */
const stack: Array<{ dismiss: () => void }> = []

let listening = false

function handleKey(event: KeyboardEvent) {
  if (event.key !== 'Escape') return
  const top = stack[stack.length - 1]
  if (!top) return
  event.stopPropagation()
  top.dismiss()
}

export function useEscapeDismiss(isOpen: boolean, onDismiss: () => void): void {
  // Held in a ref so a re-rendered callback doesn't pop and re-push the entry,
  // which would silently promote this dismissible above the one actually on top.
  // Written in an effect, not during render; Escape only arrives from user input,
  // long after effects have flushed.
  const onDismissRef = useRef(onDismiss)
  useEffect(() => {
    onDismissRef.current = onDismiss
  }, [onDismiss])

  useEffect(() => {
    if (!isOpen) return

    const entry = { dismiss: () => onDismissRef.current() }
    stack.push(entry)

    if (!listening) {
      document.addEventListener('keydown', handleKey)
      listening = true
    }

    return () => {
      const index = stack.lastIndexOf(entry)
      if (index !== -1) stack.splice(index, 1)
      if (stack.length === 0 && listening) {
        document.removeEventListener('keydown', handleKey)
        listening = false
      }
    }
  }, [isOpen])
}
