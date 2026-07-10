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
  getNavigationSnapshot,
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
})
