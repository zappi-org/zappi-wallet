/**
 * navigation-store tests — the framework-pure bridge between MainApp's imperative
 * screen callbacks and the stackflow action boundary. The stackflow Actions are mocked
 * so the store's stack model, back invariant, and boot reconciliation are verified
 * without a real Stack.
 */
import { beforeEach, describe, it, expect, vi } from 'vitest'
import type { Actions } from '@stackflow/react'
import {
  bindStackflowActions,
  consumeNavigationMark,
  currentNavigationMark,
  getNavigationSnapshot,
  isExternalNavigation,
  navigateBack,
  navigateToScreen,
  reportActiveScreen,
  resetNavigationState,
  setPreviousScreenOverride,
} from '@/ui/navigation/navigation-store'

function makeMockActions() {
  return {
    push: vi.fn(() => ({ activityId: 'a' })),
    replace: vi.fn(() => ({ activityId: 'a' })),
    pop: vi.fn(),
  } as unknown as Actions & {
    push: ReturnType<typeof vi.fn>
    replace: ReturnType<typeof vi.fn>
    pop: ReturnType<typeof vi.fn>
  }
}

type MockActions = ReturnType<typeof makeMockActions>

/** Binds mock actions and marks the store mounted (first activity report). */
function mountWithMock(): MockActions {
  const actions = makeMockActions()
  bindStackflowActions(actions)
  reportActiveScreen('home') // first report flips stackMounted true
  return actions
}

