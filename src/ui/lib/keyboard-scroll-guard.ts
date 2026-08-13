/**
 * iOS pans the layout viewport to reveal a focused input above the software
 * keyboard (WebKit 191204) and can leave it panned after the keyboard closes,
 * shifting the whole shell up. The shell document is not scrollable, so the
 * window scroll position must always be 0 — re-seat it after focus leaves an
 * editable element, and never while one still has focus (input-to-input moves
 * fire focusout before the next focusin).
 */
export function installKeyboardScrollGuard(): void {
  if (typeof window === 'undefined') return

  const editableHasFocus = (): boolean => {
    const el = document.activeElement
    if (!el) return false
    return (
      el.tagName === 'INPUT' ||
      el.tagName === 'TEXTAREA' ||
      (el as HTMLElement).isContentEditable === true
    )
  }

  const reset = () => {
    if (editableHasFocus()) return
    const vv = window.visualViewport
    const panned = window.scrollY !== 0 || (vv ? vv.pageTop > 0.5 : false)
    if (panned) window.scrollTo(0, 0)
  }

  // iOS settles the viewport a beat after the keyboard close animation.
  window.addEventListener('focusout', () => {
    window.setTimeout(reset, 250)
    window.setTimeout(reset, 600)
  })
}
