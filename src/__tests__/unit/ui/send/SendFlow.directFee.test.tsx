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
import type { ComponentProps } from 'react'
import type { SendInputStep as SendInputStepComponent } from '@/ui/screens/Send/steps/SendInputStep'
import type { SendAmountStep as SendAmountStepComponent } from '@/ui/screens/Send/steps/SendAmountStep'

type SendInputStepProps = ComponentProps<typeof SendInputStepComponent>
type SendAmountStepProps = ComponentProps<typeof SendAmountStepComponent>

// ============= Captured props (module-level, refreshed on every render) =============

let capturedInput: SendInputStepProps | null = null
let capturedAmount: SendAmountStepProps | null = null

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
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
  SendCompleteStep: () => null,
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
    estimateRouteFee: vi.fn(async () => ({ fee: 0 })),
  }),
  PaymentRoute: { CANNOT_SEND: -1 },
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
  onBack: vi.fn(),
  onComplete: vi.fn(),
  onExecuteRoute: vi.fn(),
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
    addToastMock.mockClear()
  })

  it('quotes pending then resolves ceil-clamped (29.4 -> 30)', async () => {
    let resolveFee: (value: number | null) => void = () => {}
    const feeMock = vi.fn(
      () =>
        new Promise<number | null>((resolve) => {
          resolveFee = resolve
        }),
    )

    render(<SendFlow {...baseProps} onEstimateCreateFee={feeMock} />)

    enterDirectConfirm(50)

    expect(capturedAmount!.directTransfer).toBe(true)
    expect(capturedAmount!.feeQuote).toBe('pending')
    expect(feeMock).toHaveBeenCalledWith('https://mint.example.com', 50)

    await act(async () => {
      resolveFee(29.4)
      await Promise.resolve()
    })

    expect(capturedAmount!.feeQuote).toBe(30)
  })

  it('unavailable fee (null) surfaces as feeQuote="unavailable"', async () => {
    const feeMock = vi.fn(async () => null)

    render(<SendFlow {...baseProps} onEstimateCreateFee={feeMock} />)

    enterDirectConfirm(50)

    await act(async () => {
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(capturedAmount!.feeQuote).toBe('unavailable')
  })

  it('epoch staleness: a stale first quote must not land after a mint change; confirmError clears too (Finding 1)', async () => {
    let resolveFirst: (value: number | null) => void = () => {}
    const firstPromise = new Promise<number | null>((resolve) => {
      resolveFirst = resolve
    })
    let resolveSecond: (value: number | null) => void = () => {}
    const secondPromise = new Promise<number | null>((resolve) => {
      resolveSecond = resolve
    })

    // Call #1 resolves the *initial* confirm-entry quote immediately (so we can
    // drive a failed create and populate state.error before the epoch case).
    // Calls #2/#3 are the stale/current pair under test, queued via
    // mockReturnValueOnce right before the mint changes that trigger them.
    const feeMock = vi.fn().mockResolvedValueOnce(20)
    const onCreateToken = vi.fn().mockRejectedValue(new Error('create failed'))

    render(<SendFlow {...baseProps} onEstimateCreateFee={feeMock} onCreateToken={onCreateToken} />)

    enterDirectConfirm(50)
    await act(async () => {
      await Promise.resolve()
      await Promise.resolve()
    })
    expect(capturedAmount!.feeQuote).toBe(20)

    // Reproduce the exact bug scenario: direct-transfer create fails (catch
    // sets state.error, step stays 'confirm') — the banner is now stale.
    await act(async () => {
      await capturedAmount!.onConfirmSend!()
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
    expect(feeMock).toHaveBeenCalledTimes(3)
    expect(feeMock).toHaveBeenLastCalledWith('https://mint3.example.com', 50)

    // Resolve the STALE first quote (mint2's) — its value must NOT be applied;
    // the epoch guard discards it because a newer quote (mint3's) superseded it.
    await act(async () => {
      resolveFirst(10)
      await Promise.resolve()
    })
    expect(capturedAmount!.feeQuote).toBe('pending')

    // Now resolve the CURRENT quote (mint3's) — this one commits.
    await act(async () => {
      resolveSecond(12)
      await Promise.resolve()
    })
    expect(capturedAmount!.feeQuote).toBe(12)
  })
})
