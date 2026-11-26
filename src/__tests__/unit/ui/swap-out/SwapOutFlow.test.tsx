import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, render, screen } from '@testing-library/react'
import { Err, Ok, type Result } from '@/core/domain/result'
import type { BaseError } from '@/core/errors/base'
import { SwapOutUnavailableError } from '@/core/errors/swap-out'
import { estimatePayout } from '@/core/domain/swap-out'
import { maxPayoutSendAmount } from '@/ui/screens/SwapOut/payout-form'
import { useAppStore } from '@/store'
import { SwapOutFlow } from '@/ui/screens/SwapOut/SwapOutFlow'
import type {
  SwapOutOffer,
  SwapOutQuoteView,
  SwapOutView,
} from '@/core/ports/driving/swap-out.usecase'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string, options?: Record<string, unknown>) =>
    options ? `${key}:${JSON.stringify(options)}` : key }),
}))

vi.mock('@/ui/components/common/QrScannerModal', () => ({
  QrScannerModal: () => null,
}))

vi.mock('motion/react', () => ({
  useReducedMotion: () => true,
}))

const MINT = 'https://mint.example.com'

const ADDRESS = 'bcrt1qw508d6qejxtdg4y5r3zarvary0c5xw7kygt080'

const { listOffersMock, quoteMock, startMock, getMock } = vi.hoisted(() => ({
  listOffersMock: vi.fn(),
  quoteMock: vi.fn(),
  startMock: vi.fn(),
  getMock: vi.fn(),
}))

