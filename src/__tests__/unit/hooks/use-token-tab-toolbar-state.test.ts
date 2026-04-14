import { describe, it, expect, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useTokenTabToolbarState } from '@/ui/hooks/use-token-tab-toolbar-state'

function createScrollEl(): HTMLDivElement {
  const el = document.createElement('div')
  document.body.appendChild(el)
  return el
}

function setScroll(el: HTMLElement, top: number) {
  Object.defineProperty(el, 'scrollTop', { value: top, configurable: true, writable: true })
  el.dispatchEvent(new Event('scroll'))
}

describe('useTokenTabToolbarState', () => {
  afterEach(() => {
    document.body.innerHTML = ''
  })

  describe('state derivation', () => {
    it('returns WALLET when isTokenTab=false regardless of other inputs', () => {
      const el = createScrollEl()
      const ref = { current: el }
      const { result } = renderHook(() =>
        useTokenTabToolbarState({ isTokenTab: false, collapsed: true, scrollRef: ref }),
      )
      expect(result.current.state).toBe('WALLET')
    })

    it('returns TOKEN_TOP when isTokenTab=true and collapsed=false', () => {
      const el = createScrollEl()
      const ref = { current: el }
      const { result } = renderHook(() =>
        useTokenTabToolbarState({ isTokenTab: true, collapsed: false, scrollRef: ref }),
      )
      expect(result.current.state).toBe('TOKEN_TOP')
    })

    it('returns TOKEN_SCROLLED when isTokenTab=true and collapsed=true', () => {
      const el = createScrollEl()
      const ref = { current: el }
      const { result } = renderHook(() =>
        useTokenTabToolbarState({ isTokenTab: true, collapsed: true, scrollRef: ref }),
      )
      expect(result.current.state).toBe('TOKEN_SCROLLED')
    })

    it('returns TOKEN_NAV_OPEN when walletMenuOpen=true (overrides collapsed)', () => {
      const el = createScrollEl()
      const ref = { current: el }
      const { result } = renderHook(() =>
        useTokenTabToolbarState({ isTokenTab: true, collapsed: true, scrollRef: ref }),
      )
      act(() => result.current.setWalletMenuOpen(true))
      expect(result.current.state).toBe('TOKEN_NAV_OPEN')
    })

    it('returns TOKEN_NAV_OPEN when walletMenuOpen=true even if collapsed=false', () => {
      const el = createScrollEl()
      const ref = { current: el }
      const { result } = renderHook(() =>
        useTokenTabToolbarState({ isTokenTab: true, collapsed: false, scrollRef: ref }),
      )
      act(() => result.current.setWalletMenuOpen(true))
      expect(result.current.state).toBe('TOKEN_NAV_OPEN')
    })
  })

  describe('automatic resets', () => {
    it('resets walletMenuOpen and reexpand when isTokenTab flips to false', () => {
      const el = createScrollEl()
      const ref = { current: el }
      const { result, rerender } = renderHook(
        ({ isTokenTab }: { isTokenTab: boolean }) =>
          useTokenTabToolbarState({ isTokenTab, collapsed: true, scrollRef: ref }),
        { initialProps: { isTokenTab: true } },
      )
      act(() => {
        result.current.setWalletMenuOpen(true)
        result.current.triggerReexpand()
      })
      expect(result.current.state).toBe('TOKEN_NAV_OPEN')

      rerender({ isTokenTab: false })
      expect(result.current.state).toBe('WALLET')
      expect(result.current.walletMenuOpen).toBe(false)
    })

    it('clears reexpand when collapsed returns to false', () => {
      const el = createScrollEl()
      const ref = { current: el }
      Object.defineProperty(el, 'scrollTop', { value: 200, configurable: true, writable: true })
      const { result, rerender } = renderHook(
        ({ collapsed }: { collapsed: boolean }) =>
          useTokenTabToolbarState({ isTokenTab: true, collapsed, scrollRef: ref }),
        { initialProps: { collapsed: true } },
      )
      act(() => result.current.triggerReexpand())
      expect(result.current.state).toBe('TOKEN_TOP')

      rerender({ collapsed: false })
      expect(result.current.state).toBe('TOKEN_TOP')
      // Retriggering should resnapshot anchor — indirect check via next round
      Object.defineProperty(el, 'scrollTop', { value: 400, configurable: true, writable: true })
      rerender({ collapsed: true })
      expect(result.current.state).toBe('TOKEN_SCROLLED')
    })

    it('closes walletMenuOpen when collapsed flips from false to true', () => {
      const el = createScrollEl()
      const ref = { current: el }
      const { result, rerender } = renderHook(
        ({ collapsed }: { collapsed: boolean }) =>
          useTokenTabToolbarState({ isTokenTab: true, collapsed, scrollRef: ref }),
        { initialProps: { collapsed: false } },
      )
      act(() => result.current.setWalletMenuOpen(true))
      expect(result.current.state).toBe('TOKEN_NAV_OPEN')

      rerender({ collapsed: true })
      expect(result.current.walletMenuOpen).toBe(false)
      expect(result.current.state).toBe('TOKEN_SCROLLED')
    })

    it('reverts to prior state when walletMenuOpen is closed', () => {
      const el = createScrollEl()
      const ref = { current: el }
      const { result } = renderHook(() =>
        useTokenTabToolbarState({ isTokenTab: true, collapsed: true, scrollRef: ref }),
      )
      act(() => result.current.setWalletMenuOpen(true))
      expect(result.current.state).toBe('TOKEN_NAV_OPEN')
      act(() => result.current.setWalletMenuOpen(false))
      expect(result.current.state).toBe('TOKEN_SCROLLED')
    })
  })

  describe('reexpand anchor (option Z)', () => {
    it('forces TOKEN_TOP while scrollTop stays within anchor + threshold', () => {
      const el = createScrollEl()
      const ref = { current: el }
      Object.defineProperty(el, 'scrollTop', { value: 200, configurable: true, writable: true })
      const { result } = renderHook(() =>
        useTokenTabToolbarState({ isTokenTab: true, collapsed: true, scrollRef: ref }),
      )
      expect(result.current.state).toBe('TOKEN_SCROLLED')
      act(() => result.current.triggerReexpand())
      expect(result.current.state).toBe('TOKEN_TOP')

      act(() => setScroll(el, 230))
      expect(result.current.state).toBe('TOKEN_TOP')
    })

    it('releases reexpand when scrollTop exceeds anchor + threshold', () => {
      const el = createScrollEl()
      const ref = { current: el }
      Object.defineProperty(el, 'scrollTop', { value: 200, configurable: true, writable: true })
      const { result } = renderHook(() =>
        useTokenTabToolbarState({ isTokenTab: true, collapsed: true, scrollRef: ref }),
      )
      act(() => result.current.triggerReexpand())
      act(() => setScroll(el, 250))
      expect(result.current.state).toBe('TOKEN_SCROLLED')
    })

    it('keeps reexpand when user scrolls above the anchor', () => {
      const el = createScrollEl()
      const ref = { current: el }
      Object.defineProperty(el, 'scrollTop', { value: 200, configurable: true, writable: true })
      const { result } = renderHook(() =>
        useTokenTabToolbarState({ isTokenTab: true, collapsed: true, scrollRef: ref }),
      )
      act(() => result.current.triggerReexpand())
      act(() => setScroll(el, 180))
      expect(result.current.state).toBe('TOKEN_TOP')
    })

    it('resnapshots anchor on subsequent triggerReexpand calls', () => {
      const el = createScrollEl()
      const ref = { current: el }
      Object.defineProperty(el, 'scrollTop', { value: 200, configurable: true, writable: true })
      const { result, rerender } = renderHook(
        ({ collapsed }: { collapsed: boolean }) =>
          useTokenTabToolbarState({ isTokenTab: true, collapsed, scrollRef: ref }),
        { initialProps: { collapsed: true } },
      )

      act(() => result.current.triggerReexpand())
      act(() => setScroll(el, 260)) // exceed 200 + 40 → release
      expect(result.current.state).toBe('TOKEN_SCROLLED')

      // Re-trigger at new scroll position — new anchor at 260
      Object.defineProperty(el, 'scrollTop', { value: 260, configurable: true, writable: true })
      act(() => result.current.triggerReexpand())
      expect(result.current.state).toBe('TOKEN_TOP')
      act(() => setScroll(el, 295))
      expect(result.current.state).toBe('TOKEN_TOP')
      act(() => setScroll(el, 320))
      expect(result.current.state).toBe('TOKEN_SCROLLED')
      // silence unused rerender
      rerender({ collapsed: true })
    })

    it('clears the reexpand anchor when leaving the token tab', () => {
      const el = createScrollEl()
      const ref = { current: el }
      Object.defineProperty(el, 'scrollTop', { value: 200, configurable: true, writable: true })
      const { result, rerender } = renderHook(
        ({ isTokenTab }: { isTokenTab: boolean }) =>
          useTokenTabToolbarState({ isTokenTab, collapsed: true, scrollRef: ref }),
        { initialProps: { isTokenTab: true } },
      )
      act(() => result.current.triggerReexpand())
      rerender({ isTokenTab: false })
      rerender({ isTokenTab: true })
      // After re-entering, collapsed=true should yield TOKEN_SCROLLED (anchor cleared)
      expect(result.current.state).toBe('TOKEN_SCROLLED')
    })
  })
})
