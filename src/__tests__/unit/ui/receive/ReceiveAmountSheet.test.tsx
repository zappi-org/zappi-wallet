import { render, screen, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import { ReceiveAmountSheet } from '@/ui/screens/Receive/ReceiveAmountSheet'

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (k: string) => k }) }))
vi.mock('@/utils/format', () => ({
  appendFiatInput: (current: string, key: string) => (key === 'decimal' ? `${current || '0'}.` : `${current}${key}`),
  getFiatDecimalSeparator: () => '.',
  getFiatFractionDigits: () => 2,
  formatFiatInputForDisplay: (v: string) => (v || '0'),
  useFormatSats: () => (n: number) => `${n} sat`,
  useSatUnit: () => 'sat',
  useFormatFiat: () => (n: number) => `$${n}`,
}))
// Stateful (unlike the static mocks elsewhere) so a click can actually flip
// fiat mode — needed to prove AmountEntry's internal mode doesn't survive a
// sheet close+reopen with a new seed amount.
vi.mock('@/ui/hooks/use-fiat-toggle', async () => {
  const { useState } = await import('react')
  return {
    useFiatToggle: (
      _amount: string,
      setAmount: (v: string) => void,
      options: { initialFiatMode?: boolean; initialFiatAmount?: string } = {},
    ) => {
      const [isFiatMode, setIsFiatMode] = useState(options.initialFiatMode ?? false)
      const [fiatInput, setFiatInput] = useState(options.initialFiatAmount ?? '')
      return {
        isFiatMode,
        fiatInput,
        fiatCurrency: 'USD',
        currencySymbol: '$',
        exchangeRate: 100,
        showFiat: true,
        handleToggleFiat: () => setIsFiatMode((v: boolean) => !v),
        handleFiatChange: (v: string) => {
          setFiatInput(v)
          setAmount(v ? String(Math.round(parseFloat(v) * 100)) : '')
        },
        syncFiatFromSats: () => {},
      }
    },
  }
})

const base = {
  isOpen: true, onClose: vi.fn(), onEditMint: vi.fn(), onConfirm: vi.fn(),
  mintUrl: 'https://mint.a', mintDisplayName: 'Lemonfizz',
  initialAmount: 0, initialMemo: '',
}

describe('ReceiveAmountSheet', () => {
  it('disables confirm at zero, enables after keypad input, emits amount+memo', () => {
    render(<ReceiveAmountSheet {...base} />)
    const confirm = screen.getByRole('button', { name: 'common.confirm' })
    expect(confirm).toBeDisabled()
    fireEvent.pointerDown(screen.getByText('1'))
    fireEvent.pointerDown(screen.getByText('0'))
    expect(confirm).toBeEnabled()
    fireEvent.click(confirm)
    expect(base.onConfirm).toHaveBeenCalledWith({ amount: 10, memo: '' })
  })

  it('reset clears the amount', () => {
    render(<ReceiveAmountSheet {...base} initialAmount={500} />)
    fireEvent.click(screen.getByRole('button', { name: 'common.reset' }))
    expect(screen.getByRole('button', { name: 'common.confirm' })).toBeDisabled()
  })

  it('reset clears the fiat draft too — typing after reset must not append to old fiat digits', () => {
    const onConfirm = vi.fn()
    render(<ReceiveAmountSheet {...base} onConfirm={onConfirm} initialAmount={500} />)

    fireEvent.click(screen.getByRole('button', { name: 'send.tokenCreate.toggleUnit' }))
    fireEvent.pointerDown(screen.getByRole('button', { name: '5' }))
    fireEvent.click(screen.getByRole('button', { name: 'common.reset' }))
    expect(screen.getByRole('button', { name: 'common.confirm' })).toBeDisabled()

    // Without a fresh AmountEntry the stale fiatInput '5' survives the reset,
    // so this keystroke would build '53' and confirm would emit 5300.
    fireEvent.pointerDown(screen.getByRole('button', { name: '3' }))
    fireEvent.click(screen.getByRole('button', { name: 'common.confirm' }))
    expect(onConfirm).toHaveBeenCalledWith({ amount: 3, memo: '' })
  })

  it('reopening with a new seed amount resets a stale fiat-mode hero, not just the sat digits', () => {
    const onConfirm = vi.fn()
    const { rerender } = render(<ReceiveAmountSheet {...base} onConfirm={onConfirm} initialAmount={500} />)

    fireEvent.click(screen.getByRole('button', { name: 'send.tokenCreate.toggleUnit' }))
    expect(screen.getByText('$0')).toBeInTheDocument()

    rerender(<ReceiveAmountSheet {...base} onConfirm={onConfirm} initialAmount={500} isOpen={false} />)
    rerender(<ReceiveAmountSheet {...base} onConfirm={onConfirm} initialAmount={300} isOpen />)

    expect(screen.getByText('300 sat')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'common.confirm' }))
    expect(onConfirm).toHaveBeenCalledWith({ amount: 300, memo: '' })
  })
})
