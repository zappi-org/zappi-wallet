/**
 * iOS scrolls the layout viewport upward to keep a focused input above the
 * software keyboard — overflow:hidden on the shell does not stop it. WebKit
 * performs a restore scroll when the keyboard closes, but SKIPS it when the
 * focused element unmounted first (exactly what bottom-sheet editors do), so
 * the whole document stays shifted up and every screen shows a dead band at
 * the bottom until something else scrolls.
 *
 * The shell owns all scrolling internally, so the window scroll position must
 * always be 0 — snap it back whenever the viewport regrows (keyboard closed)
 * or the page resurfaces (relaunch / app switch).
 */
export function installViewportScrollRestore(): void {
  if (typeof window === 'undefined') return

  const reset = () => {
    if (window.scrollY !== 0 || window.scrollX !== 0) window.scrollTo(0, 0)
    const scroller = document.scrollingElement
    if (scroller && (scroller.scrollTop !== 0 || scroller.scrollLeft !== 0)) {
      scroller.scrollTop = 0
      scroller.scrollLeft = 0
    }
  }
  // iOS settles the viewport a beat after the keyboard animation — run once
  // now and once after it finishes, so a late shift is also caught.
  const settle = () => {
    reset()
    window.setTimeout(reset, 250)
  }

  const vv = window.visualViewport
  if (vv) {
    let lastHeight = vv.height
    vv.addEventListener('resize', () => {
      if (vv.height > lastHeight) settle()
      lastHeight = vv.height
    })
  }
  window.addEventListener('pageshow', settle)
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') settle()
  })
}
