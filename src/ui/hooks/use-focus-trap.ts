import { useCallback, useLayoutEffect, useRef, type RefObject } from 'react'

/**
 * Keyboard focus stays inside the topmost open dialog.
 *
 * Same shape as useEscapeDismiss, for the same reason: several dialogs can be
 * open at once (a filter sheet inside the history overlay), and only the last
 * one opened may own the keyboard. Per-dialog Tab listeners would all sit on
 * the same node and fight, so ownership is explicit — open dialogs register on
 * one stack in mount order and only the last one reacts.
 */
const stack: Array<{ container: () => HTMLElement | null }> = []

let listening = false

const FOCUSABLE_SELECTOR = [
  'a[href]',
  'area[href]',
  'button:not([disabled])',
  'input:not([disabled]):not([type="hidden"])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  'audio[controls]',
  'video[controls]',
  '[contenteditable]:not([contenteditable="false"])',
  '[tabindex]',
].join(',')

function focusablesWithin(container: HTMLElement): HTMLElement[] {
  return Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter(
    (element) => element.tabIndex >= 0 && !element.closest('[inert],[hidden]'),
  )
}

function handleKeyDown(event: KeyboardEvent) {
  if (event.key !== 'Tab') return
  const container = stack[stack.length - 1]?.container()
  if (!container) return

  const focusables = focusablesWithin(container)

  // Nothing to land on: hold the caret on the dialog rather than let Tab walk out.
  if (focusables.length === 0) {
    event.preventDefault()
    container.focus()
    return
  }

  const first = focusables[0]
  const last = focusables[focusables.length - 1]
  const active = document.activeElement

  // The dialog element itself holds focus right after opening, and Shift+Tab
  // from a container is a step to whatever precedes it in the document.
  if (!(active instanceof HTMLElement) || active === container || !container.contains(active)) {
    event.preventDefault()
    ;(event.shiftKey ? last : first).focus()
    return
  }

  if (event.shiftKey ? active === first : active === last) {
    event.preventDefault()
    ;(event.shiftKey ? last : first).focus()
  }
}

/**
 * Everything outside the dialog becomes `inert` while it is open.
 *
 * `inert` over `aria-hidden`: one attribute drops a subtree out of the tab
 * order, the accessibility tree and pointer events at once, whereas
 * `aria-hidden` hides background controls from screen readers while leaving
 * them focusable — the very state this fixes. It is Baseline-supported on the
 * browsers Vite's default target covers, iOS Safari 15.5+ included, and the Tab
 * handler above still contains the keyboard where it is missing.
 *
 * The dialogs here are not portalled, so "outside" is every sibling along the
 * ancestor chain; the path itself has to stay live or the dialog goes with it.
 * A snapshot, not an observer: an overlay that mounts later is deliberately
 * left alone, since it opened on top of this one.
 *
 * Refcounted per element, because nested dialogs overlap on the same ancestor
 * siblings and do not always close innermost-first — a drag on the outer sheet
 * dismisses it while the inner one is still open. Restoring each dialog's own
 * snapshot would then let the outer's `null` clear the attribute and the inner's
 * `''` put it back for good, leaving the whole app inert until a reload.
 */
const inertHolds = new Map<HTMLElement, { count: number; previous: string | null }>()

function holdInert(element: HTMLElement): void {
  const held = inertHolds.get(element)
  if (held) {
    held.count += 1
    return
  }
  inertHolds.set(element, { count: 1, previous: element.getAttribute('inert') })
  element.setAttribute('inert', '')
}

function releaseInert(element: HTMLElement): void {
  const held = inertHolds.get(element)
  if (!held) return
  held.count -= 1
  if (held.count > 0) return
  inertHolds.delete(element)
  if (held.previous === null) element.removeAttribute('inert')
  else element.setAttribute('inert', held.previous)
}

function hideOutside(container: HTMLElement, keepLive: HTMLElement | null): () => void {
  const held: HTMLElement[] = []

  let node: HTMLElement = container
  while (node !== document.body && node.parentElement) {
    for (const sibling of Array.from(node.parentElement.children)) {
      if (!(sibling instanceof HTMLElement)) continue
      if (sibling === node || sibling === keepLive) continue

      holdInert(sibling)
      held.push(sibling)
    }
    node = node.parentElement
  }

  return () => {
    for (const element of held) releaseInert(element)
  }
}

export interface FocusTrap {
  /** Wire to the dialog's `onAnimationComplete`: moves focus in once it has settled. */
  onEntryComplete: () => void
  /** Wire to `AnimatePresence`'s `onExitComplete`: hands focus back to the opener. */
  restoreFocus: () => void
}

/**
 * @param containerRef the dialog surface; must be focusable (`tabIndex={-1}`).
 * @param keepLiveRef a node outside the dialog that must stay interactive —
 *   the backdrop, whose tap-to-dismiss `inert` would otherwise swallow.
 */
export function useFocusTrap(
  isOpen: boolean,
  containerRef: RefObject<HTMLElement | null>,
  keepLiveRef?: RefObject<HTMLElement | null>,
): FocusTrap {
  const openerRef = useRef<HTMLElement | null>(null)
  const enteredRef = useRef(false)

  // Layout, not passive: the opener has to be read in the commit that opens the
  // dialog, before any passive effect below can move focus, and the background
  // is better inert before the frame that first paints the dialog.
  useLayoutEffect(() => {
    if (!isOpen) return

    const container = containerRef.current

    // Recorded on open, not on the enter animation's completion: motion fires
    // onAnimationComplete for the exit too, so the opener was overwritten with
    // the dialog itself and the restore then focused a node about to unmount.
    // Anything already inside the dialog (an autofocused field) is not an opener.
    const active = document.activeElement
    const opener =
      active instanceof HTMLElement && active !== document.body && !container?.contains(active)
        ? active
        : null
    openerRef.current = opener
    enteredRef.current = false

    if (!container) return

    const entry = { container: () => containerRef.current }
    stack.push(entry)

    if (!listening) {
      // Capture phase: a control inside the dialog that stops keydown
      // propagation must not be able to disown the trap.
      document.addEventListener('keydown', handleKeyDown, true)
      listening = true
    }

    // Released as soon as the dialog closes rather than after its exit
    // animation, because focus cannot be handed back to an inert opener.
    const showOutside = hideOutside(container, keepLiveRef?.current ?? null)

    return () => {
      showOutside()
      const index = stack.lastIndexOf(entry)
      if (index !== -1) stack.splice(index, 1)
      if (stack.length === 0 && listening) {
        document.removeEventListener('keydown', handleKeyDown, true)
        listening = false
      }
    }
  }, [isOpen, containerRef, keepLiveRef])

  const onEntryComplete = useCallback(() => {
    // onAnimationComplete also fires on exit and after a drag settles; only the
    // first completion of an open dialog may pull focus, or a drag would steal
    // it back from whatever the user was typing in.
    if (!isOpen || enteredRef.current) return
    enteredRef.current = true
    containerRef.current?.focus()
  }, [isOpen, containerRef])

  const restoreFocus = useCallback(() => {
    openerRef.current?.focus()
    openerRef.current = null
  }, [])

  return { onEntryComplete, restoreFocus }
}
