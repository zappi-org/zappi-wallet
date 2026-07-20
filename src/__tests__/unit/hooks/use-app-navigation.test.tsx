/**
 * useAppNavigation compatibility-facade tests.
 * Stackflow owns browser history; this suite verifies the synchronous bridge
 * used by MainApp callbacks and historySync activity reports.
 */
import { beforeEach, describe, it, expect } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useAppNavigation } from '@/ui/hooks/use-app-navigation'
import { getNavigationSnapshot, reportActiveScreen, resetNavigationState } from '@/ui/navigation/navigation-store'

describe('useAppNavigation', () => {
  beforeEach(() => {
    resetNavigationState()
  })

  it('starts on the wallet tab', () => {
    const { result } = renderHook(() => useAppNavigation())

    expect(result.current.currentScreen).toBe('home')
    expect(result.current.previousScreen).toBeNull()
    expect(result.current.activeTab).toBe('wallet')
    expect(result.current.isTabScreen).toBe(true)
  })

  describe('handleTabSelect', () => {
    it('switches to a tab root and keeps Home poppable underneath', () => {
      const { result } = renderHook(() => useAppNavigation())

      act(() => {
        result.current.setCurrentScreen('history')
      })
      act(() => {
        result.current.setCurrentScreen('transaction-detail')
      })
      act(() => {
        result.current.handleTabSelect('settings')
      })

      expect(result.current.currentScreen).toBe('settings')
      expect(result.current.previousScreen).toBe('home')
      expect(result.current.activeTab).toBe('settings')
      // Home remains the root so a back from any tab returns to it.
      expect(getNavigationSnapshot().stack).toEqual(['home', 'settings'])
    })

    it('is a complete no-op when re-selecting the active tab', () => {
      const { result } = renderHook(() => useAppNavigation())

      act(() => {
        result.current.handleTabSelect('settings')
      })
      const stackBefore = getNavigationSnapshot().stack

      act(() => {
        result.current.handleTabSelect('settings')
      })

      expect(getNavigationSnapshot().stack).toBe(stackBefore)
      expect(result.current.currentScreen).toBe('settings')
    })

    it('collapses to Home when selecting the wallet tab', () => {
      const { result } = renderHook(() => useAppNavigation())

      act(() => {
        result.current.handleTabSelect('settings')
      })
      act(() => {
        result.current.handleTabSelect('wallet')
      })

      expect(result.current.currentScreen).toBe('home')
      expect(getNavigationSnapshot().stack).toEqual(['home'])
    })

    it('resets the settings sub-page flag', () => {
      const { result } = renderHook(() => useAppNavigation())

      act(() => {
        result.current.handleTabSelect('settings')
      })
      act(() => {
        result.current.setHasSettingsSubPage(true)
      })
      expect(result.current.isTabScreen).toBe(false)

      act(() => {
        result.current.handleTabSelect('wallet')
      })

      expect(result.current.currentScreen).toBe('home')
      expect(result.current.isTabScreen).toBe(true)
    })
  })

  describe('handleBack', () => {
    it('pops to the previous activity', () => {
      const { result } = renderHook(() => useAppNavigation())

      act(() => {
        result.current.setCurrentScreen('send')
      })
      act(() => {
        result.current.setCurrentScreen('receive')
      })
      act(() => {
        result.current.handleBack()
      })

      expect(result.current.currentScreen).toBe('send')
      expect(result.current.previousScreen).toBe('home')
      expect(getNavigationSnapshot().stack).toEqual(['home', 'send'])
    })

    it('returns to home when the pushed screen has no override', () => {
      const { result } = renderHook(() => useAppNavigation())

      act(() => {
        result.current.setCurrentScreen('send')
      })
      act(() => {
        result.current.handleBack()
      })

      expect(result.current.currentScreen).toBe('home')
      expect(result.current.previousScreen).toBeNull()
    })

    it('honors an explicit return target', () => {
      const { result } = renderHook(() => useAppNavigation())

      act(() => {
        result.current.setCurrentScreen('history')
      })
      act(() => {
        result.current.setPreviousScreen('history')
        result.current.setCurrentScreen('transaction-detail')
      })
      act(() => {
        result.current.handleBack()
      })

      expect(result.current.currentScreen).toBe('history')
      expect(result.current.previousScreen).toBe('home')
    })

    it('resets the settings sub-page flag when returning to a tab root', () => {
      const { result } = renderHook(() => useAppNavigation())

      act(() => {
        result.current.handleTabSelect('settings')
      })
      act(() => {
        result.current.setHasSettingsSubPage(true)
      })
      act(() => {
        result.current.handleBack()
      })

      expect(result.current.currentScreen).toBe('home')
      expect(result.current.isTabScreen).toBe(true)
    })
  })

  describe('Stackflow history synchronization', () => {
    it('mirrors a browser-back activity report into the facade', () => {
      const { result } = renderHook(() => useAppNavigation())

      // Mount the bridge first so the later report follows the mounted-mirror path,
      // not the cold-boot branch (real runtime reports fire continuously from mount).
      act(() => {
        reportActiveScreen('home')
      })
      act(() => {
        result.current.handleTabSelect('token')
      })
      act(() => {
        result.current.setCurrentScreen('token-detail')
      })
      expect(getNavigationSnapshot().stack).toEqual(['home', 'token', 'token-detail'])

      act(() => {
        reportActiveScreen('token')
      })

      expect(result.current.currentScreen).toBe('token')
      expect(result.current.previousScreen).toBe('home')
      expect(getNavigationSnapshot().stack).toEqual(['home', 'token'])
    })

    it('appends a history-forward activity that is not in the current snapshot', () => {
      const { result } = renderHook(() => useAppNavigation())

      act(() => {
        reportActiveScreen('home')
      })
      act(() => {
        reportActiveScreen('send')
      })

      expect(result.current.currentScreen).toBe('send')
      expect(getNavigationSnapshot().stack).toEqual(['home', 'send'])
    })
  })
})
