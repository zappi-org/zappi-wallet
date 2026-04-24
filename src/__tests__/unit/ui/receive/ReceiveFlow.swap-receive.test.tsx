import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ReceiveFlow } from '@/ui/screens/Receive/ReceiveFlow'
import type { ValidatedCashuToken } from '@/core/domain/input-types'

const mocks = vi.hoisted(() => ({
  addToast: vi.fn(),
  addPendingQuote: vi.fn(),
  receiveRequestCreate: vi.fn().mockResolvedValue(undefined),
  settingsMints: ['https://target.mint'] as string[],
}))

vi.mock('motion/react', () => ({
  AnimatePresence: ({ children }: { children: ReactNode }) => <>{children}</>,
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, params?: { amount?: string }) => params?.amount ? `${key}:${params.amount}` : key,
  }),
}))

vi.mock('@/store', () => ({
  useAppStore: (selector: (state: {
    settings: { mints: string[] }
    addToast: typeof mocks.addToast
    addPendingQuote: typeof mocks.addPendingQuote
  }) => unknown) => selector({
    settings: { mints: mocks.settingsMints },
    addToast: mocks.addToast,
    addPendingQuote: mocks.addPendingQuote,
  }),
}))

vi.mock('@/ui/hooks/use-network', () => ({
  useNetwork: () => ({ isOnline: true }),
}))

vi.mock('@/ui/hooks/use-receive-request', () => ({
  useReceiveRequest: () => ({
    create: mocks.receiveRequestCreate,
  }),
}))

vi.mock('@/utils/format', () => ({
  formatSats: (amount: number) => `${amount} sats`,
}))

vi.mock('@/ui/components/common/PageTransition', () => ({
  PageTransition: ({ children }: { children: ReactNode }) => <>{children}</>,
}))

vi.mock('@/ui/screens/Receive/steps/TokenReceiveStep', () => ({
  TokenReceiveStep: ({ onNext }: { onNext: () => void }) => (
    <button type="button" onClick={onNext}>go-amount</button>
  ),
}))

vi.mock('@/ui/screens/Receive/steps/ReceiveInputStep', () => ({
  ReceiveInputStep: ({
    onNext,
  }: {
    onNext: (data: {
      amount: number
      mintUrl: string
      ecashRequest?: string
      ecashRequestId?: string
      httpEndpoint?: string
    }) => void
  }) => (
    <button
      type="button"
      onClick={() => onNext({
        amount: 100,
        mintUrl: 'https://target.mint',
        ecashRequest: 'creq...',
        ecashRequestId: 'ecash-1',
      })}
    >
      create-request
    </button>
  ),
}))

vi.mock('@/ui/screens/Receive/steps/ReceiveQRStep', () => ({
  ReceiveQRStep: () => <div data-testid="receive-qr" />,
}))

vi.mock('@/ui/screens/Receive/steps/TokenConfirmStep', () => ({
  TokenConfirmStep: ({
    onReceive,
    onReject,
  }: {
    onReceive: () => Promise<void>
    onReject: () => Promise<void>
  }) => (
    <div>
      <button type="button" onClick={() => { void onReceive() }}>
        receive-registered-token
      </button>
      <button type="button" onClick={() => { void onReject() }}>
        reject-registered-token
      </button>
    </div>
  ),
}))

vi.mock('@/ui/screens/Receive/steps/UntrustedMintStep', () => ({
  UntrustedMintStep: ({
    onAddAndReceive,
    onReject,
  }: {
    onAddAndReceive: () => Promise<void>
    onReject: () => Promise<void>
  }) => (
    <div>
      <button type="button" onClick={() => { void onAddAndReceive() }}>
        add-untrusted-mint
      </button>
      <button type="button" onClick={() => { void onReject() }}>
        reject-untrusted-token
      </button>
    </div>
  ),
}))

vi.mock('@/ui/screens/Receive/steps/ReceiveCompleteStep', () => ({
  ReceiveCompleteStep: ({ amount, mintUrl }: { amount: number; mintUrl?: string | null }) => (
    <div data-testid="receive-complete">{amount}:{mintUrl}</div>
  ),
}))

const token: ValidatedCashuToken = {
  type: 'cashu-token',
  token: 'cashuA...',
  amountSats: 1,
  mintUrl: 'https://source.mint',
}

function renderFlow(overrides: Partial<Parameters<typeof ReceiveFlow>[0]> = {}) {
  return render(
    <ReceiveFlow
      onBack={vi.fn()}
      onComplete={vi.fn()}
      onCreateInvoice={vi.fn()}
      onPaymentReceived={vi.fn()}
      onReceiveToken={vi.fn()}
      onAddTrustedMint={vi.fn().mockResolvedValue(true)}
      onStoreOfflineToken={vi.fn()}
      onInspectInput={vi.fn().mockResolvedValue({ lockStatus: 'not-supported', proofIntegrity: 'not-supported' })}
      validatedData={token}
      initialMintUrl="https://target.mint"
      {...overrides}
    />,
  )
}

