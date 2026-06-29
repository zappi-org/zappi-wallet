import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, act } from '@testing-library/react'

import { SendInputStep } from '@/ui/screens/Send/steps/SendInputStep'
import type { InputType, ValidatedData } from '@/core/domain/input-types'
import { ServiceProvider } from '@/ui/hooks/service-context'
import type { ServiceRegistry } from '@/core/ports/driving/service-registry'

// ─── Mocks ───

const mockDetectAndClassify = vi.fn<(input: string) => InputType>()
const mockValidateAsync = vi.fn<(input: InputType) => Promise<ValidatedData>>()
const mockInputParser = { detectAndClassify: mockDetectAndClassify, validateAsync: mockValidateAsync }
const stableT = (key: string) => key
const stableAddToast = vi.fn()
const stableStore = { settings: { mints: [] }, addToast: stableAddToast }
const mockFindByAddress = vi.fn(async () => null)
const mockContacts: never[] = []
const mockNostrDirectPayment = { resolve: vi.fn() }
const mockRegistry = { nostrDirectPayment: mockNostrDirectPayment } as unknown as ServiceRegistry

vi.mock('@/ui/hooks/use-input-parser', () => ({
  useInputParser: () => mockInputParser,
}))

vi.mock('@/store', () => ({
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  useAppStore: (selector: (s: typeof stableStore) => any) => selector(stableStore),
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
  useContacts: () => ({ contacts: mockContacts, findByAddress: mockFindByAddress }),
}))

vi.mock('@/ui/utils/haptic', () => ({
  hapticTap: vi.fn(),
}))

// Stub child components that are heavy / irrelevant
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

// ─── Helpers ───

const defaultProps = {
  onBack: vi.fn(),
  onNext: vi.fn(),
  mintUrl: 'https://mint.example.com',
}

function renderStep(overrides: Partial<typeof defaultProps> = {}) {
  return render(
    <ServiceProvider registry={mockRegistry}>
      <SendInputStep {...defaultProps} {...overrides} />
    </ServiceProvider>
  )
}

/** Type into the destination input via native onChange (works with fake timers) */
function typeIntoInput(value: string) {
  const input = screen.getByPlaceholderText('send.destination.placeholder')
  // Fire change event directly — userEvent.type doesn't play well with fake timers
  act(() => {
    ;(input as HTMLInputElement).focus()
    // Simulate typing by setting value and firing change
    Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      'value',
    )!.set!.call(input, value)
    input.dispatchEvent(new Event('input', { bubbles: true }))
    input.dispatchEvent(new Event('change', { bubbles: true }))
  })
}

// ─── Suite ───

