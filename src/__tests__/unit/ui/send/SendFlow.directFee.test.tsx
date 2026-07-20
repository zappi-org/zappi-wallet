/**
 * SendFlow direct-transfer fee-quote coverage.
 *
 * Regained after SendConfirmSheet.test.tsx was deleted (fee-quote logic moved
 * into SendFlow's own `directFeeQuote` effect, ~line 748). Child steps are
 * mocked as prop-capturing stubs so the test drives the flow purely through
 * SendFlow's own state machine — no real keypad/DOM interaction needed.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, act } from '@testing-library/react'
import { SendFlow } from '@/ui/screens/Send/SendFlow'

// Neither child step exports its props interface — extract via ComponentProps
// instead of duplicating the shape (and drifting from it) here.
import type { ComponentProps, ReactNode } from 'react'
import type { SendInputStep as SendInputStepComponent } from '@/ui/screens/Send/steps/SendInputStep'
import type { SendAmountStep as SendAmountStepComponent } from '@/ui/screens/Send/steps/SendAmountStep'

type SendInputStepProps = ComponentProps<typeof SendInputStepComponent>
type SendAmountStepProps = ComponentProps<typeof SendAmountStepComponent>

// ============= Captured props (module-level, refreshed on every render) =============

let capturedInput: SendInputStepProps | null = null
let capturedAmount: SendAmountStepProps | null = null
let completeMounted = false
const estimateRouteFeeMock = vi.hoisted(() => vi.fn())

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}))

vi.mock('motion/react', () => ({
  AnimatePresence: ({ children }: { children: ReactNode }) => children,
  useReducedMotion: () => false,
  motion: {
    div: ({ children, className }: { children?: ReactNode; className?: string }) => (
      <div className={className}>{children}</div>
    ),
  },
}))

vi.mock('@/ui/screens/Send/steps/SendInputStep', () => ({
  SendInputStep: (props: SendInputStepProps) => {
    capturedInput = props
    return null
  },
}))

vi.mock('@/ui/screens/Send/steps/SendAmountStep', () => ({
  SendAmountStep: (props: SendAmountStepProps) => {
    capturedAmount = props
    return null
  },
}))

vi.mock('@/ui/screens/Send/steps/SendCompleteStep', () => ({
  SendCompleteStep: () => {
    completeMounted = true
    return null
  },
}))

vi.mock('@/ui/screens/TokenCreate/steps/CreatedStep', () => ({
  CreatedStep: () => null,
}))

vi.mock('@/ui/components/payment/MintSelectBottomSheet', () => ({
  MintSelectBottomSheet: () => null,
}))

vi.mock('@/ui/hooks/use-network', () => ({
  useNetwork: () => ({ isOnline: true }),
}))

vi.mock('@/ui/hooks/use-input-parser', () => ({
  useInputParser: () => ({
    detectAndClassify: vi.fn(),
    validateAsync: vi.fn(),
  }),
}))

vi.mock('@/ui/hooks/use-routing', () => ({
  useRouting: () => ({
    estimateRouteFee: estimateRouteFeeMock,
  }),
  PaymentRoute: {
    CANNOT_SEND: 0,
    TOKEN_TRANSFER: 1,
    LN_INTERNAL: 2,
    LN_CROSS_MINT: 3,
    MINT_AND_DM: 4,
    MELT_TO_LN: 5,
    OWN_MINT_TOKEN: 6,
  },
  ROUTE_LABELS: {},
}))

const addToastMock = vi.fn()
const storeState = {
  addToast: addToastMock,
  settings: { relays: [], mints: [] },
  balance: { byMint: {} },
  nostrPrivkey: null,
}

// `@/store`'s useAppStore is both a hook (selector call) AND carries a static
// `.getState()` — SendFlow uses both forms (selector in render, getState()
// inside callbacks for balances/privacy/relays).
vi.mock('@/store', () => {
  const useAppStore = Object.assign((selector: (s: typeof storeState) => unknown) => selector(storeState), {
    getState: () => storeState,
  })
  return { useAppStore }
})

const baseProps = {
  // Long enough that the dwell can't elapse inside an act() await under load,
  // short enough to flush explicitly with a 150ms wait.
  sendingDwellMs: 120,
  onBack: vi.fn(),
  onComplete: vi.fn(),
  onExecuteRoute: vi.fn(),
  onResolveInvoice: vi.fn(async () => 'lnbc1resolved'),
  onCreateToken: vi.fn(),
  directMintUrl: 'https://mint.example.com',
  initialMintUrl: 'https://mint.example.com',
}

/** Drives SendFlow from destination-scene → direct-confirm with the given amount. */
function enterDirectConfirm(amount = 50) {
  act(() => {
    capturedInput!.onDirectTransfer()
  })
  act(() => {
    capturedAmount!.onNext({ amount, memo: '', isFiatMode: false, fiatAmount: '' })
  })
}

