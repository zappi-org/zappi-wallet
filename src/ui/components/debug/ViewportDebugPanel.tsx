import { useEffect, useMemo, useState } from 'react'

interface ViewportDebugPanelProps {
  onClose: () => void
}

interface ViewportSnapshot {
  standalone: boolean
  navigatorStandalone: boolean
  innerHeight: number
  outerHeight: number
  clientHeight: number
  bodyHeight: number
  rootHeight: number
  visualViewportHeight: number | null
  visualViewportOffsetTop: number | null
  safeBottom: string
  safeMaxBottom: string
  navBottomGap: number | null
  toolbarBottomGap: number | null
  rootBottomGap: number | null
  activeBottomElement: string
}

function readCssEnvPx(name: string): string {
  const probe = document.createElement('div')
  probe.style.position = 'fixed'
  probe.style.visibility = 'hidden'
  probe.style.pointerEvents = 'none'
  probe.style.paddingBottom = `env(${name}, 0px)`
  document.body.appendChild(probe)
  const value = window.getComputedStyle(probe).paddingBottom
  probe.remove()
  return value
}

function getBottomGap(element: Element | null): number | null {
  if (!element) return null
  const rect = element.getBoundingClientRect()
  return Math.round(window.innerHeight - rect.bottom)
}

function getDisplayMode(): boolean {
  return window.matchMedia('(display-mode: standalone)').matches
    || window.matchMedia('(display-mode: fullscreen)').matches
    || window.matchMedia('(display-mode: minimal-ui)').matches
}

function getNavigatorStandalone(): boolean {
  return 'standalone' in window.navigator
    && (window.navigator as { standalone?: boolean }).standalone === true
}

function getSnapshot(): ViewportSnapshot {
  const bottomNav = document.querySelector('[data-viewport-debug="bottom-nav"]')
  const tokenToolbar = document.querySelector('[data-viewport-debug="token-toolbar"]')
  const root = document.getElementById('root')
  const activeBottomElement = bottomNav ? 'bottom-nav' : tokenToolbar ? 'token-toolbar' : 'none'

  return {
    standalone: getDisplayMode(),
    navigatorStandalone: getNavigatorStandalone(),
    innerHeight: Math.round(window.innerHeight),
    outerHeight: Math.round(window.outerHeight),
    clientHeight: Math.round(document.documentElement.clientHeight),
    bodyHeight: Math.round(document.body.getBoundingClientRect().height),
    rootHeight: root ? Math.round(root.getBoundingClientRect().height) : 0,
    visualViewportHeight: window.visualViewport ? Math.round(window.visualViewport.height) : null,
    visualViewportOffsetTop: window.visualViewport ? Math.round(window.visualViewport.offsetTop) : null,
    safeBottom: readCssEnvPx('safe-area-inset-bottom'),
    safeMaxBottom: readCssEnvPx('safe-area-max-inset-bottom'),
    navBottomGap: getBottomGap(bottomNav),
    toolbarBottomGap: getBottomGap(tokenToolbar),
    rootBottomGap: getBottomGap(root),
    activeBottomElement,
  }
}

export function ViewportDebugPanel({ onClose }: ViewportDebugPanelProps) {
  const [snapshot, setSnapshot] = useState<ViewportSnapshot>(() => getSnapshot())

  useEffect(() => {
    const update = () => setSnapshot(getSnapshot())
    const interval = window.setInterval(update, 1000)

    window.addEventListener('resize', update)
    window.addEventListener('orientationchange', update)
    window.visualViewport?.addEventListener('resize', update)
    window.visualViewport?.addEventListener('scroll', update)

    update()

    return () => {
      window.clearInterval(interval)
      window.removeEventListener('resize', update)
      window.removeEventListener('orientationchange', update)
      window.visualViewport?.removeEventListener('resize', update)
      window.visualViewport?.removeEventListener('scroll', update)
    }
  }, [])

  const rows = useMemo(
    () => [
      ['standalone', String(snapshot.standalone)],
      ['nav.standalone', String(snapshot.navigatorStandalone)],
      ['innerHeight', `${snapshot.innerHeight}`],
      ['outerHeight', `${snapshot.outerHeight}`],
      ['clientHeight', `${snapshot.clientHeight}`],
      ['visualViewport', snapshot.visualViewportHeight == null ? 'null' : `${snapshot.visualViewportHeight}`],
      ['visualOffsetTop', snapshot.visualViewportOffsetTop == null ? 'null' : `${snapshot.visualViewportOffsetTop}`],
      ['bodyHeight', `${snapshot.bodyHeight}`],
      ['rootHeight', `${snapshot.rootHeight}`],
      ['rootBottomGap', snapshot.rootBottomGap == null ? 'null' : `${snapshot.rootBottomGap}`],
      ['safeBottom', snapshot.safeBottom],
      ['safeMaxBottom', snapshot.safeMaxBottom],
      ['activeBottom', snapshot.activeBottomElement],
      ['navBottomGap', snapshot.navBottomGap == null ? 'null' : `${snapshot.navBottomGap}`],
      ['toolbarBottomGap', snapshot.toolbarBottomGap == null ? 'null' : `${snapshot.toolbarBottomGap}`],
    ],
    [snapshot],
  )

  return (
    <div className="fixed left-3 right-3 bottom-3 z-[9999] rounded-2xl border border-black/10 bg-black/85 p-3 text-white shadow-2xl">
      <div className="mb-2 flex items-center justify-between gap-3">
        <p className="text-[12px] font-semibold">Viewport Debug</p>
        <button
          type="button"
          onClick={onClose}
          className="rounded-full bg-white/15 px-2 py-1 text-[11px] font-semibold"
        >
          Close
        </button>
      </div>
      <div className="grid grid-cols-2 gap-x-3 gap-y-1 font-mono text-[11px] leading-tight">
        {rows.map(([label, value]) => (
          <div key={label} className="contents">
            <span className="text-white/55">{label}</span>
            <span className="text-right text-white">{value}</span>
          </div>
        ))}
      </div>
    </div>
  )
}