describe('SendInputStep pre-validation', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    mockDetectAndClassify.mockReset()
    mockValidateAsync.mockReset()
    mockFindByAddress.mockClear()
    mockNostrDirectPayment.resolve.mockReset()
    defaultProps.onBack.mockReset()
    defaultProps.onNext.mockReset()

    // Default: classify returns unknown
    mockDetectAndClassify.mockReturnValue({ type: 'unknown', input: '' })
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  // ─── Test 1 ───
  it('lightning-address triggers validateAsync after 500ms debounce', async () => {
    mockDetectAndClassify.mockReturnValue({
      type: 'lightning-address',
      address: 'test@stacker.news',
    })
    mockValidateAsync.mockResolvedValue({
      type: 'lightning-address',
      address: 'test@stacker.news',
      lnurlParams: { callback: '', minSendable: 0, maxSendable: 100000, metadata: '', tag: 'payRequest' as const, domain: 'stacker.news' },
    })

    renderStep()
    typeIntoInput('test@stacker.news')

    // At 499ms — NOT yet called
    await act(async () => { vi.advanceTimersByTime(499) })
    expect(mockValidateAsync).not.toHaveBeenCalled()

    // At 500ms — called
    await act(async () => { vi.advanceTimersByTime(1) })
    expect(mockValidateAsync).toHaveBeenCalledTimes(1)
  })

  // ─── Test 2 ───
  it('lnurl triggers validateAsync after 500ms debounce', async () => {
    const lnurlStr = 'lnurl1dp68gurn8ghj7ampd3kx2ar0veekzar0wd5xjtnrdakj7tnhv4kxctttdehhwm30d3h82unvwqhkxmmww4hxjmn8v96x7'
    mockDetectAndClassify.mockReturnValue({ type: 'lnurl', lnurl: lnurlStr })
    mockValidateAsync.mockResolvedValue({
      type: 'lnurl-pay',
      lnurl: lnurlStr,
      params: { callback: '', minSendable: 0, maxSendable: 100000, metadata: '', tag: 'payRequest' as const, domain: 'example.com' },
    })

    renderStep()
    typeIntoInput(lnurlStr)

    await act(async () => { vi.advanceTimersByTime(500) })
    expect(mockValidateAsync).toHaveBeenCalledTimes(1)
  })

  // ─── Test 3 ───
  it('invalid format (TLD < 2 chars) does NOT trigger validateAsync', async () => {
    // detectAndClassify returns lightning-address but format gate rejects it
    mockDetectAndClassify.mockReturnValue({
      type: 'lightning-address',
      address: 'user@d.c',
    })

    renderStep()
    typeIntoInput('user@d.c')

    await act(async () => { vi.advanceTimersByTime(500) })
    // looksLikeLightningAddress("user@d.c") is false (TLD "c" < 2 chars)
    // so needsPreValidation is false → validateAsync NOT called
    expect(mockValidateAsync).not.toHaveBeenCalled()
  })

  // ─── Test 4 ───
  it('staleness — second input discards first validation result', async () => {
    // Track onNext calls to verify validatedData
    const onNext = vi.fn()

    let resolveFirst!: (v: ValidatedData) => void
    let resolveSecond!: (v: ValidatedData) => void

    const firstPromise = new Promise<ValidatedData>((r) => { resolveFirst = r })
    const secondPromise = new Promise<ValidatedData>((r) => { resolveSecond = r })

    mockDetectAndClassify.mockReturnValue({
      type: 'lightning-address',
      address: 'alice@mint1.com',
    })
    mockValidateAsync
      .mockReturnValueOnce(firstPromise)
      .mockReturnValueOnce(secondPromise)

    renderStep({ onNext })

    // Type first input and trigger debounce
    typeIntoInput('alice@mint1.com')
    await act(async () => { vi.advanceTimersByTime(500) })
    expect(mockValidateAsync).toHaveBeenCalledTimes(1)

    // Type second input — this clears previous state via updateDestination
    mockDetectAndClassify.mockReturnValue({
      type: 'lightning-address',
      address: 'bob@mint2.com',
    })
    typeIntoInput('bob@mint2.com')
    await act(async () => { vi.advanceTimersByTime(500) })
    expect(mockValidateAsync).toHaveBeenCalledTimes(2)

    // Resolve first — should be discarded (stale requestId)
    await act(async () => {
      resolveFirst({
        type: 'lightning-address',
        address: 'alice@mint1.com',
        lnurlParams: { callback: '', minSendable: 0, maxSendable: 100000, metadata: '', tag: 'payRequest' as const, domain: 'mint1.com' },
      })
    })
    // No error shown, no validatedData set from first

    // Resolve second — should be accepted
    await act(async () => {
      resolveSecond({
        type: 'lightning-address',
        address: 'bob@mint2.com',
        lnurlParams: { callback: '', minSendable: 0, maxSendable: 100000, metadata: '', tag: 'payRequest' as const, domain: 'mint2.com' },
      })
    })

    // Spinner should be gone (pre-validation finished)
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
    // No error shown
    expect(screen.queryByText('send.destination.validationFailed')).not.toBeInTheDocument()
  })

  // ─── Test 5 ───
  it('network error shows inline error message', async () => {
    mockDetectAndClassify.mockReturnValue({
      type: 'lightning-address',
      address: 'test@failing.com',
    })
    mockValidateAsync.mockRejectedValue(new Error('Network error'))

    renderStep()
    typeIntoInput('test@failing.com')

    await act(async () => { vi.advanceTimersByTime(500) })
    // Let rejected promise settle
    await act(async () => { await vi.runAllTimersAsync() })

    expect(screen.getByText('send.destination.validationFailed')).toBeInTheDocument()
  })

  // ─── Test 6 ───
  it('lnurl-withdraw shows specific error, validatedData not set', async () => {
    const lnurlStr = 'lnurl1withdraw...'
    mockDetectAndClassify.mockReturnValue({ type: 'lnurl', lnurl: lnurlStr })
    mockValidateAsync.mockResolvedValue({
      type: 'lnurl-withdraw',
      lnurl: lnurlStr,
      params: { callback: '', k1: 'abc', minWithdrawable: 0, maxWithdrawable: 100000, domain: 'example.com' },
    })

    renderStep()
    typeIntoInput(lnurlStr)

    await act(async () => { vi.advanceTimersByTime(500) })
    await act(async () => { await vi.runAllTimersAsync() })

    expect(screen.getByText('send.destination.lnurlWithdrawNotSupported')).toBeInTheDocument()
    // Next button should be disabled
    const nextButton = screen.getByRole('button', { name: 'send.next' })
    expect(nextButton).toBeDisabled()
  })

  // ─── Test 7 ───
  it('error container has reserved h-5 height even when empty', () => {
    renderStep()
    const errorArea = screen.getByTestId('pre-validation-error-area')
    expect(errorArea).toBeInTheDocument()
    expect(errorArea.className).toContain('h-5')
  })

  // ─── Test 8 ───
  it('spinner visible during async validation, hidden after', async () => {
    let resolveValidation!: (v: ValidatedData) => void
    const validationPromise = new Promise<ValidatedData>((r) => { resolveValidation = r })

    mockDetectAndClassify.mockReturnValue({
      type: 'lightning-address',
      address: 'test@stacker.news',
    })
    mockValidateAsync.mockReturnValue(validationPromise)

    renderStep()
    typeIntoInput('test@stacker.news')

    await act(async () => { vi.advanceTimersByTime(500) })

    // Spinner should be visible
    expect(screen.getByRole('status')).toBeInTheDocument()
    expect(screen.getByRole('status')).toBeInTheDocument()

    // Resolve validation
    await act(async () => {
      resolveValidation({
        type: 'lightning-address',
        address: 'test@stacker.news',
        lnurlParams: { callback: '', minSendable: 0, maxSendable: 100000, metadata: '', tag: 'payRequest' as const, domain: 'stacker.news' },
      })
    })

    // Spinner should be hidden
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
  })

  // ─── Test 9 ───
  it('cashu-request path still works (regression guard)', async () => {
    const creqStr = 'creqAabc123...'
    mockDetectAndClassify.mockReturnValue({
      type: 'cashu-request',
      request: creqStr,
    })
    mockValidateAsync.mockResolvedValue({
      type: 'cashu-request',
      request: creqStr,
      parsed: {
        id: 'abc',
        unit: 'sat',
        mints: [],
        transports: [],
        hasNostrTransport: false,
        hasPostTransport: false,
      },
    })

    renderStep()
    typeIntoInput(creqStr)

    await act(async () => { vi.advanceTimersByTime(500) })
    await act(async () => { await vi.runAllTimersAsync() })

    // detectAndClassify and validateAsync should have been called
    expect(mockDetectAndClassify).toHaveBeenCalledWith(creqStr)
    expect(mockValidateAsync).toHaveBeenCalledTimes(1)

    // No pre-validation spinner or error for cashu-request path
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
    expect(screen.queryByText('send.destination.validationFailed')).not.toBeInTheDocument()
  })

  // ─── Test 10 ───
  it('input change immediately clears previous validatedData and error', async () => {
    mockDetectAndClassify.mockReturnValue({
      type: 'lightning-address',
      address: 'test@stacker.news',
    })
    mockValidateAsync.mockResolvedValue({
      type: 'lightning-address',
      address: 'test@stacker.news',
      lnurlParams: { callback: '', minSendable: 0, maxSendable: 100000, metadata: '', tag: 'payRequest' as const, domain: 'stacker.news' },
    })

    renderStep()
    typeIntoInput('test@stacker.news')

    // Let validation complete
    await act(async () => { vi.advanceTimersByTime(500) })
    await act(async () => { await vi.runAllTimersAsync() })

    // Validation succeeded — badge should show
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
    expect(screen.queryByText('send.destination.validationFailed')).not.toBeInTheDocument()

    // Now change input — clears validatedData and error, shows spinner (pessimistic pattern)
    mockDetectAndClassify.mockReturnValue({ type: 'unknown', input: 'test@stacker.newsx' })
    typeIntoInput('test@stacker.newsx')

    // Immediately after change: error cleared, spinner shows (pending re-evaluation)
    expect(screen.queryByText('send.destination.validationFailed')).not.toBeInTheDocument()
    expect(screen.getByRole('status')).toBeInTheDocument()

    // After debounce: spinner clears, unrecognized error shown
    await act(async () => { vi.advanceTimersByTime(500) })
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
    expect(screen.getByText('send.destination.unrecognized')).toBeInTheDocument()
  })

  // ─── Test 11 ───
  it('cashu-request with amount auto-advances after debounce + timer', async () => {
    const creqStr = 'creqAtest...'
    mockDetectAndClassify.mockReturnValue({ type: 'cashu-request', request: creqStr })
    mockValidateAsync.mockResolvedValue({
      type: 'cashu-request',
      request: creqStr,
      parsed: {
        id: 'test',
        amount: 100,
        unit: 'sat',
        mints: [],
        transports: [],
        hasNostrTransport: false,
        hasPostTransport: false,
      },
    })

    renderStep()
    typeIntoInput(creqStr)

    // 500ms debounce fires → validateAsync called
    await act(async () => { vi.advanceTimersByTime(500) })
    expect(mockValidateAsync).toHaveBeenCalledTimes(1)

    // 300ms auto-advance timer fires → onNext called
    await act(async () => { vi.advanceTimersByTime(300) })
    expect(defaultProps.onNext).toHaveBeenCalledWith(
      expect.objectContaining({ amountFromInvoice: 100 })
    )
  })

  // ─── Test 12 ───
  it('cashu-request without amount does NOT auto-advance', async () => {
    const creqStr = 'creqBnoamount...'
    mockDetectAndClassify.mockReturnValue({ type: 'cashu-request', request: creqStr })
    mockValidateAsync.mockResolvedValue({
      type: 'cashu-request',
      request: creqStr,
      parsed: {
        id: 'test',
        amount: 0,
        unit: 'sat',
        mints: [],
        transports: [],
        hasNostrTransport: false,
        hasPostTransport: false,
      },
    })

    renderStep()
    typeIntoInput(creqStr)

    // 500ms debounce + 300ms + extra — should never auto-advance
    await act(async () => { vi.advanceTimersByTime(500) })
    await act(async () => { vi.advanceTimersByTime(300) })
    await act(async () => { vi.advanceTimersByTime(200) })

    expect(defaultProps.onNext).not.toHaveBeenCalled()
  })

  // ─── Test 13 ───
  it('back-navigation guard — same destination does NOT re-trigger auto-advance', async () => {
    const creqStr = 'creqCbacknav...'
    mockDetectAndClassify.mockReturnValue({ type: 'cashu-request', request: creqStr })
    mockValidateAsync.mockResolvedValue({
      type: 'cashu-request',
      request: creqStr,
      parsed: {
        id: 'test',
        amount: 100,
        unit: 'sat',
        mints: [],
        transports: [],
        hasNostrTransport: false,
        hasPostTransport: false,
      },
    })

    renderStep()
    typeIntoInput(creqStr)

    // First auto-advance: debounce (500ms) + timer (300ms)
    await act(async () => { vi.advanceTimersByTime(500) })
    await act(async () => { vi.advanceTimersByTime(300) })
    expect(defaultProps.onNext).toHaveBeenCalledTimes(1)

    // Reset mock
    defaultProps.onNext.mockReset()

    // Type the SAME value again (simulates re-render with preserved destination after back-nav)
    typeIntoInput(creqStr)

    // Wait for debounce + auto-advance timer
    await act(async () => { vi.advanceTimersByTime(500) })
    await act(async () => { vi.advanceTimersByTime(300) })

    // onNext should NOT be called again
    expect(defaultProps.onNext).not.toHaveBeenCalled()
  })

  // ─── Test 14 ───
  it('input change cancels pending auto-advance timer', async () => {
    const creqStr = 'creqDcancel...'
    mockDetectAndClassify.mockReturnValue({ type: 'cashu-request', request: creqStr })
    mockValidateAsync.mockResolvedValue({
      type: 'cashu-request',
      request: creqStr,
      parsed: {
        id: 'test',
        amount: 100,
        unit: 'sat',
        mints: [],
        transports: [],
        hasNostrTransport: false,
        hasPostTransport: false,
      },
    })

    renderStep()
    typeIntoInput(creqStr)

    // 500ms debounce fires → validateAsync resolves → 300ms auto-advance timer starts
    await act(async () => { vi.advanceTimersByTime(500) })
    expect(mockValidateAsync).toHaveBeenCalledTimes(1)

    // BEFORE 300ms elapses, change input (clears timer via updateDestination)
    mockDetectAndClassify.mockReturnValue({ type: 'unknown', input: 'changed-input' })
    typeIntoInput('changed-input')

    // Advance past when the timer would have fired + new debounce
    await act(async () => { vi.advanceTimersByTime(300) })
    await act(async () => { vi.advanceTimersByTime(500) })

    // onNext should NOT have been called (timer was cleared)
    expect(defaultProps.onNext).not.toHaveBeenCalled()
  })
})
