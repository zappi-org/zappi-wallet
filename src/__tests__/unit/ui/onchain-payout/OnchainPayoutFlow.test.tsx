import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, render, screen } from '@testing-library/react'
import { Ok, type Result } from '@/core/domain/result'
import type { BaseError } from '@/core/errors/base'
import { useAppStore } from '@/store'
import { OnchainPayoutFlow } from '@/ui/screens/OnchainPayout/OnchainPayoutFlow'
import type {
  OnchainPayoutQuoteView,
  OnchainPayoutView,
} from '@/core/ports/driving/onchain-payout.usecase'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string, options?: Record<string, unknown>) =>
    options ? `${key}:${JSON.stringify(options)}` : key }),
}))

vi.mock('motion/react', () => ({
  useReducedMotion: () => true,
}))

const MINT = 'https://mint.example.com'

const { quoteMock, startMock, getMock } = vi.hoisted(() => ({
  quoteMock: vi.fn(),
  startMock: vi.fn(),
  getMock: vi.fn(),
}))

vi.mock('@/ui/hooks/use-onchain-payout', () => ({
  useOnchainPayout: () => ({
    isEnabled: true,
    payouts: [],
    inFlightByMint: {},
    quote: quoteMock,
    start: startMock,
    get: getMock,
  }),
}))

vi.mock('@/ui/hooks/use-mint-metadata', () => ({
  useMintMetadata: () => ({
    getDisplayName: () => 'Example Mint',
    getIconUrl: () => 'icon.png',
  }),
}))

function makeQuote(patch: Partial<OnchainPayoutQuoteView> = {}): OnchainPayoutQuoteView {
  return {
    quoteId: 'quote-1',
    providerId: 'provider',
    destination: 'bcrt1qdestination',
    sendAmount: 100000,
    receiveAmount: 99000,
    serviceFee: 500,
    networkFee: 150,
    sweepFee: 136,
    limits: { minAmount: 20000, maxAmount: 1000000 },
    estimatedMinutes: 10,
    expiresAt: Date.now() + 60000,
    ...patch,
  }
}

function makePayout(): OnchainPayoutView {
  return {
    id: 'payout-1',
    mintUrl: MINT,
    destination: 'bcrt1qdestination',
    sendAmount: 100000,
    receiveAmount: 99000,
    stage: 'paying',
    phase: 'submitted',
    payoutTxId: null,
    failureReason: null,
    hasOpenPayments: true,
    deadline: { blockHeight: 209, estimatedAt: Date.now() + 3600_000 },
    createdAt: Date.now(),
    updatedAt: Date.now(),
  }
}

async function flush() {
  await act(async () => {
    await Promise.resolve()
    await Promise.resolve()
  })
}

function seedStore() {
  useAppStore.setState((state) => ({
    settings: { ...state.settings, mints: [MINT] },
    balance: { total: 500000, byMint: { [MINT]: 500000 } },
    onchainPayoutInFlightByMint: {},
    onchainPayouts: [],
  }))
}

describe('OnchainPayoutFlow', () => {
  beforeEach(() => {
    quoteMock.mockReset()
    startMock.mockReset()
    getMock.mockReset().mockResolvedValue(null)
    seedStore()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('labels the typed amount as the amount to send', () => {
    render(<OnchainPayoutFlow address="bcrt1qdestination" amountSats={100000} onClose={() => {}} />)
    expect(screen.getByText('onchainPayout.amountToSend')).toBeInTheDocument()
    expect(screen.queryByText('onchainPayout.youReceive')).not.toBeInTheDocument()
  })

  it('shows every fee field and the keep-open notice', async () => {
    quoteMock.mockResolvedValue(Ok(makeQuote()))
    render(<OnchainPayoutFlow address="bcrt1qdestination" amountSats={100000} onClose={() => {}} />)

    fireEvent.click(screen.getByText('common.confirm'))
    await flush()

    expect(screen.getByText('onchainPayout.youReceive')).toBeInTheDocument()
    expect(screen.getByText('onchainPayout.serviceFee')).toBeInTheDocument()
    expect(screen.getByText('onchainPayout.networkFee')).toBeInTheDocument()
    expect(screen.getByText('onchainPayout.payoutFee')).toBeInTheDocument()
    expect(screen.getByText('onchainPayout.totalSent')).toBeInTheDocument()
    expect(screen.getByText('onchainPayout.estimatedTime')).toBeInTheDocument()
    expect(screen.getByText('onchainPayout.notice')).toBeInTheDocument()
    expect(screen.getByText('onchainPayout.destination')).toBeInTheDocument()
  })

  it('starts once when the quote expires during a pending confirm and the user taps again', async () => {
    vi.useFakeTimers()
    quoteMock.mockImplementation(async () => Ok(makeQuote({
      quoteId: `quote-${quoteMock.mock.calls.length}`,
      expiresAt: Date.now() + 2000,
    })))
    let finishStart!: (result: Result<OnchainPayoutView, BaseError>) => void
    startMock.mockImplementation(
      () => new Promise<Result<OnchainPayoutView, BaseError>>((resolve) => { finishStart = resolve }),
    )

    render(<OnchainPayoutFlow address="bcrt1qdestination" amountSats={100000} onClose={() => {}} />)
    fireEvent.click(screen.getByText('common.confirm'))
    await flush()
    expect(quoteMock).toHaveBeenCalledTimes(1)

    const confirm = screen.getByText('onchainPayout.confirmPay').closest('button') as HTMLButtonElement
    fireEvent.click(confirm)
    fireEvent.click(confirm)
    expect(startMock).toHaveBeenCalledTimes(1)

    await act(async () => {
      await vi.advanceTimersByTimeAsync(4000)
    })
    expect(quoteMock).toHaveBeenCalledTimes(1)

    fireEvent.click(screen.getByText('onchainPayout.requote').closest('button') as HTMLButtonElement)
    fireEvent.click(screen.getByLabelText('common.back'))
    fireEvent.click(screen.getByText('onchainPayout.confirmPay').closest('button') as HTMLButtonElement)
    await flush()

    expect(quoteMock).toHaveBeenCalledTimes(1)
    expect(startMock).toHaveBeenCalledTimes(1)
    expect(screen.getByText('onchainPayout.confirm')).toBeInTheDocument()

    await act(async () => {
      finishStart(Ok(makePayout()))
      await Promise.resolve()
    })
    expect(startMock).toHaveBeenCalledTimes(1)
    expect(screen.getAllByText('onchainPayout.stage.paying').length).toBeGreaterThan(0)
  })

  it('shows only the re-quote action once the quote expires, without re-quoting on its own', async () => {
    vi.useFakeTimers()
    quoteMock.mockImplementation(async () => Ok(makeQuote({ expiresAt: Date.now() + 2000 })))

    render(<OnchainPayoutFlow address="bcrt1qdestination" amountSats={100000} onClose={() => {}} />)
    fireEvent.click(screen.getByText('common.confirm'))
    await flush()

    await act(async () => {
      await vi.advanceTimersByTimeAsync(4000)
    })
    expect(quoteMock).toHaveBeenCalledTimes(1)
    expect(screen.queryByText('onchainPayout.confirmPay')).not.toBeInTheDocument()

    fireEvent.click(screen.getByText('onchainPayout.requote'))
    await flush()
    expect(quoteMock).toHaveBeenCalledTimes(2)
    expect(screen.getByText('onchainPayout.confirmPay')).toBeInTheDocument()
    expect(startMock).not.toHaveBeenCalled()
  })
})
