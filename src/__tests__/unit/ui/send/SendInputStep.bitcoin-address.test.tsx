import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, act } from '@testing-library/react'

import { SendInputStep } from '@/ui/screens/Send/steps/SendInputStep'
import type { InputType, ValidatedData } from '@/core/domain/input-types'
import { ServiceProvider } from '@/ui/hooks/service-context'
import type { ServiceRegistry } from '@/core/ports/driving/service-registry'

const mockDetectAndClassify = vi.fn<(input: string) => InputType>()
const mockValidateAsync = vi.fn<(input: InputType) => Promise<ValidatedData>>()
const mockInputParser = { detectAndClassify: mockDetectAndClassify, validateAsync: mockValidateAsync }
const stableT = (key: string) => key
const stableAddToast = vi.fn()
const stableStore = { settings: { mints: [] }, addToast: stableAddToast }
const mockFindByAddress = vi.fn(async () => null)
const mockContacts: never[] = []
const mockNostrDirectPayment = { resolve: vi.fn() }
const swapOutEnabled = { value: false }
const mockSwapOut = { isEnabled: () => swapOutEnabled.value }
const mockRegistry = {
  nostrDirectPayment: mockNostrDirectPayment,
  swapOut: mockSwapOut,
} as unknown as ServiceRegistry

vi.mock('@/ui/hooks/use-input-parser', () => ({
  useInputParser: () => mockInputParser,
}))

vi.mock('@/store', () => ({
  useAppStore: (selector: (s: typeof stableStore) => unknown) => selector(stableStore),
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: stableT }),
  Trans: ({ i18nKey }: { i18nKey: string }) => <span>{i18nKey}</span>,
}))

vi.mock('@/ui/hooks/use-mint-metadata', () => ({
  useMintMetadata: () => ({
    getDisplayName: (url: string) => url,
    getIconUrl: () => undefined,
  }),
}))

vi.mock('@/ui/hooks/use-contacts', () => ({
  useContacts: () => ({ contacts: mockContacts, isReady: true, findByAddress: mockFindByAddress }),
}))

vi.mock('@/ui/utils/haptic', () => ({
  hapticTap: vi.fn(),
}))
vi.mock('@/ui/components/common/QrScannerModal', () => ({
  QrScannerModal: () => null,
}))

vi.mock('@/ui/components/common/ScreenHeader', () => ({
  ScreenHeader: ({ title, onBack }: { title: string; onBack: () => void }) => (
    <div data-testid="screen-header">
      <button onClick={onBack}>back</button>
      <span>{title}</span>
    </div>
  ),
}))

vi.mock('@/ui/components/icons/CameraFilled', () => ({
  CameraFilled: (props: Record<string, unknown>) => <svg data-testid="camera-icon" {...props} />,
}))

const defaultProps = {
  onBitcoinAddress: vi.fn(),
  onBack: vi.fn(),
  onNext: vi.fn(),
  onDirectTransfer: vi.fn(),
  mintUrl: 'https://mint.example.com',
}

function renderStep(overrides: Partial<typeof defaultProps> & { onSwapOut?: () => void } = {}) {
  return render(
    <ServiceProvider registry={mockRegistry}>
      <SendInputStep {...defaultProps} {...overrides} />
    </ServiceProvider>
  )
}

function typeIntoInput(value: string) {
  const input = screen.getByPlaceholderText('send.destination.placeholder')
  act(() => {
    ;(input as HTMLInputElement).focus()
    Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      'value',
    )!.set!.call(input, value)
    input.dispatchEvent(new Event('input', { bubbles: true }))
    input.dispatchEvent(new Event('change', { bubbles: true }))
  })
}

const ADDRESS = 'bcrt1qw508d6qejxtdg4y5r3zarvary0c5xw7kygt080'

describe('SendInputStep bitcoin address', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    mockDetectAndClassify.mockReset()
    mockDetectAndClassify.mockReturnValue({ type: 'bitcoin-address', address: ADDRESS, amountSats: 50000 })
    defaultProps.onBitcoinAddress.mockReset()
    defaultProps.onNext.mockReset()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('shows an inline unavailable message and stays on the input step when the feature is off', async () => {
    swapOutEnabled.value = false
    renderStep()
    typeIntoInput(ADDRESS)
    await act(async () => { vi.advanceTimersByTime(600) })
    expect(screen.getByText('swapOut.unavailable')).toBeInTheDocument()
    expect(screen.queryByText('send.destination.unrecognized')).not.toBeInTheDocument()
    expect(defaultProps.onBitcoinAddress).not.toHaveBeenCalled()
    expect(defaultProps.onNext).not.toHaveBeenCalled()
  })

  it('hands the address to the payout flow when the feature is on', async () => {
    swapOutEnabled.value = true
    renderStep()
    typeIntoInput(ADDRESS)
    await act(async () => { vi.advanceTimersByTime(600) })
    expect(screen.queryByText('swapOut.unavailable')).not.toBeInTheDocument()
    expect(screen.queryByText('send.destination.unrecognized')).not.toBeInTheDocument()
    const nextButton = screen.getByRole('button', { name: 'send.next' })
    expect(nextButton).not.toBeDisabled()
    await act(async () => { nextButton.click(); await vi.runAllTimersAsync() })
    expect(defaultProps.onBitcoinAddress).toHaveBeenCalledWith({ address: ADDRESS, amountSats: 50000 })
    expect(defaultProps.onNext).not.toHaveBeenCalled()
  })

  it('offers a visible entry to send to a bitcoin address while the input is empty', () => {
    const onSwapOut = vi.fn()
    renderStep({ onSwapOut })
    const entry = screen.getByTestId('send-swap-out-entry')
    expect(entry).toHaveTextContent('swapOut.entry')
    act(() => { entry.click() })
    expect(onSwapOut).toHaveBeenCalledTimes(1)
  })

  it('hides the entry once a destination is typed or when the feature is off', () => {
    const onSwapOut = vi.fn()
    const { unmount } = renderStep({ onSwapOut })
    typeIntoInput('someone@example.com')
    expect(screen.queryByTestId('send-swap-out-entry')).not.toBeInTheDocument()
    unmount()
    renderStep()
    expect(screen.queryByTestId('send-swap-out-entry')).not.toBeInTheDocument()
  })
})
