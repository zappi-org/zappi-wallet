import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, act } from '@testing-library/react'
import { amount } from '@/core/domain/amount'

import { SendInputStep } from '@/ui/screens/Send/steps/SendInputStep'
import type { InputType, ValidatedData } from '@/core/domain/input-types'
import { ServiceProvider } from '@/ui/hooks/service-context'
import type { ServiceRegistry } from '@/core/ports/driving/service-registry'

// ─── Mocks (same as prevalidation test) ───

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
  onRedirect: vi.fn(),
  onRouteValidated: vi.fn(),
  mintUrl: 'https://mint.example.com',
}

function renderStep(overrides: Partial<typeof defaultProps> = {}) {
  return render(
    <ServiceProvider registry={mockRegistry}>
      <SendInputStep {...defaultProps} {...overrides} />
    </ServiceProvider>
  )
}

/** Simulate paste via native event (triggers processExternalInput path) */
function pasteIntoInput(text: string) {
  const input = screen.getByPlaceholderText('send.destination.placeholder')
  const event = new Event('paste', { bubbles: true, cancelable: true })
  ;(event as unknown as Record<string, unknown>).clipboardData = { getData: () => text }
  input.dispatchEvent(event)
}

/** Type into the destination input via native onChange (works with fake timers) */
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

// ─── Suite ───

describe('SendInputStep redirect', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    mockDetectAndClassify.mockReset()
    mockValidateAsync.mockReset()
    mockFindByAddress.mockClear()
    mockNostrDirectPayment.resolve.mockReset()
    defaultProps.onBack.mockReset()
    defaultProps.onNext.mockReset()
    defaultProps.onRedirect.mockReset()
    defaultProps.onRouteValidated.mockReset()
    stableAddToast.mockReset()

    mockDetectAndClassify.mockReturnValue({ type: 'unknown', input: '' })
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('cashu-token paste routes via universal router (onRouteValidated)', async () => {
    const tokenStr = 'cashuAeyJ0b2tlbiI6W3sicHJvb2ZzIjpbXX1dfQ=='
    mockDetectAndClassify.mockReturnValue({
      type: 'cashu-token',
      token: tokenStr,
      amount: amount(100, 'sat'),
      mintUrl: 'https://mint.example.com',
    })
    mockValidateAsync.mockResolvedValue({
      type: 'cashu-token',
      token: tokenStr,
      amount: amount(100, 'sat'),
      mintUrl: 'https://mint.example.com',
    })

    renderStep()
    await act(async () => { pasteIntoInput(tokenStr) })

    expect(defaultProps.onRouteValidated).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'cashu-token', amount: amount(100, 'sat') })
    )
    expect(defaultProps.onNext).not.toHaveBeenCalled()
  })

  it('lnurl-withdraw hands off via onRouteValidated at SUBMIT — typing stays network-zero (§8.5)', async () => {
    const lnurlStr = 'lnurl1dp68gurn8ghj7ampd3kx2ar0veekzar0wd5xjtnrdakj7tnhv4kxctttdehhwm30d3h82unvwqhkxmmww4hxjmn8v96x7'
    mockDetectAndClassify.mockReturnValue({ type: 'lnurl', lnurl: lnurlStr })
    mockValidateAsync.mockResolvedValue({
      type: 'lnurl-withdraw',
      lnurl: lnurlStr,
      params: { callback: '', k1: 'abc', minWithdrawable: 0, maxWithdrawable: 100000, domain: 'example.com' },
    })

    renderStep()
    typeIntoInput(lnurlStr)

    // While typing: no remote validation and no redirect
    await act(async () => { vi.advanceTimersByTime(500) })
    expect(mockValidateAsync).not.toHaveBeenCalled()
    expect(defaultProps.onRedirect).not.toHaveBeenCalled()

    // At submit: validate, then hand off non-send types to the universal router
    const nextButton = screen.getByRole('button', { name: 'send.next' })
    await act(async () => { nextButton.click(); await vi.runAllTimersAsync() })

    expect(mockValidateAsync).toHaveBeenCalledTimes(1)
    expect(defaultProps.onRouteValidated).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'lnurl-withdraw' })
    )
    expect(defaultProps.onNext).not.toHaveBeenCalled()
  })

  it('bolt11 does NOT call onRedirect', async () => {
    const bolt11Str = 'lnbc100n1pjtest...'
    mockDetectAndClassify.mockReturnValue({
      type: 'bolt11',
      invoice: bolt11Str,
      amountSats: 100,
      isExpired: false,
      expiry: 3600,
    })
    mockValidateAsync.mockResolvedValue({
      type: 'bolt11',
      invoice: bolt11Str,
      amountSats: 100,
      expiry: 3600,
    })

    renderStep()
    await act(async () => { pasteIntoInput(bolt11Str) })

    expect(defaultProps.onRedirect).not.toHaveBeenCalled()
  })

  it('lnurl-pay does NOT call onRedirect', async () => {
    const lnurlStr = 'lnurl1dp68gurn8ghj7ampd3kx2ar0veekzar0wd5xjtnrdakj7tnhv4kxctttdehhwm30d3h82unvwqhkxmmww4hxjmn8v96x7'
    mockDetectAndClassify.mockReturnValue({ type: 'lnurl', lnurl: lnurlStr })
    mockValidateAsync.mockResolvedValue({
      type: 'lnurl-pay',
      lnurl: lnurlStr,
      params: { callback: '', minSendable: 0, maxSendable: 100000, metadata: '', tag: 'payRequest' as const, domain: 'example.com' },
    })

    renderStep()
    await act(async () => { pasteIntoInput(lnurlStr) })

    expect(defaultProps.onRedirect).not.toHaveBeenCalled()
  })

  it('missing onRedirect does not crash on cashu-token paste', async () => {
    const tokenStr = 'cashuAeyJ0b2tlbiI6W3sicHJvb2ZzIjpbXX1dfQ=='
    mockDetectAndClassify.mockReturnValue({
      type: 'cashu-token',
      token: tokenStr,
      amount: amount(50, 'sat'),
      mintUrl: 'https://mint.example.com',
    })
    mockValidateAsync.mockResolvedValue({
      type: 'cashu-token',
      token: tokenStr,
      amount: amount(50, 'sat'),
      mintUrl: 'https://mint.example.com',
    })

    // Render WITHOUT onRedirect prop
    expect(() => {
      renderStep({ onRedirect: undefined } as Partial<typeof defaultProps>)
    }).not.toThrow()

    await act(async () => { pasteIntoInput(tokenStr) })

    // No crash — graceful degradation
    expect(defaultProps.onNext).not.toHaveBeenCalled()
  })

  it('validateAsync failure at submit does not redirect (§8.5)', async () => {
    mockDetectAndClassify.mockReturnValue({
      type: 'lightning-address',
      address: 'test@failing.com',
    })
    mockValidateAsync.mockRejectedValue(new Error('Network error'))

    renderStep()
    typeIntoInput('test@failing.com')
    await act(async () => { vi.advanceTimersByTime(500) })
    expect(mockValidateAsync).not.toHaveBeenCalled()

    const nextButton = screen.getByRole('button', { name: 'send.next' })
    await act(async () => { nextButton.click(); await vi.runAllTimersAsync() })

    expect(defaultProps.onRedirect).not.toHaveBeenCalled()
    expect(defaultProps.onRouteValidated).not.toHaveBeenCalled()
    expect(defaultProps.onNext).not.toHaveBeenCalled()
  })
})
