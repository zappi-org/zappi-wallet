/**
 * useAppNavigation 계약 테스트 (Phase 4a 추출 훅 — 4b 재편의 보험)
 *
 * 핵심 계약:
 * - handleBack: previousScreen 폴백('home') + 탭 화면 복귀 시 hasSettingsSubPage 리셋
 * - handleTabSelect: 탭 화면 전환 + previousScreen 초기화
 * - popstate → handleBack 발화 (home에서는 pushState 재장전)
 * - 화면 전환 시 History pushState / home 복귀 시 replaceState (엔트리 무증가)
 */
import { describe, it, expect } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useAppNavigation } from '@/ui/hooks/use-app-navigation'

describe('useAppNavigation', () => {
  it('초기 상태: home 탭 + history state {screen: home} 초기화', () => {
    const { result } = renderHook(() => useAppNavigation())

    expect(result.current.currentScreen).toBe('home')
    expect(result.current.previousScreen).toBeNull()
    expect(result.current.activeTab).toBe('wallet')
    expect(result.current.isTabScreen).toBe(true)
    expect(window.history.state?.screen).toBe('home')
  })

  describe('handleTabSelect', () => {
    it('탭 화면으로 전환하고 previousScreen을 초기화한다', () => {
      const { result } = renderHook(() => useAppNavigation())

      act(() => { result.current.setPreviousScreen('history') })
      act(() => { result.current.handleTabSelect('settings') })

      expect(result.current.currentScreen).toBe('settings')
      expect(result.current.previousScreen).toBeNull()
      expect(result.current.activeTab).toBe('settings')
      expect(result.current.isTabScreen).toBe(true)
    })

    it('탭 전환은 서브페이지 플래그를 리셋한다 (handleBack 대칭 불변식 — 4a 잠복 a)', () => {
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
    it('previousScreen으로 복귀하고 previousScreen을 소거한다', () => {
      const { result } = renderHook(() => useAppNavigation())

      act(() => {
        result.current.setPreviousScreen('history')
        result.current.setCurrentScreen('transaction-detail')
      })
      act(() => { result.current.handleBack() })

      expect(result.current.currentScreen).toBe('history')
      expect(result.current.previousScreen).toBeNull()
    })

    it('previousScreen이 없으면 home으로 폴백한다', () => {
      const { result } = renderHook(() => useAppNavigation())

      act(() => { result.current.setCurrentScreen('send') })
      act(() => { result.current.handleBack() })

      expect(result.current.currentScreen).toBe('home')
      expect(result.current.previousScreen).toBeNull()
    })

    it('탭 화면으로 복귀하면 settings 서브페이지 플래그를 리셋한다 (엣지 스와이프 대응)', () => {
      const { result } = renderHook(() => useAppNavigation())

      act(() => { result.current.handleTabSelect('settings') })
      act(() => { result.current.setHasSettingsSubPage(true) })
      expect(result.current.isTabScreen).toBe(false)

      // previousScreen null → 'home' 폴백(탭 화면) → 플래그 리셋
      act(() => { result.current.handleBack() })

      expect(result.current.currentScreen).toBe('home')
      expect(result.current.isTabScreen).toBe(true)
    })

    it('비-탭 화면으로 복귀하면 서브페이지 플래그를 유지한다', () => {
      const { result } = renderHook(() => useAppNavigation())

      act(() => { result.current.handleTabSelect('settings') })
      act(() => { result.current.setHasSettingsSubPage(true) })
      act(() => { result.current.setPreviousScreen('send') })

      act(() => { result.current.handleBack() }) // → 'send' (비-탭) — 리셋 분기 미진입

      expect(result.current.currentScreen).toBe('send')
      // 다시 탭 화면으로 가도 플래그가 살아있어 isTabScreen=false
      act(() => { result.current.setCurrentScreen('settings') })
      expect(result.current.isTabScreen).toBe(false)
    })
  })

  describe('History API 연동', () => {
    it('비-home 화면 전환은 pushState, home 복귀는 replaceState(엔트리 무증가)', () => {
      const { result } = renderHook(() => useAppNavigation())
      const baseLength = window.history.length

      act(() => { result.current.setCurrentScreen('settings') })
      expect(window.history.state?.screen).toBe('settings')
      expect(window.history.length).toBe(baseLength + 1)

      act(() => { result.current.setCurrentScreen('home') })
      expect(window.history.state?.screen).toBe('home')
      expect(window.history.length).toBe(baseLength + 1) // replace — 엔트리 증가 없음
    })

    it('popstate는 handleBack을 발화한다 (ref 경유 — 최신 previousScreen 반영)', () => {
      const { result } = renderHook(() => useAppNavigation())

      act(() => {
        result.current.setPreviousScreen('token')
        result.current.setCurrentScreen('token-detail')
      })
      act(() => { window.dispatchEvent(new PopStateEvent('popstate')) })

      expect(result.current.currentScreen).toBe('token')
      expect(result.current.previousScreen).toBeNull()
    })

    it('home에서의 popstate는 뒤로가지 않고 pushState로 재장전한다', () => {
      const { result } = renderHook(() => useAppNavigation())
      expect(result.current.currentScreen).toBe('home')
      const baseLength = window.history.length

      act(() => { window.dispatchEvent(new PopStateEvent('popstate')) })

      expect(result.current.currentScreen).toBe('home')
      expect(window.history.state?.screen).toBe('home')
      expect(window.history.length).toBe(baseLength + 1) // 재장전 push
    })
  })
})
