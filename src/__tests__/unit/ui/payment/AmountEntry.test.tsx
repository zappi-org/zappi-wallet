import { render, screen, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import { useState } from 'react'
import { AmountEntry } from '@/ui/components/payment/AmountEntry'

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (k: string) => k }) }))
vi.mock('@/utils/format', () => ({
  appendFiatInput: (current: string, key: string) => (key === 'decimal' ? `${current || '0'}.` : `${current}${key}`),
  getFiatDecimalSeparator: () => '.',
  getFiatFractionDigits: () => 2,
  formatFiatInputForDisplay: (v: string) => (v || '0'),
  // Grouping formatter so tests cover comma reflow across the 3-digit boundary.
  useFormatSats: () => (n: number) => `${String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ',')} sat`,
  useSatUnit: () => 'sat',
  useFormatFiat: () => (n: number) => `$${n}`,
}))
vi.mock('@/ui/hooks/use-fiat-toggle', () => ({
  useFiatToggle: (_a: string, _s: unknown, o?: { initialFiatMode?: boolean; initialFiatAmount?: string }) => ({
    isFiatMode: o?.initialFiatMode ?? false,
    fiatInput: o?.initialFiatAmount ?? '',
    fiatCurrency: 'USD',
    currencySymbol: '$',
    exchangeRate: null,
    showFiat: false,
    handleToggleFiat: vi.fn(),
    handleFiatChange: vi.fn(),
    syncFiatFromSats: vi.fn(),
  }),
}))

function Harness() {
  const [value, setValue] = useState('')
  return <AmountEntry value={value} onChange={setValue} emptyPrompt="prompt" bottomSlot={<button>cta</button>} />
}

describe('AmountEntry', () => {
  it('shows the empty prompt, then rolls typed sat digits into the hero', () => {
    render(<Harness />)
    expect(screen.getByText('prompt')).toBeInTheDocument()
    fireEvent.pointerDown(screen.getByRole('button', { name: '1' }))
    fireEvent.pointerDown(screen.getByRole('button', { name: '0' }))
    expect(screen.getByText('10 sat')).toBeInTheDocument()
    expect(screen.queryByText('prompt')).not.toBeInTheDocument()
  })

  it('delete removes the last digit', () => {
    render(<Harness />)
    fireEvent.pointerDown(screen.getByRole('button', { name: '1' }))
    fireEvent.pointerDown(screen.getByRole('button', { name: '2' }))
    fireEvent.pointerDown(screen.getByRole('button', { name: 'Delete' }))
    expect(screen.getByText('1 sat')).toBeInTheDocument()
  })

  it('exposes a decimal key while in fiat mode', () => {
    render(<AmountEntry value="" onChange={vi.fn()} initialFiatMode initialFiatAmount="0." />)
    expect(screen.getByRole('button', { name: '.' })).toBeInTheDocument()
  })

  it('anchors digit glyphs to place value so grouping reflow never remounts them', () => {
    render(<Harness />)
    const press = (name: string) => fireEvent.pointerDown(screen.getByRole('button', { name }))
    const positions = () =>
      Array.from(document.querySelectorAll('[data-pos]')).map((el) => el.getAttribute('data-pos'))

    const expected = [['0'], ['0', '1'], ['0', '1', '2'], ['0', '1', '2', '3']]
    ;(['1', '2', '3', '4'] as const).forEach((key, step) => {
      press(key)
      const got = positions()
      // No duplicate place values ever — a remounted digit would linger as a dupe.
      expect(new Set(got).size).toBe(got.length)
      expect([...got].sort()).toEqual(expected[step])
    })

    // "1,234 sat": the comma reflow shifted characters, not keys.
    expect(screen.getByText('1,234 sat')).toBeInTheDocument()
    const charAt = (p: number) => document.querySelector(`[data-pos="${p}"]`)?.textContent
    expect(charAt(0)).toBe('4')
    expect(charAt(1)).toBe('3')
    expect(charAt(2)).toBe('2')
    expect(charAt(3)).toBe('1')
  })
})
