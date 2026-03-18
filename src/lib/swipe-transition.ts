/**
 * Module-level flag to coordinate swipe-back gesture with AnimatePresence.
 *
 * When a swipe gesture commits, the hook marks the flag before calling goBack().
 * MainApp reads it during render to skip PageTransition's enter animation,
 * then clears it in useLayoutEffect (before paint).
 */
let _active = false

export const swipeTransition = {
  mark() { _active = true },
  isActive() { return _active },
  clear() { _active = false },
}