describe('navigation-store', () => {
  beforeEach(() => {
    resetNavigationState()
  })

  describe('tab-root navigation (Home stays the root)', () => {
    it('pushes a non-home tab above Home instead of replacing the only entry', () => {
      const actions = mountWithMock()

      navigateToScreen('settings', { reset: true })

      expect(actions.push).toHaveBeenCalledTimes(1)
      expect(actions.push).toHaveBeenCalledWith('Settings', {}, expect.anything())
      expect(actions.replace).not.toHaveBeenCalled()
      expect(getNavigationSnapshot().stack).toEqual(['home', 'settings'])
    })

    it('replaces one non-home tab with another, keeping depth at 2', () => {
      const actions = mountWithMock()
      navigateToScreen('settings', { reset: true })
      actions.push.mockClear()

      navigateToScreen('token', { reset: true })

      // Token replaces Settings in place — Home is still underneath, no new push.
      expect(actions.replace).toHaveBeenCalledWith('Token', {}, expect.anything())
      expect(actions.push).not.toHaveBeenCalled()
      expect(getNavigationSnapshot().stack).toEqual(['home', 'token'])
    })

    it('pops back to Home when selecting the wallet tab', () => {
      const actions = mountWithMock()
      navigateToScreen('settings', { reset: true })
      actions.pop.mockClear()

      navigateToScreen('home', { reset: true })

      expect(actions.pop).toHaveBeenCalledWith(1, expect.anything())
      expect(getNavigationSnapshot().stack).toEqual(['home'])
    })

    it('drops details above a tab, then replaces the tab itself for the next tab', () => {
      const actions = mountWithMock()
      navigateToScreen('token', { reset: true }) // ['home','token']
      navigateToScreen('token-detail') // ['home','token','token-detail']
      actions.pop.mockClear()
      actions.replace.mockClear()
      actions.push.mockClear()

      navigateToScreen('settings', { reset: true })

      // Pop only the detail above the tab layer, then swap the tab in place.
      expect(actions.pop).toHaveBeenCalledWith(1, expect.objectContaining({ animate: false }))
      expect(actions.replace).toHaveBeenCalledWith('Settings', {}, expect.anything())
      expect(actions.push).not.toHaveBeenCalled()
      expect(getNavigationSnapshot().stack).toEqual(['home', 'settings'])
    })
  })

  describe('navigateBack never grows history', () => {
    it('pops when the target is already on the stack', () => {
      const actions = mountWithMock()
      navigateToScreen('history') // ['home','history']
      navigateToScreen('transaction-detail') // ['home','history','transaction-detail']
      actions.push.mockClear()
      actions.pop.mockClear()

      const target = navigateBack()

      expect(target).toBe('history')
      expect(actions.pop).toHaveBeenCalledWith(1, expect.anything())
      expect(actions.push).not.toHaveBeenCalled()
    })

    it('replaces (never pushes) when the override target is off-stack', () => {
      const actions = mountWithMock()
      navigateToScreen('history') // ['home','history']
      // Override to a screen that is NOT on the stack.
      setPreviousScreenOverride('analytics')
      actions.push.mockClear()
      actions.replace.mockClear()
      actions.pop.mockClear()

      const target = navigateBack()

      expect(target).toBe('analytics')
      expect(actions.push).not.toHaveBeenCalled()
      expect(actions.replace).toHaveBeenCalledWith('Analytics', {}, expect.anything())
      expect(getNavigationSnapshot().stack).toEqual(['home', 'analytics'])
    })
  })

  describe('boot reconciliation — the app always opens on Home', () => {
    it('replaces a URL-restored screen with Home on cold boot', () => {
      const actions = makeMockActions()
      bindStackflowActions(actions)

      reportActiveScreen('send') // first report == boot, session URL was #/send/

      expect(actions.replace).toHaveBeenCalledWith('Home', {}, expect.anything())
      expect(actions.push).not.toHaveBeenCalled()
      expect(getNavigationSnapshot().currentScreen).toBe('home')
      expect(getNavigationSnapshot().stack).toEqual(['home'])
    })

    it('replaces a payload-dependent detail boot with Home too', () => {
      const actions = makeMockActions()
      bindStackflowActions(actions)

      reportActiveScreen('token-detail')

      expect(actions.replace).toHaveBeenCalledWith('Home', {}, expect.anything())
      expect(getNavigationSnapshot().stack).toEqual(['home'])
    })

    it('boots straight through when the restored screen is Home', () => {
      const actions = makeMockActions()
      bindStackflowActions(actions)

      reportActiveScreen('home')

      expect(actions.replace).not.toHaveBeenCalled()
      expect(getNavigationSnapshot().stack).toEqual(['home'])
    })
  })

  describe('same-screen guard', () => {
    it('does not touch the stack when navigating to the current screen', () => {
      const actions = mountWithMock()
      const before = getNavigationSnapshot().stack

      navigateToScreen('home')

      expect(actions.push).not.toHaveBeenCalled()
      expect(actions.replace).not.toHaveBeenCalled()
      expect(getNavigationSnapshot().stack).toBe(before)
    })
  })

  describe('F1: incoming-review interrupt from Home reverts with a real pop', () => {
    it('pushes Receive above Home, then a reject pops back — stack/screen stay coherent', () => {
      const actions = mountWithMock() // ['home']

      // The review fires from Home: remember where to return, then open Receive (a push).
      setPreviousScreenOverride('home')
      navigateToScreen('receive')

      expect(actions.push).toHaveBeenCalledWith('Receive', {}, expect.anything())
      expect(getNavigationSnapshot().stack).toEqual(['home', 'receive'])

      actions.push.mockClear()
      actions.pop.mockClear()
      actions.replace.mockClear()

      // Reject dismisses back to previousScreen (Home) — a real pop, never a replace that
      // would leave the store on Home while stackflow still shows a cleared Receive.
      const previous = getNavigationSnapshot().previousScreen ?? 'home'
      navigateToScreen(previous)

      expect(actions.pop).toHaveBeenCalledWith(1, expect.anything())
      expect(actions.replace).not.toHaveBeenCalled()
      const snap = getNavigationSnapshot()
      expect(snap.currentScreen).toBe('home')
      expect(snap.stack).toEqual(['home'])
    })
  })

  describe('app-initiated navigation mark', () => {
    it('classifies null (no mark), app-stamped, and expired', () => {
      const nowSpy = vi.spyOn(performance, 'now').mockReturnValue(1000)

      // Fresh reset (beforeEach) → no mark: treated as external, no generation.
      expect(currentNavigationMark()).toBeNull()
      expect(isExternalNavigation()).toBe(true)

      mountWithMock()
      navigateToScreen('settings', { reset: true }) // stamps the mark at t=1000

      expect(currentNavigationMark()).toEqual(expect.any(Number))
      expect(isExternalNavigation()).toBe(false)

      // Still inside the 400ms window (t=1300) — app-initiated.
      nowSpy.mockReturnValue(1300)
      expect(isExternalNavigation()).toBe(false)

      // Past the window (t=1500, 500ms later) — external again.
      nowSpy.mockReturnValue(1500)
      expect(isExternalNavigation()).toBe(true)

      nowSpy.mockRestore()
    })

    it("a newer stamp is not robbed by an older transition's consume", () => {
      mountWithMock()
      navigateToScreen('history') // stamp, generation N
      const older = currentNavigationMark()
      navigateToScreen('transaction-detail') // re-stamp, generation N+1
      const newer = currentNavigationMark()
      expect(newer).not.toBe(older)

      // The first transition consuming its (older) generation must NOT clear the newer mark.
      consumeNavigationMark(older as number)
      expect(currentNavigationMark()).toBe(newer)
      expect(isExternalNavigation()).toBe(false)

      // Consuming the matching generation clears it.
      consumeNavigationMark(newer as number)
      expect(currentNavigationMark()).toBeNull()
    })

    it('does not stamp a mark for a non-animated navigation (nothing consumes it)', () => {
      mountWithMock()

      // Tab select path: animate false — no transition will run, so no mark may be left
      // that could misclassify a genuinely external navigation inside the window.
      navigateToScreen('settings', { reset: true, animate: false })

      expect(currentNavigationMark()).toBeNull()
      expect(isExternalNavigation()).toBe(true)
    })

    it('clears the mark when a stack action throws (no leaked window)', () => {
      const actions = mountWithMock()
      actions.push.mockImplementation(() => {
        throw new Error('boom')
      })

      expect(() => navigateToScreen('history')).toThrow('boom')
      expect(currentNavigationMark()).toBeNull()
      expect(isExternalNavigation()).toBe(true)
    })
  })
})
