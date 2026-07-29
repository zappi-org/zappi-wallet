/**
 * The source-mint picker must never offer a my-wallet transfer's own target.
 *
 * Regression: source === target still selects LN_CROSS_MINT, so the estimator
 * quotes the target mint and execution pays a real Lightning round trip to move
 * nothing. Notation variants of the same URL count as the same mint.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { SendAmountStep } from '@/ui/screens/Send/steps/SendAmountStep'
import type { MintInfo } from '@/core/types'

const TARGET = 'https://target.mint'
const OTHER = 'https://other.mint'
/** Same mint as TARGET, written differently (case + :443 + trailing slash). */
const TARGET_VARIANT = 'https://Target.Mint:443/'

/** Every mint the sheet would show if the caller passed no exclusion. */
const ALL_MINTS: MintInfo[] = [
  { url: 'https://source.mint', name: 'Source', balance: 10000 },
  { url: TARGET_VARIANT, name: 'Target', balance: 5000 },
  { url: OTHER, name: 'Other', balance: 5000 },
  { url: 'https://empty.mint', name: 'Empty', balance: 0 },
] as MintInfo[]

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (k: string) => k }),
  Trans: ({ i18nKey }: { i18nKey: string }) => <>{i18nKey}</>,
}))
vi.mock('@/ui/hooks/use-wallet', () => ({
  useWallet: () => ({ balance: { byMint: { 'https://source.mint': 10000 } } }),
}))
vi.mock('@/store', () => ({
  useAppStore: (sel: (s: { addToast: () => void }) => unknown) => sel({ addToast: vi.fn() }),
}))
vi.mock('@/utils/format', () => ({
  appendFiatInput: (current: string, key: string) => `${current}${key}`,
  getFiatDecimalSeparator: () => '.',
  getFiatFractionDigits: () => 2,
  useFormatSats: () => (n: number) => `${n} sat`,
  useSatUnit: () => 'sat',
  useFormatFiat: () => (n: number) => `$${n}`,
  isZeroDecimalCurrency: () => false,
  formatFiatInputForDisplay: (v: string) => v || '0',
}))
vi.mock('@/ui/hooks/use-fiat-toggle', () => ({
  useFiatToggle: () => ({
    isFiatMode: false,
    fiatInput: '',
    fiatCurrency: 'USD',
    currencySymbol: '$',
    exchangeRate: null,
    showFiat: true,
    handleToggleFiat: vi.fn(),
    handleFiatChange: vi.fn(),
    syncFiatFromSats: vi.fn(),
  }),
}))
vi.mock('@/ui/hooks/use-mint-metadata', () => ({
  useMintMetadata: () => ({
    getDisplayName: () => 'Source',
    getIconUrl: () => undefined,
  }),
}))
vi.mock('@/ui/hooks/use-contacts', () => ({
  useContacts: () => ({ findByAddress: vi.fn(async () => null) }),
}))
vi.mock('@/ui/components/common/ScreenHeader', () => ({
  ScreenHeader: ({ title }: { title?: string }) => <div>{title}</div>,
}))
vi.mock('@/ui/components/common/MintIcon', () => ({
  MintIcon: () => <span data-testid="mint-icon" />,
}))
// Test double for the generic sheet: applies whatever exclusion the caller
// composed and lists the survivors, so the assertion is on SendAmountStep's
// contract rather than on the sheet's carousel internals.
vi.mock('@/ui/components/payment/MintSelectBottomSheet', () => ({
  MintSelectBottomSheet: ({
    isOpen,
    filterFn,
  }: {
    isOpen: boolean
    filterFn?: (mint: MintInfo) => boolean
  }) =>
    isOpen ? (
      <ul data-testid="mint-options">
        {(filterFn ? ALL_MINTS.filter(filterFn) : ALL_MINTS).map((mint) => (
          <li key={mint.url}>{mint.url}</li>
        ))}
      </ul>
    ) : null,
}))

const baseProps = {
  onBack: vi.fn(),
  onNext: vi.fn(),
  mintUrl: 'https://source.mint',
  destination: 'Target',
  initialAmount: 1000,
  onChangeMint: vi.fn(),
}

const MY_WALLET_TARGET = {
  type: 'my-wallet' as const,
  targetMintUrl: TARGET,
  targetMintName: 'Target',
}

function openSourceMintPicker() {
  fireEvent.click(screen.getByText('Source'))
}

describe('SendAmountStep source mint picker', () => {
  beforeEach(() => {
    baseProps.onChangeMint.mockReset()
  })

  it('excludes the my-wallet target — including a notation variant of the same URL', () => {
    render(<SendAmountStep {...baseProps} validatedData={MY_WALLET_TARGET} />)
    openSourceMintPicker()

    expect(screen.queryByText(TARGET_VARIANT)).not.toBeInTheDocument()
    expect(screen.getByText(OTHER)).toBeInTheDocument()
  })

  it('still hides zero-balance mints and keeps every mint for a non-transfer recipient', () => {
    render(
      <SendAmountStep
        {...baseProps}
        validatedData={{ type: 'bolt11', invoice: 'lnbc1invoice', amountSats: 0, expiry: 9999999999 }}
      />,
    )
    openSourceMintPicker()

    expect(screen.queryByText('https://empty.mint')).not.toBeInTheDocument()
    expect(screen.getByText(TARGET_VARIANT)).toBeInTheDocument()
    expect(screen.getByText(OTHER)).toBeInTheDocument()
  })
})
