/**
 * edge-gesture-guard tests — the ROOT-only OS edge-swipe exit-guard that also re-synthesizes
 * the click a preventDefaulted edge tap would otherwise swallow. IS_IOS_LIKE is a module-load
 * const, so the iPhone UA is stamped via vi.hoisted() before the module graph evaluates;
 * standalone is spoofed per test so isEdgeGuardActive() is true and the guard actually installs.
 */
import { beforeEach, afterEach, describe, it, expect, vi } from 'vitest'

vi.hoisted(() => {
  Object.defineProperty(window.navigator, 'userAgent', {
    configurable: true,
    value:
      'Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.0 Mobile/15E148 Safari/604.1',
  })
  Object.defineProperty(window.navigator, 'maxTouchPoints', { configurable: true, value: 5 })
})

import type { Actions } from '@stackflow/react'
import { installEdgeGestureGuard } from '@/ui/navigation/edge-gesture-guard'
import {
  bindStackflowActions,
  navigateToScreen,
  reportActiveScreen,
  resetNavigationState,
} from '@/ui/navigation/navigation-store'

function makeMockActions(): Actions {
  return {
    push: vi.fn(() => ({ activityId: 'a' })),
    replace: vi.fn(() => ({ activityId: 'a' })),
    pop: vi.fn(),
  } as unknown as Actions
}

interface FakeTouch {
  identifier: number
  clientX: number
  clientY: number
}

/** jsdom has no TouchEvent constructor — build a plain Event carrying touch lists. */
function touchEvent(type: string, cancelable: boolean, touch: FakeTouch): Event {
  const ev = new Event(type, { bubbles: true, cancelable })
  Object.defineProperty(ev, 'touches', { value: [touch] })
  Object.defineProperty(ev, 'changedTouches', { value: [touch] })
  return ev
}

const EDGE_TOUCH: FakeTouch = { identifier: 1, clientX: 5, clientY: 120 }

describe('edge-gesture-guard (root-only)', () => {
  let uninstall: () => void
  let button: HTMLButtonElement
  let clickSpy: ReturnType<typeof vi.fn<(e: Event) => void>>

  beforeEach(() => {
    resetNavigationState()
    Object.defineProperty(window.navigator, 'standalone', { configurable: true, value: true })

    const actions = makeMockActions()
    bindStackflowActions(actions)
    reportActiveScreen('home') // at the stack root → guard armed

    button = document.createElement('button')
    document.body.appendChild(button)
    clickSpy = vi.fn<(e: Event) => void>()
    button.addEventListener('click', clickSpy)
    // jsdom does no layout, so elementFromPoint is unimplemented — define it to resolve the
    // finger position to our button for both the touchstart capture and the touchend hit.
    Object.defineProperty(document, 'elementFromPoint', {
      configurable: true,
      value: () => button,
    })

    uninstall = installEdgeGestureGuard()
  })

  afterEach(() => {
    uninstall()
    vi.restoreAllMocks()
    delete (document as Partial<Pick<Document, 'elementFromPoint'>>).elementFromPoint
    document.body.replaceChildren()
  })

  it('claims the left edge at the stack root (preventDefault)', () => {
    const ev = touchEvent('touchstart', true, EDGE_TOUCH)
    window.dispatchEvent(ev)
    expect(ev.defaultPrevented).toBe(true)
  })

  it('synthesizes the swallowed click for a cancelable edge tap', () => {
    window.dispatchEvent(touchEvent('touchstart', true, EDGE_TOUCH))
    window.dispatchEvent(touchEvent('touchend', true, EDGE_TOUCH))
    expect(clickSpy).toHaveBeenCalledTimes(1)
  })

  it('does NOT synthesize when the touchstart was not cancelable (native click still fires)', () => {
    window.dispatchEvent(touchEvent('touchstart', false, EDGE_TOUCH))
    window.dispatchEvent(touchEvent('touchend', false, EDGE_TOUCH))
    expect(clickSpy).not.toHaveBeenCalled()
  })

  it('is inert on a pushed screen — the OS gesture pops in-app there', () => {
    navigateToScreen('settings') // stack depth 2 → guard must stand down
    const ev = touchEvent('touchstart', true, EDGE_TOUCH)
    window.dispatchEvent(ev)
    window.dispatchEvent(touchEvent('touchend', true, EDGE_TOUCH))
    expect(ev.defaultPrevented).toBe(false)
    expect(clickSpy).not.toHaveBeenCalled()
  })

  it('leaves the right edge to the page (no suppression)', () => {
    const ev = touchEvent('touchstart', true, { identifier: 1, clientX: window.innerWidth - 3, clientY: 120 })
    window.dispatchEvent(ev)
    expect(ev.defaultPrevented).toBe(false)
  })

  it('does not synthesize a click on a disabled control', () => {
    button.disabled = true
    window.dispatchEvent(touchEvent('touchstart', true, EDGE_TOUCH))
    window.dispatchEvent(touchEvent('touchend', true, EDGE_TOUCH))
    expect(clickSpy).not.toHaveBeenCalled()
  })

  it('does not synthesize after a drag that returns to the start point (peak displacement)', () => {
    window.dispatchEvent(touchEvent('touchstart', true, EDGE_TOUCH))
    // Fast drag out (60px) and back — final displacement is 0, but the peak was a drag.
    window.dispatchEvent(touchEvent('touchmove', true, { identifier: 1, clientX: 60, clientY: 120 }))
    window.dispatchEvent(touchEvent('touchmove', true, EDGE_TOUCH))
    window.dispatchEvent(touchEvent('touchend', true, EDGE_TOUCH))
    expect(clickSpy).not.toHaveBeenCalled()
  })
})
