import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { SendConfirmSheet } from '@/ui/screens/Send/SendConfirmSheet'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}))
vi.mock('@/store', () => ({
  useAppStore: (selector: (state: unknown) => unknown) =>
    selector({
      settings: { mints: ['https://m'] },
      balance: { byMint: { 'https://m': 100 } },
    }),
}))
vi.mock('@/ui/hooks/use-mint-metadata', () => ({
  useMintMetadata: () => ({
    getDisplayName: () => 'My Mint',
    getIconUrl: () => undefined,
  }),
}))
vi.mock('@/utils/format', () => ({
  useFormatSats: () => (amount: number) => `${amount} sat`,
  useFormatFiat: () => () => null,
}))
vi.mock('@/utils/url', () => ({
  getMintBalance: (url: string, balances: Record<string, number>) => balances[url] ?? 0,
}))
vi.mock('@/ui/components/common/MintIcon', () => ({
  MintIcon: () => <span />,
}))
vi.mock('@/ui/utils/haptic', () => ({ hapticTap: vi.fn() }))

const baseProps = {
  open: true,
  onClose: vi.fn(),
  onConfirm: vi.fn(),
  directTransfer: true,
  amount: 90,
  fee: 0,
  mintUrl: 'https://m',
}

describe('SendConfirmSheet direct-transfer fee guard', () => {
  it('keeps confirmation disabled until the fee quote resolves', async () => {
    let resolveQuote: (fee: number | null) => void = () => {}
    const onEstimateFee = vi.fn(
      () =>
        new Promise<number | null>((resolve) => {
          resolveQuote = resolve
        }),
    )
    const onConfirm = vi.fn()
    render(<SendConfirmSheet {...baseProps} onConfirm={onConfirm} onEstimateFee={onEstimateFee} />)

    const confirm = screen.getByRole('button', {
      name: 'send.direct.createCta',
    })
    expect(confirm).toBeDisabled()
    fireEvent.click(confirm)
    expect(onConfirm).not.toHaveBeenCalled()

    resolveQuote(5)
    await waitFor(() => expect(confirm).toBeEnabled())
    fireEvent.click(confirm)
    await waitFor(() => expect(onConfirm).toHaveBeenCalledTimes(1))
  })

  it('blocks confirmation when fee estimation fails', async () => {
    render(<SendConfirmSheet {...baseProps} onEstimateFee={vi.fn(async () => null)} />)

    await screen.findByText('send.confirm.feeUnavailable')
    expect(screen.getByRole('button', { name: 'send.direct.createCta' })).toBeDisabled()
  })

  it('blocks confirmation when amount plus fee exceeds the mint balance', async () => {
    render(<SendConfirmSheet {...baseProps} amount={95} onEstimateFee={vi.fn(async () => 10)} />)

    await screen.findByText('payment.insufficientBalance')
    expect(screen.getByRole('button', { name: 'send.direct.createCta' })).toBeDisabled()
  })
})
