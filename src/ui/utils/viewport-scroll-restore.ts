/**
 * iOS scrolls the layout viewport upward to keep a focused input above the
 * software keyboard — overflow:hidden on the shell does not stop it. WebKit
 * performs a restore scroll when the keyboard closes, but SKIPS it when the
 * focused element unmounted first (exactly what bottom-sheet editors do), so
 * the whole document stays shifted up and every screen shows a dead band at
 * the bottom until the user drags the page.
 *
 * In that stuck state window.scrollY often reads 0 while the visual viewport
 * is still offset (vv.pageTop > 0), so a plain scrollTo(0,0) is a no-op. Only
 * an ACTUAL scroll operation re-clamps the viewport — the same thing a manual
 * drag does — hence the 1px jog.
 */
export function installViewportScrollRestore(): void {
  if (typeof window === 'undefined') return

  const isStuck = (): boolean => {
    if (window.scrollY !== 0 || window.scrollX !== 0) return true
    const scroller = document.scrollingElement
    if (scroller && (scroller.scrollTop !== 0 || scroller.scrollLeft !== 0)) return true
    const vv = window.visualViewport
    // pageTop/offsetTop expose the displacement WebKit hides from scrollY.
    if (vv && (vv.pageTop > 0.5 || vv.offsetTop > 0.5)) return true
    return false
  }

  const reset = () => {
    if (!isStuck()) return
    window.scrollTo(0, 1)
    window.scrollTo(0, 0)
    const scroller = document.scrollingElement
    if (scroller) {
      scroller.scrollTop = 0
      scroller.scrollLeft = 0
    }
  }
  // iOS settles the viewport a beat after the keyboard animation — check
  // immediately and again after it finishes, so a late shift is also caught.
  const settle = () => {
    reset()
    window.setTimeout(reset, 250)
    window.setTimeout(reset, 600)
  }

  const vv = window.visualViewport
  if (vv) {
    let lastHeight = vv.height
    vv.addEventListener('resize', () => {
      if (vv.height > lastHeight) settle()
      lastHeight = vv.height
    })
  }
  // Keyboard dismissal without a viewport resize event (input unmounted):
  // the blur is the only signal left — check after the close animation.
  window.addEventListener('focusout', () => {
    window.setTimeout(reset, 350)
  })
  window.addEventListener('pageshow', settle)
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') settle()
  })
}