describe('SendFlow direct-transfer fee quote', () => {
  beforeEach(() => {
    capturedInput = null
    capturedAmount = null
    completeMounted = false
    addToastMock.mockClear()
    estimateRouteFeeMock.mockReset()
    estimateRouteFeeMock.mockResolvedValue({ fee: 0, availableBalance: 1000 })
  })

  it('quotes pending then resolves ceil-clamped (29.4 -> 30)', async () => {
    let resolveFee: (value: { fee: number; availableBalance: number } | null) => void = () => {}
    const feeMock = vi.fn(
      () =>
        new Promise<{ fee: number; availableBalance: number } | null>((resolve) => {
          resolveFee = resolve
        }),
    )

    render(<SendFlow {...baseProps} onEstimateCreateFee={feeMock} />)

    enterDirectConfirm(50)

    expect(capturedAmount!.directTransfer).toBe(true)
    expect(capturedAmount!.feeQuote).toBe('pending')
    expect(feeMock).toHaveBeenCalledWith('https://mint.example.com', 50)

    await act(async () => {
      resolveFee({ fee: 29.4, availableBalance: 100 })
      await Promise.resolve()
    })

    expect(capturedAmount!.feeQuote).toBe(30)
    expect(capturedAmount!.quotedBalance).toBe(100)
  })

  it('unavailable fee (null) surfaces as feeQuote="unavailable"', async () => {
    const feeMock = vi.fn().mockResolvedValueOnce(null).mockResolvedValue({ fee: 0, availableBalance: 100 })

    render(<SendFlow {...baseProps} onEstimateCreateFee={feeMock} />)

    enterDirectConfirm(50)

    await act(async () => {
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(capturedAmount!.feeQuote).toBe('unavailable')
    expect(addToastMock).not.toHaveBeenCalled()

    act(() => {
      capturedAmount!.onRetryFee!()
    })
    await act(async () => {
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(capturedAmount!.feeQuote).toBe(0)
  })

  it('keeps a cleared amount cleared after returning through the destination step', async () => {
    const validatedData = {
      type: 'lightning-address' as const,
      address: 'alice@example.com',
      lnurlParams: {
        callback: 'https://example.com/pay',
        minSendable: 1000,
        maxSendable: 1000000,
        metadata: '[["text/plain","Alice"]]',
        tag: 'payRequest' as const,
        domain: 'example.com',
      },
    }

    render(<SendFlow {...baseProps} />)

    await act(async () => {
      await capturedInput!.onNext({
        destination: validatedData.address,
        validatedData,
        mintUrl: 'https://mint.example.com',
      })
    })

    act(() => {
      capturedAmount!.onNext({ amount: 500, memo: '', isFiatMode: false, fiatAmount: '' })
    })
    act(() => {
      capturedAmount!.onBack({ amount: 500, memo: '', isFiatMode: false, fiatAmount: '' })
    })
    act(() => {
      capturedAmount!.onBack({ amount: 0, memo: '', isFiatMode: false, fiatAmount: '' })
    })

    await act(async () => {
      await capturedInput!.onNext({
        destination: validatedData.address,
        validatedData,
        mintUrl: 'https://mint.example.com',
      })
    })

    expect(capturedAmount!.initialAmount).toBe(0)
  })

  it('shows an unavailable routed fee instead of a false zero when quoting fails', async () => {
    estimateRouteFeeMock.mockRejectedValueOnce(new Error('quote unavailable'))
    const validatedData = {
      type: 'lightning-address' as const,
      address: 'alice@example.com',
      lnurlParams: {
        callback: 'https://example.com/pay',
        minSendable: 1000,
        maxSendable: 1000000,
        metadata: '[["text/plain","Alice"]]',
        tag: 'payRequest' as const,
        domain: 'example.com',
      },
    }

    render(<SendFlow {...baseProps} />)

    await act(async () => {
      await capturedInput!.onNext({
        destination: validatedData.address,
        validatedData,
        mintUrl: 'https://mint.example.com',
      })
    })
    act(() => {
      capturedAmount!.onNext({ amount: 500, memo: '', isFiatMode: false, fiatAmount: '' })
    })
    await act(async () => {
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(capturedAmount!.feeQuote).toBe('unavailable')
  })

  it('resolves an LNURL invoice before quoting and keeps it on the route snapshot', async () => {
    const onResolveInvoice = vi.fn(async () => 'lnbc1resolvedinvoice')
    const validatedData = {
      type: 'lnurl-pay' as const,
      lnurl: 'lnurl1payrequest',
      params: {
        callback: 'https://example.com/pay',
        minSendable: 1000,
        maxSendable: 1000000,
        metadata: '[["text/plain","Alice"]]',
        tag: 'payRequest' as const,
        domain: 'example.com',
      },
    }

    render(<SendFlow {...baseProps} onResolveInvoice={onResolveInvoice} />)
    await act(async () => {
      await capturedInput!.onNext({
        destination: validatedData.lnurl,
        validatedData,
        mintUrl: 'https://mint.example.com',
      })
    })
    act(() => {
      capturedAmount!.onNext({ amount: 500, memo: '', isFiatMode: false, fiatAmount: '' })
    })
    await act(async () => {
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(onResolveInvoice).toHaveBeenCalledWith(
      expect.objectContaining({ amount: 500 }),
      expect.objectContaining({ lnurlPayParams: validatedData.params }),
    )
    expect(estimateRouteFeeMock).toHaveBeenCalledWith(
      expect.anything(),
      'https://mint.example.com',
      500,
      undefined,
      'lnbc1resolvedinvoice',
    )
  })

  it('epoch staleness: a stale first quote must not land after a mint change; confirmError clears too (Finding 1)', async () => {
    let resolveFirst: (value: { fee: number; availableBalance: number } | null) => void = () => {}
    const firstPromise = new Promise<{ fee: number; availableBalance: number } | null>((resolve) => {
      resolveFirst = resolve
    })
    let resolveSecond: (value: { fee: number; availableBalance: number } | null) => void = () => {}
    const secondPromise = new Promise<{ fee: number; availableBalance: number } | null>((resolve) => {
      resolveSecond = resolve
    })

    // Call #1 resolves the *initial* confirm-entry quote immediately (so we can
    // drive a failed create and populate state.error before the epoch case).
    // Calls #2/#3 are the stale/current pair under test, queued via
    // mockReturnValueOnce right before the mint changes that trigger them.
    const feeMock = vi.fn().mockResolvedValueOnce({ fee: 20, availableBalance: 100 })
    const onCreateToken = vi.fn().mockRejectedValue(new Error('create failed'))

    render(<SendFlow {...baseProps} onEstimateCreateFee={feeMock} onCreateToken={onCreateToken} />)

    enterDirectConfirm(50)
    await act(async () => {
      await Promise.resolve()
      await Promise.resolve()
    })
    expect(capturedAmount!.feeQuote).toBe(20)

    // Reproduce the exact bug scenario: direct-transfer create fails — the
    // failure lands after the sending dwell and returns to 'confirm'.
    await act(async () => {
      await capturedAmount!.onConfirmSend!()
    })
    // Returning to 'confirm' re-runs the direct-fee effect — feed that quote
    feeMock.mockResolvedValueOnce({ fee: 20, availableBalance: 100 })
    await act(async () => {
      await new Promise((r) => setTimeout(r, 150))
    })
    expect(capturedAmount!.confirmError).not.toBeNull()

    // User taps the mint row — fee re-quotes for the new mint (call #2, the
    // FIRST quote under test — bumps the route epoch).
    feeMock.mockReturnValueOnce(firstPromise)
    act(() => {
      capturedAmount!.onChangeMint!('https://mint2.example.com')
    })

    // Finding 1: the stale "create failed" banner must be gone immediately,
    // not just once a new quote lands.
    expect(capturedAmount!.confirmError).toBeNull()
    expect(capturedAmount!.feeQuote).toBe('pending')

    // Before that FIRST quote resolves, the user changes mint again (call #3,
    // the SECOND/current quote — bumps the epoch a second time, making call
    // #2's in-flight promise stale).
    feeMock.mockReturnValueOnce(secondPromise)
    act(() => {
      capturedAmount!.onChangeMint!('https://mint3.example.com')
    })
    expect(capturedAmount!.confirmError).toBeNull()
    expect(capturedAmount!.feeQuote).toBe('pending')
    // 4 calls: confirm entry, failure-return re-quote, mint2, mint3
    expect(feeMock).toHaveBeenCalledTimes(4)
    expect(feeMock).toHaveBeenLastCalledWith('https://mint3.example.com', 50)

    // Resolve the STALE first quote (mint2's) — its value must NOT be applied;
    // the epoch guard discards it because a newer quote (mint3's) superseded it.
    await act(async () => {
      resolveFirst({ fee: 10, availableBalance: 100 })
      await Promise.resolve()
    })
    expect(capturedAmount!.feeQuote).toBe('pending')

    // Now resolve the CURRENT quote (mint3's) — this one commits.
    await act(async () => {
      resolveSecond({ fee: 12, availableBalance: 100 })
      await Promise.resolve()
    })
    expect(capturedAmount!.feeQuote).toBe(12)
  })

  it('holds a successful routed send on the receipt until the dwell elapses', async () => {
    const onExecuteRoute = vi.fn(async () => ({
      status: 'settled' as const,
      amount: 50,
      fee: 0,
      sourceMintUrl: 'https://mint.example.com',
      transactionId: 'tx-1',
      transportUsed: 'none' as const,
    }))

    render(
      <SendFlow
        {...baseProps}
        onExecuteRoute={onExecuteRoute}
        validatedData={{ type: 'bolt11', invoice: 'lnbc1test', amountSats: 50, expiry: 9999999999 }}
      />,
    )

    await act(async () => {
      await Promise.resolve()
      await Promise.resolve()
    })

    await act(async () => {
      await capturedAmount!.onConfirmSend!()
    })

    expect(onExecuteRoute).toHaveBeenCalledOnce()
    expect(capturedAmount!.sending).toBe(true)
    expect(completeMounted).toBe(false)

    await act(async () => {
      await new Promise((r) => setTimeout(r, 150))
    })

    expect(completeMounted).toBe(true)
  })

  it('returns a failed routed send to confirmation after the dwell', async () => {
    const onExecuteRoute = vi.fn(async () => null)

    render(
      <SendFlow
        {...baseProps}
        onExecuteRoute={onExecuteRoute}
        validatedData={{ type: 'bolt11', invoice: 'lnbc1test', amountSats: 50, expiry: 9999999999 }}
      />,
    )

    await act(async () => {
      await Promise.resolve()
      await Promise.resolve()
    })

    await act(async () => {
      await capturedAmount!.onConfirmSend!()
    })

    expect(capturedAmount!.sending).toBe(true)

    await act(async () => {
      await new Promise((r) => setTimeout(r, 150))
    })

    expect(capturedAmount!.sending).toBe(false)
    expect(capturedAmount!.confirmError).toBe('payment.sendFailed')
  })
})
