/**
 * iOS standalone (home-screen) apps: WebKit flip-flops the dynamic viewport
 * height between the full screen (e.g. 896) and the reduced small-viewport
 * value (e.g. 852) across keyboard dismissals, relaunches and lock cycles —
 * measured on device via the viewport readout: scroll/pageTop stay 0, only
 * vv.height/innerHeight collapse while screen.height holds. An h-dvh shell
 * follows the lie, and the lost strip at the bottom is NOT renderable while
 * stuck, so no padding or repaint can cover it.
 *
 * The only exit is the one a manual drag performs: a REAL scroll operation
 * forces WebKit to re-evaluate the viewport. With an overflow-hidden shell
 * nothing is scrollable, so momentarily make the document 1px taller than the
 * screen, scroll 0→1→0, and restore — invisible to the user, same effect as
 * the drag.
 */
export function installViewportScrollRestore(): void {
  if (typeof window === 'undefined') return
  // Browser tabs legitimately run shorter than the screen (toolbars); the
  // full-screen invariant only holds for the installed standalone app.
  if (!window.matchMedia('(display-mode: standalone)').matches) return

  const keyboardLikelyOpen = (): boolean => {
    const el = document.activeElement
    if (!el) return false
    return (
      el.tagName === 'INPUT' ||
      el.tagName === 'TEXTAREA' ||
      (el as HTMLElement).isContentEditable === true
    )
  }

  const isStuck = (): boolean => {
    const height = window.visualViewport?.height ?? window.innerHeight
    return !keyboardLikelyOpen() && height < window.screen.height - 1
  }

  let busy = false
  const unstick = () => {
    if (busy || !isStuck()) return
    busy = true
    const root = document.documentElement
    const prevHeight = root.style.height
    root.style.height = `${window.screen.height + 1}px`
    requestAnimationFrame(() => {
      window.scrollTo(0, 1)
      window.scrollTo(0, 0)
      root.style.height = prevHeight
      busy = false
    })
  }

  // The collapse lands with (or shortly after) a viewport event, but iOS also
  // settles late after keyboard/app-switch animations — re-check on a tail.
  const settle = () => {
    unstick()
    window.setTimeout(unstick, 300)
    window.setTimeout(unstick, 800)
  }

  window.visualViewport?.addEventListener('resize', settle)
  window.addEventListener('focusout', () => window.setTimeout(settle, 300))
  window.addEventListener('pageshow', settle)
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') settle()
  })
}
