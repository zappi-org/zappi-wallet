import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { SendAmountStep } from '@/ui/screens/Send/steps/SendAmountStep'
import { formatFiatInputForDisplay } from '@/utils/format'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (k: string) => k }),
}))
vi.mock('@/ui/hooks/use-wallet', () => ({
  useWallet: () => ({ balance: { byMint: { 'https://m': 100000 } } }),
}))
vi.mock('@/store', () => ({
  useAppStore: (sel: (s: { addToast: () => void }) => unknown) => sel({ addToast: vi.fn() }),
}))
vi.mock('@/utils/format', () => ({
  useFormatSats: () => (n: number) => `${n} sat`,
  useSatUnit: () => 'sat',
  useFormatFiat: () => (n: number) => `$${n}`,
  isZeroDecimalCurrency: () => false,
  formatFiatInputForDisplay: (v: string) => {
    if (!v) return '0'
    const [integer = '0', fraction] = v.split('.')
    const groupedInteger = Number(integer || '0').toLocaleString()
    return v.includes('.') ? `${groupedInteger}.${fraction ?? ''}` : groupedInteger
  },
}))
vi.mock('@/ui/hooks/use-fiat-toggle', () => ({
  useFiatToggle: () => ({
    isFiatMode: false,
    fiatInput: '',
    fiatCurrency: 'USD',
    currencySymbol: '$',
    exchangeRate: null,
    handleToggleFiat: vi.fn(),
    handleFiatChange: vi.fn(),
    syncFiatFromSats: vi.fn(),
  }),
}))
vi.mock('@/ui/hooks/use-mint-metadata', () => ({
  useMintMetadata: () => ({
    getDisplayName: () => 'My Mint',
    getIconUrl: () => undefined,
  }),
}))
vi.mock('@/utils/url', () => ({
  getMintBalance: (url: string, byMint: Record<string, number>) => byMint[url] ?? 0,
}))
vi.mock('@/ui/hooks/use-contacts', () => ({
  useContacts: () => ({ findByAddress: vi.fn(async () => null) }),
}))
vi.mock('@/ui/screens/Send/sendDisplayHelpers', () => ({
  findContactName: vi.fn(async () => null),
  formatNpubShort: (s: string) => s,
  formatRecipientDisplayText: (s: string) => s,
  formatLightningAddress: (s: string) => s,
  middleEllipsis: (s: string) => s,
  shouldShowRecipientInMainMessage: () => true,
}))
vi.mock('@/ui/components/common/ScreenHeader', () => ({
  ScreenHeader: ({ title }: { title?: string }) => <div>{title}</div>,
}))
vi.mock('@/ui/components/common/MintIcon', () => ({
  MintIcon: () => <span data-testid="mint-icon" />,
}))
vi.mock('@/ui/components/payment/MintSelectBottomSheet', () => ({
  MintSelectBottomSheet: () => null,
}))

const baseProps = { onBack: vi.fn(), onNext: vi.fn(), mintUrl: 'https://m' }

describe('SendAmountStep keypad', () => {
  it('direct transfer shows the direct label, a keypad, and reports the typed amount', () => {
    const onNext = vi.fn()
    render(<SendAmountStep {...baseProps} onNext={onNext} directTransfer />)

    expect(screen.getByText('send.direct.label')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '1' }))
    fireEvent.click(screen.getByRole('button', { name: '0' }))
    fireEvent.click(screen.getByRole('button', { name: '0' }))
    fireEvent.click(screen.getByRole('button', { name: 'common.confirm' }))

    expect(onNext).toHaveBeenCalledWith(expect.objectContaining({ amount: 100 }))
  })

  it('dims (not hides) the keypad and shows a lock hint when the amount is fixed by an invoice', () => {
    render(
      <SendAmountStep
        {...baseProps}
        validatedData={
          {
            type: 'bolt11',
            invoice: 'lnbc1',
            amountSats: 500,
            expiry: 0,
          } as never
        }
        initialAmount={500}
      />,
    )
    // Keypad stays rendered (matches the mockup) but is non-interactive
    const key = screen.getByRole('button', { name: '1' })
    expect(key.closest('.pointer-events-none')).not.toBeNull()
    // Lock hint explains why the amount can't be edited
    expect(screen.getByText('send.amount.fixedByInvoice')).toBeInTheDocument()
  })

  it('uses the fee-aware maximum instead of the full wallet balance', async () => {
    const onNext = vi.fn()
    const onResolveMaxAmount = vi.fn(async () => ({ status: 'ok' as const, amount: 99_950 }))
    render(<SendAmountStep {...baseProps} onNext={onNext} onResolveMaxAmount={onResolveMaxAmount} />)

    fireEvent.click(screen.getByRole('button', { name: 'send.max' }))
    await waitFor(() => expect(onResolveMaxAmount).toHaveBeenCalledWith('https://m', 100_000))
    fireEvent.click(screen.getByRole('button', { name: 'common.confirm' }))

    expect(onNext).toHaveBeenCalledWith(expect.objectContaining({ amount: 99_950 }))
  })

  it('preserves a trailing decimal point and zeros while grouping fiat input', () => {
    expect(formatFiatInputForDisplay('1234.')).toBe(`${(1234).toLocaleString()}.`)
    expect(formatFiatInputForDisplay('1234.50')).toBe(`${(1234).toLocaleString()}.50`)
  })
})
