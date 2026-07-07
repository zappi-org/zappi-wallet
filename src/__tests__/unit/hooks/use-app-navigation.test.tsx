/**
 * useAppNavigation contract tests.
 *
 * Core contract:
 * - handleBack: falls back to previousScreen ('home') + resets hasSettingsSubPage when returning to a tab screen
 * - handleTabSelect: switches tab screen + clears previousScreen
 * - popstate → fires handleBack (on home, re-arms via pushState)
 * - History pushState on screen change / replaceState on return to home (no entry growth)
 */
import { describe, it, expect } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useAppNavigation } from '@/ui/hooks/use-app-navigation'

describe('useAppNavigation', () => {
  it('initial state: home tab + history state {screen: home} initialized', () => {
    const { result } = renderHook(() => useAppNavigation())

    expect(result.current.currentScreen).toBe('home')
    expect(result.current.previousScreen).toBeNull()
    expect(result.current.activeTab).toBe('wallet')
    expect(result.current.isTabScreen).toBe(true)
    expect(window.history.state?.screen).toBe('home')
  })

  describe('handleTabSelect', () => {
    it('switches to a tab screen and clears previousScreen', () => {
      const { result } = renderHook(() => useAppNavigation())

      act(() => { result.current.setPreviousScreen('history') })
      act(() => { result.current.handleTabSelect('settings') })

      expect(result.current.currentScreen).toBe('settings')
      expect(result.current.previousScreen).toBeNull()
      expect(result.current.activeTab).toBe('settings')
      expect(result.current.isTabScreen).toBe(true)
    })

    it('tab switch resets the sub-page flag (handleBack symmetry invariant — 4a latent a)', () => {
      const { result } = renderHook(() => useAppNavigation())

      act(() => { result.current.handleTabSelect('settings') })
      act(() => { result.current.setHasSettingsSubPage(true) })
      expect(result.current.isTabScreen).toBe(false)

      act(() => { result.current.handleTabSelect('wallet') })

      expect(result.current.currentScreen).toBe('home')
      expect(result.current.isTabScreen).toBe(true)
    })
  })

  describe('handleBack', () => {
    it('returns to previousScreen and clears previousScreen', () => {
      const { result } = renderHook(() => useAppNavigation())

      act(() => {
        result.current.setPreviousScreen('history')
        result.current.setCurrentScreen('transaction-detail')
      })
      act(() => { result.current.handleBack() })

      expect(result.current.currentScreen).toBe('history')
      expect(result.current.previousScreen).toBeNull()
    })

    it('falls back to home when there is no previousScreen', () => {
      const { result } = renderHook(() => useAppNavigation())

      act(() => { result.current.setCurrentScreen('send') })
      act(() => { result.current.handleBack() })

      expect(result.current.currentScreen).toBe('home')
      expect(result.current.previousScreen).toBeNull()
    })

    it('resets the settings sub-page flag when returning to a tab screen (edge-swipe handling)', () => {
      const { result } = renderHook(() => useAppNavigation())

      act(() => { result.current.handleTabSelect('settings') })
      act(() => { result.current.setHasSettingsSubPage(true) })
      expect(result.current.isTabScreen).toBe(false)

      // previousScreen null → 'home' fallback (tab screen) → flag reset
      act(() => { result.current.handleBack() })

      expect(result.current.currentScreen).toBe('home')
      expect(result.current.isTabScreen).toBe(true)
    })

    it('keeps the sub-page flag when returning to a non-tab screen', () => {
      const { result } = renderHook(() => useAppNavigation())

      act(() => { result.current.handleTabSelect('settings') })
      act(() => { result.current.setHasSettingsSubPage(true) })
      act(() => { result.current.setPreviousScreen('send') })

      act(() => { result.current.handleBack() }) // → 'send' (non-tab) — reset branch skipped

      expect(result.current.currentScreen).toBe('send')
      // even back on a tab screen the flag persists, so isTabScreen=false
      act(() => { result.current.setCurrentScreen('settings') })
      expect(result.current.isTabScreen).toBe(false)
    })
  })

  describe('History API integration', () => {
    it('non-home screen change uses pushState, return to home uses replaceState (no entry growth)', () => {
      const { result } = renderHook(() => useAppNavigation())
      const baseLength = window.history.length

      act(() => { result.current.setCurrentScreen('settings') })
      expect(window.history.state?.screen).toBe('settings')
      expect(window.history.length).toBe(baseLength + 1)

      act(() => { result.current.setCurrentScreen('home') })
      expect(window.history.state?.screen).toBe('home')
      expect(window.history.length).toBe(baseLength + 1) // replace — no entry growth
    })

    it('popstate fires handleBack (via ref — reflects the latest previousScreen)', () => {
      const { result } = renderHook(() => useAppNavigation())

      act(() => {
        result.current.setPreviousScreen('token')
        result.current.setCurrentScreen('token-detail')
      })
      act(() => { window.dispatchEvent(new PopStateEvent('popstate')) })

      expect(result.current.currentScreen).toBe('token')
      expect(result.current.previousScreen).toBeNull()
    })

    it('popstate on home does not go back but re-arms via pushState', () => {
      const { result } = renderHook(() => useAppNavigation())
      expect(result.current.currentScreen).toBe('home')
      const baseLength = window.history.length

      act(() => { window.dispatchEvent(new PopStateEvent('popstate')) })

      expect(result.current.currentScreen).toBe('home')
      expect(window.history.state?.screen).toBe('home')
      expect(window.history.length).toBe(baseLength + 1) // re-arm push
    })
  })
})