vi.mock('@/ui/hooks/use-swap-out', () => ({
  useSwapOut: () => ({
    isEnabled: true,
    payouts: [],
    inFlightByMint: {},
    listOffers: listOffersMock,
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

function makeOffer(patch: Partial<SwapOutOffer> = {}): SwapOutOffer {
  return {
    offerId: 'offer-cheap',
    identifier: 'npub1cheapproviderqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq',
    feePercent: 0.1,
    networkFee: 300,
    payoutFeeRate: 2,
    payoutFeeEstimate: 272,
    minAmount: 20000,
    maxAmount: 1000000,
    seenAt: 1,
    ...patch,
  }
}

const CHEAP = makeOffer()
const PRICEY = makeOffer({
  offerId: 'offer-pricey',
  identifier: 'npub1priceyproviderzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzz',
  feePercent: 0.5,
  networkFee: 500,
})

function makeQuote(patch: Partial<SwapOutQuoteView> = {}): SwapOutQuoteView {
  return {
    quoteId: 'quote-1',
    providerId: 'provider',
    offerId: 'fake:offer-1',
    identifier: 'npub1fake',
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

function makePayout(): SwapOutView {
  return {
    id: 'payout-1',
    mintUrl: MINT,
    offerId: 'fake:offer-1',
    identifier: 'npub1fake',
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

function feeParams(offer: SwapOutOffer) {
  return {
    feePercent: offer.feePercent,
    networkFee: offer.networkFee,
    payoutFeeRate: offer.payoutFeeRate,
  }
}

async function openAmountStep(address: string = ADDRESS) {
  render(<SwapOutFlow address={address} onClose={() => {}} />)
  await flush()
  fireEvent.click(screen.getByText('swapOut.next'))
}

async function openQuotedConfirm() {
  render(<SwapOutFlow address={ADDRESS} amountSats={100000} onClose={() => {}} />)
  await flush()
  fireEvent.click(screen.getByText('swapOut.next'))
  fireEvent.click(screen.getByTestId('swap-out-get-quote'))
  await flush()
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
    swapOutInFlightByMint: {},
    swapOuts: [],
  }))
}

describe('SwapOutFlow', () => {
  beforeEach(() => {
    quoteMock.mockReset()
    startMock.mockReset()
    getMock.mockReset().mockResolvedValue(null)
    listOffersMock.mockReset().mockResolvedValue(Ok([CHEAP, PRICEY]))
    seedStore()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('lists providers in the returned order with the first one preselected', async () => {
    render(<SwapOutFlow onClose={() => {}} />)
    expect(screen.getByTestId('swap-out-providers-loading')).toBeInTheDocument()
    await flush()

    const rows = screen.getAllByTestId('swap-out-provider-row')
    expect(rows).toHaveLength(2)
    expect(rows[0]).toHaveTextContent('npub1cheap')
    expect(rows[0]).toHaveTextContent('0.1%')
    expect(rows[1]).toHaveTextContent('0.5%')
    expect(rows[0]).toHaveAttribute('aria-checked', 'true')
    expect(rows[1]).toHaveAttribute('aria-checked', 'false')
    expect(rows[0].querySelector('svg')).not.toBeNull()

    fireEvent.click(rows[1])
    expect(rows[0]).toHaveAttribute('aria-checked', 'false')
    expect(rows[1]).toHaveAttribute('aria-checked', 'true')
  })

  it('shows an empty state and retries the provider list', async () => {
    listOffersMock.mockResolvedValueOnce(Ok([]))
    render(<SwapOutFlow onClose={() => {}} />)
    await flush()
    expect(screen.getByText('swapOut.providers.empty')).toBeInTheDocument()
    expect(screen.getByText('swapOut.next').closest('button')).toBeDisabled()

    fireEvent.click(screen.getByText('common.retry'))
    await flush()
    expect(listOffersMock).toHaveBeenCalledTimes(2)
    expect(screen.getAllByTestId('swap-out-provider-row')).toHaveLength(2)
  })

  it('shows an error state and retries the provider list', async () => {
    listOffersMock.mockResolvedValueOnce(Err(new SwapOutUnavailableError('down')))
    render(<SwapOutFlow onClose={() => {}} />)
    await flush()
    expect(screen.getByText('swapOut.providers.loadFailed')).toBeInTheDocument()

    fireEvent.click(screen.getByText('common.retry'))
    await flush()
    expect(screen.queryByText('swapOut.providers.loadFailed')).not.toBeInTheDocument()
    expect(screen.getAllByTestId('swap-out-provider-row')).toHaveLength(2)
  })

  it('links the send and receive amounts both ways', async () => {
    await openAmountStep()
    const send = screen.getByTestId('swap-out-send-amount') as HTMLInputElement
    const receive = screen.getByTestId('swap-out-receive-amount') as HTMLInputElement

    fireEvent.change(send, { target: { value: '100000' } })
    const fromSend = estimatePayout({ ...feeParams(CHEAP), destination: ADDRESS, sendAmount: 100000 })
    expect(receive.value).toBe(String(fromSend.receiveAmount))

    fireEvent.change(receive, { target: { value: '50000' } })
    const fromReceive = estimatePayout({ ...feeParams(CHEAP), destination: ADDRESS, receiveAmount: 50000 })
    expect(send.value).toBe(String(fromReceive.sendAmount))
    expect(receive.value).toBe('50000')

    fireEvent.click(screen.getByTestId('swap-out-fees-toggle'))
    const details = screen.getByTestId('swap-out-fee-details')
    expect(details).toHaveTextContent('swapOut.networkFee')
    expect(details).toHaveTextContent('swapOut.payoutFee')
    expect(details).toHaveTextContent('0.1%')
  })

  it('fills the largest sendable amount with Max', async () => {
    await openAmountStep()
    fireEvent.click(screen.getByText('swapOut.form.max'))
    const send = screen.getByTestId('swap-out-send-amount') as HTMLInputElement
    expect(send.value).toBe(String(maxPayoutSendAmount(CHEAP, 500000)))
    expect(Number(send.value)).toBeLessThan(500000)
  })

  it('labels the main button with the first problem', async () => {
    await openAmountStep('')
    const send = screen.getByTestId('swap-out-send-amount')
    const address = screen.getByTestId('swap-out-address')
    const button = () => screen.getByTestId('swap-out-get-quote')

    fireEvent.change(address, { target: { value: 'not-an-address' } })
    fireEvent.change(send, { target: { value: '1000' } })
    expect(button()).toHaveTextContent('swapOut.form.minimum')
    expect(button()).toBeDisabled()

    fireEvent.change(send, { target: { value: '2000000' } })
    expect(button()).toHaveTextContent('swapOut.form.maximum')

    fireEvent.change(send, { target: { value: '499000' } })
    expect(button()).toHaveTextContent('swapOut.form.invalidAddress')

    fireEvent.change(address, { target: { value: ADDRESS } })
    expect(button()).toHaveTextContent('swapOut.form.insufficientBalance')

    fireEvent.change(send, { target: { value: '100000' } })
    expect(button()).toHaveTextContent('swapOut.form.getQuote')
    expect(button()).not.toBeDisabled()
  })

  it('fills address and amount from a pasted payment URI', async () => {
    await openAmountStep('')
    const address = screen.getByTestId('swap-out-address') as HTMLInputElement
    fireEvent.paste(address, {
      clipboardData: { getData: () => `bitcoin:${ADDRESS}?amount=0.001` },
    })
    expect(address.value).toBe(ADDRESS)
    expect((screen.getByTestId('swap-out-send-amount') as HTMLInputElement).value).toBe('100000')
  })

  it('drops a quote that resolves after Back from the amount step', async () => {
    let finishQuote!: (result: Result<SwapOutQuoteView, BaseError>) => void
    quoteMock.mockImplementation(
      () => new Promise<Result<SwapOutQuoteView, BaseError>>((resolve) => { finishQuote = resolve }),
    )
    await openAmountStep()
    fireEvent.change(screen.getByTestId('swap-out-send-amount'), { target: { value: '100000' } })
    fireEvent.click(screen.getByTestId('swap-out-get-quote'))
    fireEvent.click(screen.getByLabelText('common.back'))

    await act(async () => {
      finishQuote(Ok(makeQuote()))
      await Promise.resolve()
    })
    expect(screen.queryByText('swapOut.confirm')).not.toBeInTheDocument()
    expect(screen.getAllByTestId('swap-out-provider-row')).toHaveLength(2)
  })

  it('drops a re-quote that resolves after Back from the confirm step', async () => {
    quoteMock.mockResolvedValueOnce(Ok(makeQuote()))
    await openQuotedConfirm()
    expect(screen.getByText('swapOut.confirm')).toBeInTheDocument()

    let finishQuote!: (result: Result<SwapOutQuoteView, BaseError>) => void
    quoteMock.mockImplementation(
      () => new Promise<Result<SwapOutQuoteView, BaseError>>((resolve) => { finishQuote = resolve }),
    )
    fireEvent.click(screen.getByText('swapOut.requote'))
    fireEvent.click(screen.getByLabelText('common.back'))
    expect(screen.getByTestId('swap-out-get-quote')).not.toBeDisabled()

    await act(async () => {
      finishQuote(Ok(makeQuote({ quoteId: 'quote-late' })))
      await Promise.resolve()
    })
    expect(screen.queryByText('swapOut.confirm')).not.toBeInTheDocument()
    expect(screen.getByTestId('swap-out-send-amount')).toBeInTheDocument()
  })

  it('takes the on-chain address and amount from a unified payment URI', async () => {
    await openAmountStep('')
    const address = screen.getByTestId('swap-out-address') as HTMLInputElement
    fireEvent.paste(address, {
      clipboardData: { getData: () => `bitcoin:${ADDRESS}?amount=0.0005&lightning=lnbcrt500u1pexample` },
    })
    expect(address.value).toBe(ADDRESS)
    expect((screen.getByTestId('swap-out-send-amount') as HTMLInputElement).value).toBe('50000')
  })

  it('leaves the typed amount alone when Max has nothing available', async () => {
    useAppStore.setState({ balance: { total: 3, byMint: { [MINT]: 3 } } })
    await openAmountStep()
    const receive = screen.getByTestId('swap-out-receive-amount') as HTMLInputElement
    fireEvent.change(receive, { target: { value: '40000' } })
    fireEvent.click(screen.getByText('swapOut.form.max'))
    expect(receive.value).toBe('40000')
    expect(screen.getByTestId('swap-out-get-quote')).toHaveTextContent('swapOut.form.insufficientBalance')
  })

  it('keeps the entered values and the provider choice when navigating back', async () => {
    render(<SwapOutFlow address={ADDRESS} onClose={() => {}} />)
    await flush()
    fireEvent.click(screen.getAllByTestId('swap-out-provider-row')[1])
    fireEvent.click(screen.getByText('swapOut.next'))
    fireEvent.change(screen.getByTestId('swap-out-send-amount'), { target: { value: '120000' } })

    fireEvent.click(screen.getByLabelText('common.back'))
    expect(screen.getAllByTestId('swap-out-provider-row')[1]).toHaveAttribute('aria-checked', 'true')
    fireEvent.click(screen.getByText('swapOut.next'))
    expect((screen.getByTestId('swap-out-send-amount') as HTMLInputElement).value).toBe('120000')
    expect((screen.getByTestId('swap-out-address') as HTMLInputElement).value).toBe(ADDRESS)
  })

  it('quotes the chosen provider and shows it with every fee field and the notice', async () => {
    quoteMock.mockResolvedValue(Ok(makeQuote({ offerId: PRICEY.offerId, identifier: PRICEY.identifier })))
    render(<SwapOutFlow address={ADDRESS} amountSats={100000} onClose={() => {}} />)
    await flush()
    fireEvent.click(screen.getAllByTestId('swap-out-provider-row')[1])
    fireEvent.click(screen.getByText('swapOut.next'))
    fireEvent.click(screen.getByTestId('swap-out-get-quote'))
    await flush()

    expect(quoteMock).toHaveBeenCalledWith({
      offerId: PRICEY.offerId,
      sendAmount: 100000,
      destination: ADDRESS,
      mintUrl: MINT,
    })
    const provider = screen.getByTestId('swap-out-confirm-provider')
    expect(provider).toHaveTextContent('swapOut.providers.provider')
    expect(provider).toHaveTextContent('npub1price')
    expect(provider.querySelector('svg')).not.toBeNull()
    expect(screen.getByText('swapOut.youReceive')).toBeInTheDocument()
    expect(screen.getByText('swapOut.serviceFee')).toBeInTheDocument()
    expect(screen.getByText('swapOut.networkFee')).toBeInTheDocument()
    expect(screen.getByText('swapOut.payoutFee')).toBeInTheDocument()
    expect(screen.getByText('swapOut.totalSent')).toBeInTheDocument()
    expect(screen.getByText('swapOut.estimatedTime')).toBeInTheDocument()
    expect(screen.getByText('swapOut.notice')).toBeInTheDocument()
    expect(screen.getByText('swapOut.destination')).toBeInTheDocument()
  })

  it('starts once when the quote expires during a pending confirm and the user taps again', async () => {
    vi.useFakeTimers()
    quoteMock.mockImplementation(async () => Ok(makeQuote({
      quoteId: `quote-${quoteMock.mock.calls.length}`,
      expiresAt: Date.now() + 2000,
    })))
    let finishStart!: (result: Result<SwapOutView, BaseError>) => void
    startMock.mockImplementation(
      () => new Promise<Result<SwapOutView, BaseError>>((resolve) => { finishStart = resolve }),
    )

    await openQuotedConfirm()
    expect(quoteMock).toHaveBeenCalledTimes(1)

    const confirm = screen.getByText('swapOut.confirmPay').closest('button') as HTMLButtonElement
    fireEvent.click(confirm)
    fireEvent.click(confirm)
    expect(startMock).toHaveBeenCalledTimes(1)

    await act(async () => {
      await vi.advanceTimersByTimeAsync(4000)
    })
    expect(quoteMock).toHaveBeenCalledTimes(1)

    fireEvent.click(screen.getByText('swapOut.requote').closest('button') as HTMLButtonElement)
    fireEvent.click(screen.getByLabelText('common.back'))
    fireEvent.click(screen.getByText('swapOut.confirmPay').closest('button') as HTMLButtonElement)
    await flush()

    expect(quoteMock).toHaveBeenCalledTimes(1)
    expect(startMock).toHaveBeenCalledTimes(1)
    expect(screen.getByText('swapOut.confirm')).toBeInTheDocument()

    await act(async () => {
      finishStart(Ok(makePayout()))
      await Promise.resolve()
    })
    expect(startMock).toHaveBeenCalledTimes(1)
    expect(screen.getAllByText('swapOut.stage.paying').length).toBeGreaterThan(0)
  })

  it('shows only the re-quote action once the quote expires, without re-quoting on its own', async () => {
    vi.useFakeTimers()
    quoteMock.mockImplementation(async () => Ok(makeQuote({ expiresAt: Date.now() + 2000 })))

    await openQuotedConfirm()

    await act(async () => {
      await vi.advanceTimersByTimeAsync(4000)
    })
    expect(quoteMock).toHaveBeenCalledTimes(1)
    expect(screen.queryByText('swapOut.confirmPay')).not.toBeInTheDocument()

    fireEvent.click(screen.getByText('swapOut.requote'))
    await flush()
    expect(quoteMock).toHaveBeenCalledTimes(2)
    expect(screen.getByText('swapOut.confirmPay')).toBeInTheDocument()
    expect(startMock).not.toHaveBeenCalled()
  })
})
