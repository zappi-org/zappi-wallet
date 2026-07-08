import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { SendAmountStep } from '@/ui/screens/Send/steps/SendAmountStep'

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (k: string) => k }) }))
vi.mock('@/ui/hooks/use-wallet', () => ({ useWallet: () => ({ balance: { byMint: { 'https://m': 100000 } } }) }))
vi.mock('@/store', () => ({
  useAppStore: (sel: (s: { addToast: () => void }) => unknown) => sel({ addToast: vi.fn() }),
}))
vi.mock('@/utils/format', () => ({
  useFormatSats: () => (n: number) => `${n} sat`,
  useSatUnit: () => 'sat',
  useFormatFiat: () => (n: number) => `$${n}`,
  isZeroDecimalCurrency: () => false,
}))
vi.mock('@/ui/hooks/use-fiat-toggle', () => ({
  useFiatToggle: () => ({
    isFiatMode: false, fiatInput: '', fiatCurrency: 'USD', currencySymbol: '$',
    exchangeRate: null, handleToggleFiat: vi.fn(), handleFiatChange: vi.fn(),
  }),
}))
vi.mock('@/ui/hooks/use-mint-metadata', () => ({
  useMintMetadata: () => ({ getDisplayName: () => 'My Mint', getIconUrl: () => undefined }),
}))
vi.mock('@/utils/url', () => ({
  getMintBalance: (url: string, byMint: Record<string, number>) => byMint[url] ?? 0,
}))
vi.mock('@/ui/hooks/use-contacts', () => ({ useContacts: () => ({ findByAddress: vi.fn(async () => null) }) }))
vi.mock('@/ui/screens/Send/sendDisplayHelpers', () => ({
  findContactName: vi.fn(async () => null),
  formatNpubShort: (s: string) => s,
  formatRecipientDisplayText: (s: string) => s,
  shouldShowRecipientInMainMessage: () => true,
}))
vi.mock('@/ui/components/common/ScreenHeader', () => ({ ScreenHeader: ({ title }: { title?: string }) => <div>{title}</div> }))
vi.mock('@/ui/components/common/MintIcon', () => ({ MintIcon: () => <span data-testid="mint-icon" /> }))
vi.mock('@/ui/components/payment/MintSelectBottomSheet', () => ({ MintSelectBottomSheet: () => null }))

const baseProps = { onBack: vi.fn(), onNext: vi.fn(), mintUrl: 'https://m' }

describe('SendAmountStep keypad', () => {
  it('direct transfer shows the direct label, a keypad, and reports the typed amount', () => {
    const onNext = vi.fn()
    render(<SendAmountStep {...baseProps} onNext={onNext} directTransfer />)

    expect(screen.getByText('send.direct.label')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '1' }))
    fireEvent.click(screen.getByRole('button', { name: '00' }))
    fireEvent.click(screen.getByRole('button', { name: 'send.next' }))

    expect(onNext).toHaveBeenCalledWith(expect.objectContaining({ amount: 100 }))
  })

  it('hides the keypad when the amount is fixed by an invoice', () => {
    render(
      <SendAmountStep
        {...baseProps}
        validatedData={{ type: 'bolt11', invoice: 'lnbc1', amountSats: 500, expiry: 0 } as never}
        initialAmount={500}
      />
    )
    expect(screen.queryByRole('button', { name: '1' })).not.toBeInTheDocument()
  })
})
