import { useLayoutEffect, useRef } from 'react'

function isIOS() {
  return (
    /iP(ad|hone|od)/.test(navigator.userAgent) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
  )
}

/** Keep Safari's focus scrolling separate from the transcript's own scrolling. */
export function useChatViewport(active: boolean) {
  const ref = useRef<HTMLDivElement>(null)
  useLayoutEffect(() => {
    const node = ref.current
    if (!active || !node) return
    const viewport = window.visualViewport
    const ios = isIOS()
    const body = document.body
    const originalPosition = body.style.position
    const originalTop = body.style.top
    const originalWidth = body.style.width
    const originalScroll = { x: window.scrollX, y: window.scrollY }
    let frame = 0
    let focusFrame = 0
    let settleUntil = 0
    let restoreInput: (() => void) | undefined
    let touchY = 0
    let touchX = 0
    let moved = false
    let disposed = false

    if (ios) {
      body.style.position = 'fixed'
      body.style.top = '0px'
      body.style.width = '100%'
      if (window.scrollY) window.scrollTo(0, 0)
    }

    const update = () => {
      frame = 0
      if (disposed || (viewport && viewport.scale !== 1)) return
      const fullHeight = node.parentElement?.clientHeight || window.innerHeight
      const visibleHeight = viewport?.height ?? window.innerHeight
      const keyboardOpen = fullHeight - visibleHeight > 100
      const standalone =
        document.documentElement.classList.contains('standalone')
      // Preserve the full-bleed shell when iOS reports a small phantom inset.
      node.style.height = `${
        standalone && !keyboardOpen ? fullHeight : visibleHeight
      }px`
      node.style.top = `${keyboardOpen ? viewport?.offsetTop ?? 0 : 0}px`
      node.style.setProperty(
        '--chat-bottom-inset',
        keyboardOpen ? '0px' : 'env(safe-area-inset-bottom, 0px)'
      )
      node.dataset.keyboardOpen = String(keyboardOpen)
      if (ios && window.scrollY !== 0) window.scrollTo(0, 0)
      if (performance.now() < settleUntil) frame = requestAnimationFrame(update)
    }
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(update)
    }
    const settle = () => {
      settleUntil = performance.now() + 700
      schedule()
    }
    const composer = (
      target: EventTarget | null
    ): target is HTMLTextAreaElement | HTMLInputElement =>
      (target instanceof HTMLTextAreaElement ||
        (target instanceof HTMLInputElement &&
          [
            'text',
            'email',
            'search',
            'url',
            'tel',
            'number',
            'password',
          ].includes(target.type))) &&
      node.contains(target)

    const avoidFocusPan = (target: HTMLTextAreaElement | HTMLInputElement) => {
      restoreInput?.()
      cancelAnimationFrame(focusFrame)
      const transform = target.style.transform
      target.style.transform = 'translateY(-2000px)'
      restoreInput = () => {
        target.style.transform = transform
        restoreInput = undefined
      }
      focusFrame = requestAnimationFrame(() => {
        restoreInput?.()
        schedule()
      })
    }
    const onFocus = (event: FocusEvent) => {
      if (ios && composer(event.target)) avoidFocusPan(event.target)
      settle()
    }
    const onTouchStart = (event: TouchEvent) => {
      if (event.touches.length !== 1) return
      touchY = event.touches[0].clientY
      touchX = event.touches[0].clientX
      moved = false
    }
    const onTouchMove = (event: TouchEvent) => {
      if (event.touches.length !== 1 || !ios || viewport?.scale !== 1) return
      const y = event.touches[0].clientY
      const delta = y - touchY
      moved ||=
        Math.abs(delta) > 8 || Math.abs(event.touches[0].clientX - touchX) > 8
      if (window.getSelection()?.isCollapsed === false) return
      let element = event.target instanceof HTMLElement ? event.target : null
      while (element && element !== node) {
        const style = getComputedStyle(element)
        const range = element.scrollHeight - element.clientHeight
        if (/(auto|scroll)/.test(style.overflowY) && range > 1) {
          const canScroll =
            delta < 0 ? element.scrollTop < range - 1 : element.scrollTop > 0
          if (canScroll) {
            touchY = y
            return
          }
        }
        element = element.parentElement
      }
      if (event.cancelable) event.preventDefault()
      touchY = y
    }
    const onTouchEnd = (event: TouchEvent) => {
      if (
        !ios ||
        moved ||
        event.changedTouches.length !== 1 ||
        !composer(event.target) ||
        event.target === document.activeElement
      )
        return
      if (event.cancelable) event.preventDefault()
      avoidFocusPan(event.target)
      event.target.focus({ preventScroll: true })
    }
    update()
    viewport?.addEventListener('resize', schedule)
    viewport?.addEventListener('scroll', schedule)
    window.addEventListener('resize', settle)
    window.addEventListener('scroll', schedule)
    window.addEventListener('pageshow', settle)
    node.addEventListener('focusin', onFocus)
    node.addEventListener('focusout', settle)
    node.addEventListener('touchstart', onTouchStart, { passive: true })
    node.addEventListener('touchmove', onTouchMove, { passive: false })
    node.addEventListener('touchend', onTouchEnd, { passive: false })
    return () => {
      disposed = true
      cancelAnimationFrame(frame)
      cancelAnimationFrame(focusFrame)
      restoreInput?.()
      viewport?.removeEventListener('resize', schedule)
      viewport?.removeEventListener('scroll', schedule)
      window.removeEventListener('resize', settle)
      window.removeEventListener('scroll', schedule)
      window.removeEventListener('pageshow', settle)
      node.removeEventListener('focusin', onFocus)
      node.removeEventListener('focusout', settle)
      node.removeEventListener('touchstart', onTouchStart)
      node.removeEventListener('touchmove', onTouchMove)
      node.removeEventListener('touchend', onTouchEnd)
      node.style.removeProperty('height')
      node.style.removeProperty('top')
      node.style.removeProperty('--chat-bottom-inset')
      delete node.dataset.keyboardOpen
      if (ios) {
        body.style.position = originalPosition
        body.style.top = originalTop
        body.style.width = originalWidth
        if (
          window.scrollX !== originalScroll.x ||
          window.scrollY !== originalScroll.y
        )
          window.scrollTo(originalScroll.x, originalScroll.y)
      }
    }
  }, [active])
  return ref
}