describe('ReceiveFlow token receive', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.receiveRequestCreate.mockResolvedValue(undefined)
    mocks.settingsMints = ['https://target.mint']
  })

  it('requires add-or-reject for untrusted token mints instead of offering swap', async () => {
    const onAddTrustedMint = vi.fn().mockResolvedValue(true)
    const onReceiveToken = vi.fn().mockResolvedValue({ success: true, amount: 1 })
    const onPaymentReceived = vi.fn()

    renderFlow({ onAddTrustedMint, onReceiveToken, onPaymentReceived })

    expect(screen.getByText('add-untrusted-mint')).toBeInTheDocument()
    expect(screen.getByText('reject-untrusted-token')).toBeInTheDocument()
    expect(screen.queryByText('swap-to-my-mint')).not.toBeInTheDocument()

    fireEvent.click(screen.getByText('add-untrusted-mint'))

    await waitFor(() => {
      expect(screen.getByTestId('receive-complete')).toHaveTextContent('1:https://source.mint')
    })
    expect(onAddTrustedMint).toHaveBeenCalledWith('https://source.mint')
    expect(onReceiveToken).toHaveBeenCalledWith('cashuA...')
    expect(onPaymentReceived).toHaveBeenCalledWith(1, 'ecash')
  })

  it('translates direct receive fee shortfall after adding an untrusted mint', async () => {
    const onAddTrustedMint = vi.fn().mockResolvedValue(true)
    const onReceiveToken = vi.fn().mockResolvedValue({
      success: false,
      error: { code: 'REDEEM_FEE_TOO_HIGH', message: 'Receive amount is not sufficient after fees' },
    })
    const onPaymentReceived = vi.fn()

    renderFlow({ onAddTrustedMint, onReceiveToken, onPaymentReceived })

    fireEvent.click(screen.getByText('add-untrusted-mint'))

    await waitFor(() => {
      expect(mocks.addToast).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'error', message: 'receive.tokenReceiveFeeTooHigh' }),
      )
    })
    expect(onAddTrustedMint).toHaveBeenCalledWith('https://source.mint')
    expect(onReceiveToken).toHaveBeenCalledWith('cashuA...')
    expect(onPaymentReceived).not.toHaveBeenCalled()
  })

  it('receives configured source-mint tokens directly instead of offering a token-receive swap', async () => {
    mocks.settingsMints = ['https://target.mint', 'https://source.mint']
    const onAddTrustedMint = vi.fn().mockResolvedValue(true)
    const onReceiveToken = vi.fn().mockResolvedValue({ success: true, amount: 1 })
    const onPaymentReceived = vi.fn()

    renderFlow({
      onAddTrustedMint,
      onReceiveToken,
      onPaymentReceived,
      validatedData: { ...token, mintUrl: 'https://source.mint' },
    })

    fireEvent.click(screen.getByText('receive-registered-token'))

    await waitFor(() => {
      expect(screen.getByTestId('receive-complete')).toHaveTextContent('1:https://source.mint')
    })
    expect(onAddTrustedMint).not.toHaveBeenCalled()
    expect(onReceiveToken).toHaveBeenCalledWith('cashuA...')
    expect(onPaymentReceived).toHaveBeenCalledWith(1, 'ecash')
  })

  it('uses direct receive when source and target mints only differ by normalization', async () => {
    mocks.settingsMints = ['https://source.mint']
    const onReceiveToken = vi.fn().mockResolvedValue({ success: true, amount: 1 })

    renderFlow({
      onReceiveToken,
      validatedData: { ...token, mintUrl: 'https://source.mint/' },
      initialMintUrl: 'https://source.mint',
    })

    fireEvent.click(screen.getByText('receive-registered-token'))

    await waitFor(() => {
      expect(screen.getByTestId('receive-complete')).toHaveTextContent('1:https://source.mint')
    })
    expect(onReceiveToken).toHaveBeenCalledWith('cashuA...')
  })

  it('does not expose a payable QR or add a pending quote when ReceiveRequest persistence fails', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    mocks.receiveRequestCreate.mockRejectedValueOnce(new Error('db write failed'))
    const onCreateInvoice = vi.fn().mockResolvedValue({
      invoice: 'lnbc...',
      quoteId: 'quote-1',
      expiry: 1_700_000_000,
    })

    renderFlow({
      validatedData: undefined,
      onCreateInvoice,
    })

    fireEvent.click(screen.getByText('go-amount'))
    fireEvent.click(screen.getByText('create-request'))

    await waitFor(() => {
      expect(mocks.receiveRequestCreate).toHaveBeenCalled()
    })

    expect(mocks.addPendingQuote).not.toHaveBeenCalled()
    expect(screen.queryByTestId('receive-qr')).not.toBeInTheDocument()
    expect(mocks.addToast).toHaveBeenCalledWith(expect.objectContaining({ type: 'error' }))
    errorSpy.mockRestore()
  })

  it('adds the pending quote only after ReceiveRequest persistence succeeds', async () => {
    const onCreateInvoice = vi.fn().mockResolvedValue({
      invoice: 'lnbc...',
      quoteId: 'quote-1',
      expiry: 1_700_000_000,
    })

    renderFlow({
      validatedData: undefined,
      onCreateInvoice,
    })

    fireEvent.click(screen.getByText('go-amount'))
    fireEvent.click(screen.getByText('create-request'))

    await waitFor(() => {
      expect(screen.getByTestId('receive-qr')).toBeInTheDocument()
    })

    expect(mocks.receiveRequestCreate).toHaveBeenCalled()
    expect(mocks.addPendingQuote).toHaveBeenCalledWith(expect.objectContaining({
      quoteId: 'quote-1',
      mintUrl: 'https://target.mint',
      invoice: 'lnbc...',
    }))
    expect(mocks.receiveRequestCreate.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.addPendingQuote.mock.invocationCallOrder[0],
    )
  })
})
