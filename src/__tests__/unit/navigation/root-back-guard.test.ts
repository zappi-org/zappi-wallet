/**
 * root-back-guard tests — the sentinel that stops a hardware/browser BACK at the Home
 * root from exiting the PWA. Exercises the arm/pass-through logic against jsdom
 * history; the store snapshot is the guard's only input for "am I at Home root".
 */
import { afterEach, beforeEach, describe, it, expect, vi } from 'vitest'
import { armRootSentinel, installRootBackGuard } from '@/ui/navigation/root-back-guard'
import { navigateToScreen, resetNavigationState } from '@/ui/navigation/navigation-store'

const STACKFLOW_STATE = { _TAG: '@stackflow/plugin-history-sync', flattedState: '{}' }

function seedStackflowRoot() {
  // Simulate the plugin's own root history entry the sentinel must sit above.
  window.history.replaceState(STACKFLOW_STATE, '', '#/')
}

let uninstall: () => void

describe('root-back-guard', () => {
  beforeEach(() => {
    resetNavigationState()
    window.history.replaceState(null, '', '#/')
    uninstall = installRootBackGuard()
  })

  afterEach(() => {
    uninstall()
  })

  it('arms a sentinel above the plugin root while resting on Home', () => {
    seedStackflowRoot()

    armRootSentinel()

    expect(window.history.state).toMatchObject({ __zappiRootGuard: true })
  })

  it('does not arm when the current entry is not a stackflow root', () => {
    window.history.replaceState({ some: 'other' }, '', '#/')

    armRootSentinel()

    expect(window.history.state).not.toMatchObject({ __zappiRootGuard: true })
  })

  it('does not arm when the app is not at the Home root', () => {
    seedStackflowRoot()
    navigateToScreen('settings', { reset: true }) // leaves Home in the store mirror

    armRootSentinel()

    expect(window.history.state).not.toMatchObject({ __zappiRootGuard: true })
  })

  it('is idempotent — a second arm does not stack another sentinel', () => {
    seedStackflowRoot()
    armRootSentinel()
    const lengthAfterFirst = window.history.length

    armRootSentinel()

    expect(window.history.length).toBe(lengthAfterFirst)
    expect(window.history.state).toMatchObject({ __zappiRootGuard: true })
  })

  it('arms with the history-package usr-wrapped state (real plugin shape)', () => {
    // The plugin writes through history@5, which nests its state under `usr`.
    window.history.replaceState({ usr: STACKFLOW_STATE, key: 'k', idx: 0 }, '', '#/')

    armRootSentinel()

    expect(window.history.state).toMatchObject({ __zappiRootGuard: true })
  })

  it('re-arms after a back at Home consumes the sentinel (absorb)', async () => {
    seedStackflowRoot()
    armRootSentinel()
    expect(window.history.state).toMatchObject({ __zappiRootGuard: true })

    // Back lands on Home's real entry; the guard's popstate handler re-arms.
    window.history.back()
    await vi.waitFor(() => {
      expect(window.history.state).toMatchObject({ __zappiRootGuard: true })
    })
  })

  it('passes through a buried sentinel when a pushed screen pops onto it', async () => {
    seedStackflowRoot()
    armRootSentinel()
    // Simulate the plugin pushing a screen ABOVE the buried sentinel while the
    // store mirror says we are no longer at the Home root.
    window.history.pushState(STACKFLOW_STATE, '', '#/settings/')
    navigateToScreen('settings', { reset: true })

    // Back lands on the buried sentinel → guard must issue one more back,
    // ending on Home's real (stackflow) entry.
    window.history.back()
    await vi.waitFor(() => {
      expect(window.history.state).toMatchObject({ _TAG: '@stackflow/plugin-history-sync' })
    })
  })
})
