import { render, screen, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import { ReceiveAmountStep } from '@/ui/screens/Receive/steps/ReceiveAmountStep'

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
// reset (key bump) or a re-entry (remount) with a new seed amount.
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
// Header + mint icon are chrome here; keep the render focused on the keypad.
vi.mock('@/ui/components/common/ScreenHeader', () => ({
  ScreenHeader: ({ title, onBack }: { title?: string; onBack?: () => void }) => (
    <div>
      {onBack && <button aria-label="header-back" onClick={onBack} />}
      {title}
    </div>
  ),
}))
vi.mock('@/ui/components/common/MintIcon', () => ({ MintIcon: () => <span data-testid="mint-icon" /> }))
// The memo editor is exercised only through its onSave contract.
vi.mock('@/ui/screens/Send/MemoSheet', () => ({
  MemoSheet: ({ isOpen, onSave }: { isOpen: boolean; onSave: (m: string) => void }) =>
    isOpen ? <button data-testid="memo-save" onClick={() => onSave('gift')} /> : null,
}))

const base = {
  onEditMint: vi.fn(),
  onConfirm: vi.fn(),
  onBack: vi.fn(),
  mintUrl: 'https://mint.a',
  mintDisplayName: 'Lemonfizz',
  initialAmount: 0,
  initialMemo: '',
}

describe('ReceiveAmountStep', () => {
  it('disables confirm at zero, enables after keypad input, emits amount+memo', () => {
    render(<ReceiveAmountStep {...base} />)
    const confirm = screen.getByRole('button', { name: 'common.confirm' })
    expect(confirm).toBeDisabled()
    fireEvent.pointerDown(screen.getByText('1'))
    fireEvent.pointerDown(screen.getByText('0'))
    expect(confirm).toBeEnabled()
    fireEvent.click(confirm)
    expect(base.onConfirm).toHaveBeenCalledWith({ amount: 10, memo: '' })
  })

  it('the back arrow returns to the previous step', () => {
    const onBack = vi.fn()
    render(<ReceiveAmountStep {...base} onBack={onBack} />)
    fireEvent.click(screen.getByLabelText('header-back'))
    expect(onBack).toHaveBeenCalledOnce()
  })

  it('reset clears the amount', () => {
    render(<ReceiveAmountStep {...base} initialAmount={500} />)
    fireEvent.click(screen.getByRole('button', { name: 'common.reset' }))
    expect(screen.getByRole('button', { name: 'common.confirm' })).toBeDisabled()
  })

  it('reset clears the fiat draft too — typing after reset must not append to old fiat digits', () => {
    const onConfirm = vi.fn()
    render(<ReceiveAmountStep {...base} onConfirm={onConfirm} initialAmount={500} />)

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

  it('re-entering with a new seed amount resets a stale fiat-mode hero, not just the sat digits', () => {
    const onConfirm = vi.fn()
    // Re-entry is a fresh mount (the flow unmounts the step on exit); a changed
    // key forces the remount that resets AmountEntry's internal fiat state.
    const { rerender } = render(<ReceiveAmountStep key="a" {...base} onConfirm={onConfirm} initialAmount={500} />)

    fireEvent.click(screen.getByRole('button', { name: 'send.tokenCreate.toggleUnit' }))
    // Empty fiat now shows the amount prompt, so enter a digit to prove the
    // toggle put the hero into fiat mode before re-entry resets it.
    fireEvent.pointerDown(screen.getByRole('button', { name: '5' }))
    expect(screen.getByText('$5')).toBeInTheDocument()

    rerender(<ReceiveAmountStep key="b" {...base} onConfirm={onConfirm} initialAmount={300} />)

    expect(screen.getByText('300 sat')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'common.confirm' }))
    expect(onConfirm).toHaveBeenCalledWith({ amount: 300, memo: '' })
  })

  it('memo roundtrip — saving a memo flows through to the confirm payload', () => {
    const onConfirm = vi.fn()
    render(<ReceiveAmountStep {...base} onConfirm={onConfirm} initialAmount={50} />)

    fireEvent.click(screen.getByText('send.memo.changeTitle'))
    fireEvent.click(screen.getByTestId('memo-save'))
    expect(screen.getByText('gift')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'common.confirm' }))
    expect(onConfirm).toHaveBeenCalledWith({ amount: 50, memo: 'gift' })
  })
})
