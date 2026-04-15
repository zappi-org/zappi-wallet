import { describe, it, expect, beforeEach, vi } from 'vitest'
import { createRef } from 'react'
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react'

const stableT = (key: string, opts?: Record<string, unknown>) => {
  if (opts && typeof opts === 'object') {
    let out = key
    for (const [k, v] of Object.entries(opts)) {
      out = out.replace(`{{${k}}}`, String(v))
    }
    return out
  }
  return key
}

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: stableT,
    i18n: { language: 'en' },
  }),
  initReactI18next: { type: '3rdParty', init: () => {} },
}))

vi.mock('@/utils/format', () => ({
  useFormatSats: () => (v: number) => `${v} sats`,
  useFormatFiat: () => () => null,
}))

const addToastMock = vi.fn()
vi.mock('@/store', () => ({
  useAppStore: (selector: (s: Record<string, unknown>) => unknown) =>
    selector({ addToast: addToastMock }),
}))

import { TokenScreen } from '@/ui/screens/Token/TokenScreen'

const renderScreen = (initialMockState: 'empty' | 'active' | 'first-create') => {
  const ref = createRef<HTMLDivElement>()
  return render(<TokenScreen scrollRef={ref} initialMockState={initialMockState} />)
}

describe('TokenScreen placeholder', () => {
  beforeEach(() => {
    cleanup()
    addToastMock.mockClear()
  })

  it('empty 상태에서 빈 카피와 안내 박스만 보여준다', () => {
    renderScreen('empty')

    expect(screen.getByText(/token\.empty\.title/)).toBeInTheDocument()
    expect(screen.getByText(/token\.empty\.footerNote/)).toBeInTheDocument()
    expect(screen.queryByText(/token\.reclaimable\.section/)).not.toBeInTheDocument()
    expect(screen.queryByText(/token\.history\.section/)).not.toBeInTheDocument()
  })

  it('active 상태에서 pending widget + reclaimable + timeline을 렌더한다', () => {
    renderScreen('active')

    expect(screen.getByText(/token\.pendingWidget\.title/)).toBeInTheDocument()
    expect(screen.getByText(/token\.reclaimable\.section/)).toBeInTheDocument()
    expect(screen.getByText(/token\.history\.section/)).toBeInTheDocument()
    expect(screen.getAllByText(/token\.reclaimable\.actions\.reclaim/).length).toBeGreaterThan(0)
    expect(screen.getAllByText(/token\.reclaimable\.actions\.share/).length).toBeGreaterThan(0)
  })

  it('first-create 상태에서 hint가 보이고 다시보지않기 클릭 시 사라진다', () => {
    renderScreen('first-create')

    expect(screen.getByText(/token\.firstCreate\.hint/)).toBeInTheDocument()
    fireEvent.click(screen.getByText(/token\.firstCreate\.dismiss/))
    expect(screen.queryByText(/token\.firstCreate\.hint/)).not.toBeInTheDocument()
  })

  it('first-create 상태에는 토큰 내역 섹션이 없다', () => {
    renderScreen('first-create')
    expect(screen.queryByText(/token\.history\.section/)).not.toBeInTheDocument()
  })

  it('공유 버튼 클릭 시 navigator.share를 호출한다', async () => {
    const shareSpy = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'share', {
      value: shareSpy,
      configurable: true,
      writable: true,
    })

    renderScreen('active')
    fireEvent.click(screen.getAllByText(/token\.reclaimable\.actions\.share/)[0])

    await waitFor(() => expect(shareSpy).toHaveBeenCalledTimes(1))
    const arg = shareSpy.mock.calls[0][0]
    expect(arg).toHaveProperty('text')
    expect(typeof arg.text).toBe('string')

    // cleanup
    delete (navigator as unknown as { share?: unknown }).share
  })

  it('navigator.share 없으면 clipboard로 폴백하고 토스트를 띄운다', async () => {
    delete (navigator as unknown as { share?: unknown }).share

    const writeTextSpy = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText: writeTextSpy },
      configurable: true,
      writable: true,
    })

    renderScreen('active')
    fireEvent.click(screen.getAllByText(/token\.reclaimable\.actions\.share/)[0])

    await waitFor(() => expect(writeTextSpy).toHaveBeenCalledTimes(1))
    await waitFor(() => expect(addToastMock).toHaveBeenCalledTimes(1))
    expect(addToastMock.mock.calls[0][0]).toMatchObject({ type: 'success' })
  })
})
