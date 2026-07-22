import { useEffect, useState } from 'react'

interface Readout {
  scrollY: number
  scrollerTop: number
  vvHeight: number
  vvPageTop: number
  vvOffsetTop: number
  innerHeight: number
  clientHeight: number
  screenHeight: number
  insetBottom: string
}

function read(): Readout {
  const vv = window.visualViewport
  const probe = getComputedStyle(document.documentElement).getPropertyValue('--safe-area-inset-bottom')
  return {
    scrollY: Math.round(window.scrollY * 10) / 10,
    scrollerTop: Math.round((document.scrollingElement?.scrollTop ?? 0) * 10) / 10,
    vvHeight: Math.round((vv?.height ?? 0) * 10) / 10,
    vvPageTop: Math.round((vv?.pageTop ?? 0) * 10) / 10,
    vvOffsetTop: Math.round((vv?.offsetTop ?? 0) * 10) / 10,
    innerHeight: window.innerHeight,
    clientHeight: document.documentElement.clientHeight,
    screenHeight: window.screen.height,
    insetBottom: probe.trim() || '(unset)',
  }
}

/**
 * DEV-only viewport instrument for chasing the iOS "dead band at the bottom"
 * state on device: every value that can explain a shifted/shrunk layout in
 * one glance, updated live. Screenshot this while the band is visible.
 */
export function ViewportDebugOverlay() {
  const [r, setR] = useState<Readout | null>(null)

  useEffect(() => {
    if (!import.meta.env.DEV) return
    const update = () => setR(read())
    update()
    const id = window.setInterval(update, 500)
    window.visualViewport?.addEventListener('resize', update)
    window.addEventListener('scroll', update, { passive: true })
    return () => {
      window.clearInterval(id)
      window.visualViewport?.removeEventListener('resize', update)
      window.removeEventListener('scroll', update)
    }
  }, [])

  if (!import.meta.env.DEV || !r) return null

  return (
    <div
      aria-hidden
      className="pointer-events-none fixed left-1 z-[9999] rounded bg-black/60 px-1.5 py-1 font-mono text-[9px] leading-tight text-white"
      style={{ top: 'calc(var(--safe-area-inset-top) + 4px)' }}
    >
      <div>sY {r.scrollY} · sT {r.scrollerTop}</div>
      <div>vv h{r.vvHeight} pT{r.vvPageTop} oT{r.vvOffsetTop}</div>
      <div>ih {r.innerHeight} · ch {r.clientHeight} · sh {r.screenHeight}</div>
      <div>insetB {r.insetBottom}</div>
    </div>
  )
}
