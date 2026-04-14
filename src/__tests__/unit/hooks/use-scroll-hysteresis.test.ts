import { describe, it, expect, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useScrollHysteresis } from '@/ui/hooks/use-scroll-hysteresis'

function createScrollEl(): HTMLDivElement {
  const el = document.createElement('div')
  document.body.appendChild(el)
  return el
}

function setScroll(el: HTMLElement, top: number) {
  Object.defineProperty(el, 'scrollTop', { value: top, configurable: true, writable: true })
  el.dispatchEvent(new Event('scroll'))
}

describe('useScrollHysteresis', () => {
  afterEach(() => {
    document.body.innerHTML = ''
  })

  it('starts uncollapsed at scrollTop=0', () => {
    const el = createScrollEl()
    const ref = { current: el }
    const { result } = renderHook(() => useScrollHysteresis(ref, 24, 16))
    expect(result.current).toBe(false)
  })

  it('stays uncollapsed at scrollTop=23 (below collapseAt)', () => {
    const el = createScrollEl()
    const ref = { current: el }
    const { result } = renderHook(() => useScrollHysteresis(ref, 24, 16))
    act(() => setScroll(el, 23))
    expect(result.current).toBe(false)
  })

  it('collapses at scrollTop=25 (above collapseAt)', () => {
    const el = createScrollEl()
    const ref = { current: el }
    const { result } = renderHook(() => useScrollHysteresis(ref, 24, 16))
    act(() => setScroll(el, 25))
    expect(result.current).toBe(true)
  })

  it('stays collapsed at scrollTop=17 within hysteresis band', () => {
    const el = createScrollEl()
    const ref = { current: el }
    const { result } = renderHook(() => useScrollHysteresis(ref, 24, 16))
    act(() => setScroll(el, 25))
    act(() => setScroll(el, 17))
    expect(result.current).toBe(true)
  })

  it('expands at scrollTop=15 (below expandAt)', () => {
    const el = createScrollEl()
    const ref = { current: el }
    const { result } = renderHook(() => useScrollHysteresis(ref, 24, 16))
    act(() => setScroll(el, 25))
    act(() => setScroll(el, 15))
    expect(result.current).toBe(false)
  })

  it('removes scroll listener on unmount', () => {
    const el = createScrollEl()
    const ref = { current: el }
    const { result, unmount } = renderHook(() => useScrollHysteresis(ref, 24, 16))
    act(() => setScroll(el, 25))
    expect(result.current).toBe(true)
    unmount()
    setScroll(el, 0)
    expect(result.current).toBe(true)
  })
})
