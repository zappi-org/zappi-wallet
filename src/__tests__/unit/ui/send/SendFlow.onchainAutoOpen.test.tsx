import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, act } from '@testing-library/react'
import { SendFlow } from '@/ui/screens/Send/SendFlow'

import type { ComponentProps, ReactNode } from 'react'
import type { SendInputStep as SendInputStepComponent } from '@/ui/screens/Send/steps/SendInputStep'
import type { SwapOutFlow as SwapOutFlowComponent } from '@/ui/screens/SwapOut/SwapOutFlow'

type SendInputStepProps = ComponentProps<typeof SendInputStepComponent>
type SwapOutFlowProps = ComponentProps<typeof SwapOutFlowComponent>

const payoutFlag = vi.hoisted(() => ({ enabled: false }))
let capturedInput: SendInputStepProps | null = null
let payoutFlowProps: SwapOutFlowProps[] = []

const SOURCE = 'https://mint.example.com'
const ADDRESS = 'bcrt1qautoopenaddress'

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
  SendAmountStep: () => null,
}))

vi.mock('@/ui/screens/Send/steps/SendCompleteStep', () => ({
  SendCompleteStep: () => null,
}))

vi.mock('@/ui/screens/Send/steps/DirectReceiptStep', () => ({
  DirectReceiptStep: () => null,
}))

vi.mock('@/ui/components/payment/MintSelectBottomSheet', () => ({
  MintSelectBottomSheet: () => null,
}))

vi.mock('@/ui/screens/SwapOut/SwapOutFlow', () => ({
  SwapOutFlow: (props: SwapOutFlowProps) => {
    payoutFlowProps.push(props)
    return <div data-testid="swap-out-flow">{props.address}</div>
  },
}))

vi.mock('@/ui/hooks/use-swap-out', () => ({
  useSwapOut: () => ({ isEnabled: payoutFlag.enabled }),
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
    estimateRouteFee: vi.fn(),
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

const storeState = {
  addToast: vi.fn(),
  settings: { relays: [], mints: [SOURCE] },
  balance: { byMint: { [SOURCE]: 10000 } },
  nostrPrivkey: null,
}

vi.mock('@/store', () => {
  const useAppStore = Object.assign((selector: (s: typeof storeState) => unknown) => selector(storeState), {
    getState: () => storeState,
  })
  return { useAppStore }
})

const baseProps = {
  sendingDwellMs: 0,
  onBack: vi.fn(),
  onComplete: vi.fn(),
  onExecuteRoute: vi.fn(),
  onResolveInvoice: vi.fn(async () => 'lnbc1resolved'),
  onCreateToken: vi.fn(),
  directMintUrl: SOURCE,
  initialMintUrl: SOURCE,
  validatedData: { type: 'bitcoin-address' as const, address: ADDRESS, amountSats: 5000 },
}

describe('SendFlow on-chain payout auto-open', () => {
  beforeEach(() => {
    payoutFlag.enabled = false
    capturedInput = null
    payoutFlowProps = []
  })

  it('opens the payout flow once the feature becomes available after mount', () => {
    const { rerender, queryByTestId } = render(<SendFlow {...baseProps} />)
    expect(queryByTestId('swap-out-flow')).not.toBeInTheDocument()
    expect(capturedInput).not.toBeNull()

    payoutFlag.enabled = true
    rerender(<SendFlow {...baseProps} />)

    expect(queryByTestId('swap-out-flow')).toHaveTextContent(ADDRESS)
    expect(payoutFlowProps.at(-1)).toMatchObject({ address: ADDRESS, amountSats: 5000 })
  })

  it('does not reopen after the user closes the auto-opened flow', () => {
    const { rerender, queryByTestId } = render(<SendFlow {...baseProps} />)
    payoutFlag.enabled = true
    rerender(<SendFlow {...baseProps} />)
    expect(queryByTestId('swap-out-flow')).toBeInTheDocument()

    act(() => {
      payoutFlowProps.at(-1)!.onClose()
    })
    rerender(<SendFlow {...baseProps} />)
    expect(queryByTestId('swap-out-flow')).not.toBeInTheDocument()
  })

  it('stays on the input step when the user edited the destination before the feature became available', () => {
    const { rerender, queryByTestId } = render(<SendFlow {...baseProps} />)
    act(() => {
      capturedInput!.onDestinationEdit!()
    })

    payoutFlag.enabled = true
    rerender(<SendFlow {...baseProps} />)
    expect(queryByTestId('swap-out-flow')).not.toBeInTheDocument()
  })

  it('opens immediately when the feature is already available at mount', () => {
    payoutFlag.enabled = true
    const { queryByTestId } = render(<SendFlow {...baseProps} />)
    expect(queryByTestId('swap-out-flow')).toHaveTextContent(ADDRESS)
  })

  it('opens the payout flow without an address from the visible Send entry', () => {
    payoutFlag.enabled = true
    const { queryByTestId } = render(<SendFlow {...baseProps} validatedData={undefined} />)
    expect(queryByTestId('swap-out-flow')).not.toBeInTheDocument()
    expect(capturedInput!.onSwapOut).toBeTypeOf('function')

    act(() => {
      capturedInput!.onSwapOut!()
    })
    expect(queryByTestId('swap-out-flow')).toBeInTheDocument()
    expect(payoutFlowProps.at(-1)!.address).toBeUndefined()
  })

  it('prefills the address when an address is entered in Send', () => {
    payoutFlag.enabled = true
    const { queryByTestId } = render(<SendFlow {...baseProps} validatedData={undefined} />)
    act(() => {
      capturedInput!.onBitcoinAddress!({ address: ADDRESS, amountSats: 7000 })
    })
    expect(queryByTestId('swap-out-flow')).toHaveTextContent(ADDRESS)
    expect(payoutFlowProps.at(-1)).toMatchObject({ address: ADDRESS, amountSats: 7000 })
  })

  it('does not offer the Send entry while the feature is off', () => {
    render(<SendFlow {...baseProps} validatedData={undefined} />)
    expect(capturedInput!.onSwapOut).toBeUndefined()
  })
})
