/**
 * A my-wallet transfer must never quote or settle source === target.
 *
 * The amount step already hides the target from the source picker; this is the
 * last gate before money moves — the route is a Lightning round trip, so a
 * self-transfer would charge a real fee to move nothing.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, act } from '@testing-library/react'
import { SendFlow } from '@/ui/screens/Send/SendFlow'

import type { ComponentProps, ReactNode } from 'react'
import type { SendInputStep as SendInputStepComponent } from '@/ui/screens/Send/steps/SendInputStep'
import type { SendAmountStep as SendAmountStepComponent } from '@/ui/screens/Send/steps/SendAmountStep'

type SendInputStepProps = ComponentProps<typeof SendInputStepComponent>
type SendAmountStepProps = ComponentProps<typeof SendAmountStepComponent>

let capturedInput: SendInputStepProps | null = null
let capturedAmount: SendAmountStepProps | null = null
const estimateRouteFeeMock = vi.hoisted(() => vi.fn())

const SOURCE = 'https://mint.example.com'
const TARGET = 'https://target.mint'
/** Same mint as TARGET, written differently (case + :443 + trailing slash). */
const TARGET_VARIANT = 'https://Target.Mint:443/'

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
  SendCompleteStep: () => null,
}))

// DirectReceiptStep transitively imports QRCodeDisplay (bc-ur -> cborg, whose
// exports map vitest can't resolve) — stub the whole step; it has its own test.
vi.mock('@/ui/screens/Send/steps/DirectReceiptStep', () => ({
  DirectReceiptStep: () => null,
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
  settings: { relays: [], mints: [SOURCE, TARGET] },
  balance: { byMint: { [SOURCE]: 10000, [TARGET]: 10000 } },
  nostrPrivkey: null,
}

vi.mock('@/store', () => {
  const useAppStore = Object.assign((selector: (s: typeof storeState) => unknown) => selector(storeState), {
    getState: () => storeState,
  })
  return { useAppStore }
})

const baseProps = {
  sendingDwellMs: 120,
  onBack: vi.fn(),
  onComplete: vi.fn(),
  onExecuteRoute: vi.fn(),
  onResolveInvoice: vi.fn(async () => 'lnbc1resolved'),
  onCreateToken: vi.fn(),
  directMintUrl: SOURCE,
  initialMintUrl: SOURCE,
}

const MY_WALLET_TARGET = {
  type: 'my-wallet' as const,
  targetMintUrl: TARGET,
  targetMintName: 'Target Wallet',
}

/** Destination step → amount step with the my-wallet target armed. */
async function enterAmountStepWithTransfer() {
  await act(async () => {
    await capturedInput!.onNext({
      destination: MY_WALLET_TARGET.targetMintName,
      validatedData: MY_WALLET_TARGET,
      mintUrl: SOURCE,
    })
  })
}

/** Amount step → confirm, letting the initial-route effect quote. */
async function confirmAmount(amount = 1000) {
  await act(async () => {
    capturedAmount!.onNext({ amount, memo: '', isFiatMode: false, fiatAmount: '' })
  })
  await act(async () => {
    await Promise.resolve()
    await Promise.resolve()
  })
}

describe('SendFlow my-wallet self-transfer guard', () => {
  beforeEach(() => {
    capturedInput = null
    capturedAmount = null
    addToastMock.mockClear()
    estimateRouteFeeMock.mockReset()
    estimateRouteFeeMock.mockResolvedValue({ fee: 4, availableBalance: 10000, totalNeeded: 1004 })
  })

  it('refuses to quote when the source mint is a notation variant of the transfer target', async () => {
    render(<SendFlow {...baseProps} />)
    await enterAmountStepWithTransfer()

    // The picker can no longer offer this; the guard must hold anyway.
    await act(async () => {
      capturedAmount!.onChangeMint!(TARGET_VARIANT)
    })
    await confirmAmount()

    expect(estimateRouteFeeMock).not.toHaveBeenCalled()
    expect(addToastMock).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'error', message: 'payment.cannotSend' }),
    )
    expect(capturedAmount!.feeQuote).toBe('unavailable')
  })

  it('a genuine cross-mint transfer still quotes normally', async () => {
    render(<SendFlow {...baseProps} />)
    await enterAmountStepWithTransfer()
    await confirmAmount()

    expect(estimateRouteFeeMock).toHaveBeenCalledWith(3, SOURCE, 1000, TARGET, undefined)
    expect(addToastMock).not.toHaveBeenCalled()
    expect(capturedAmount!.feeQuote).toBe(4)
  })
})
