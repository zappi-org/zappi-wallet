import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, act } from '@testing-library/react'

import { TokenReceiveStep } from '@/ui/screens/Receive/steps/TokenReceiveStep'
import type { InputType, ValidatedData } from '@/core/domain/input-types'

const mockDetectAndClassify = vi.fn<(input: string) => InputType>()
const mockValidateAsync = vi.fn<(input: InputType) => Promise<ValidatedData>>()
const mockInputParser = { detectAndClassify: mockDetectAndClassify, validateAsync: mockValidateAsync }
const stableAddToast = vi.fn()
const stableStore = { addToast: stableAddToast }

vi.mock('@/ui/hooks/use-input-parser', () => ({
  useInputParser: () => mockInputParser,
}))

vi.mock('@/store', () => ({
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  useAppStore: (selector: (s: typeof stableStore) => any) => selector(stableStore),
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
  Trans: ({ i18nKey }: { i18nKey: string }) => <span>{i18nKey}</span>,
}))

vi.mock('@/ui/utils/haptic', () => ({
  hapticTap: vi.fn(),
  hapticError: vi.fn(),
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
  onBack: vi.fn(),
  onTokenDetected: vi.fn(),
  onNext: vi.fn(),
  onRedirect: vi.fn(),
  mintUrl: 'https://mint.example.com',
}

function renderStep(overrides: Partial<typeof defaultProps> = {}) {
  return render(<TokenReceiveStep {...defaultProps} {...overrides} />)
}

function pasteIntoInput(text: string) {
  const input = screen.getByPlaceholderText('receive.tokenInputStep.placeholder')
  const event = new Event('paste', { bubbles: true, cancelable: true })
  ;(event as unknown as Record<string, unknown>).clipboardData = { getData: () => text }
  input.dispatchEvent(event)
}

describe('TokenReceiveStep redirect', () => {
  beforeEach(() => {
    mockDetectAndClassify.mockReset()
    mockValidateAsync.mockReset()
    defaultProps.onBack.mockReset()
    defaultProps.onTokenDetected.mockReset()
    defaultProps.onNext.mockReset()
    defaultProps.onRedirect.mockReset()
    stableAddToast.mockReset()

    mockDetectAndClassify.mockReturnValue({ type: 'unknown', input: '' })
  })

  it('bolt11 paste calls onRedirect', async () => {
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

    expect(defaultProps.onRedirect).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'bolt11', amountSats: 100 })
    )
    expect(defaultProps.onTokenDetected).not.toHaveBeenCalled()
  })

  it('cashu-request paste calls onRedirect', async () => {
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
    await act(async () => { pasteIntoInput(creqStr) })

    expect(defaultProps.onRedirect).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'cashu-request' })
    )
    expect(defaultProps.onTokenDetected).not.toHaveBeenCalled()
  })

  it('cashu-token does NOT call onRedirect', async () => {
    const tokenStr = 'cashuAeyJ0b2tlbiI6W3sicHJvb2ZzIjpbXX1dfQ=='
    mockDetectAndClassify.mockReturnValue({
      type: 'cashu-token',
      token: tokenStr,
      amountSats: 100,
      mintUrl: 'https://mint.example.com',
    })
    mockValidateAsync.mockResolvedValue({
      type: 'cashu-token',
      token: tokenStr,
      amountSats: 100,
      mintUrl: 'https://mint.example.com',
    })

    renderStep()
    await act(async () => { pasteIntoInput(tokenStr) })

    expect(defaultProps.onRedirect).not.toHaveBeenCalled()
    expect(defaultProps.onTokenDetected).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'cashu-token' })
    )
  })

  it('lnurl-withdraw does NOT call onRedirect', async () => {
    const lnurlStr = 'lnurl1dp68gurn8ghj7ampd3kx2ar0veekzar0wd5xjtnrdakj7tnhv4kxctttdehhwm30d3h82unvwqhkxmmww4hxjmn8v96x7'
    mockDetectAndClassify.mockReturnValue({ type: 'lnurl', lnurl: lnurlStr })
    mockValidateAsync.mockResolvedValue({
      type: 'lnurl-withdraw',
      lnurl: lnurlStr,
      params: { callback: '', k1: 'abc', minWithdrawable: 0, maxWithdrawable: 100000, domain: 'example.com' },
    })

    renderStep()
    await act(async () => { pasteIntoInput(lnurlStr) })

    expect(defaultProps.onRedirect).not.toHaveBeenCalled()
    expect(stableAddToast).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'error', message: 'payment.tokenOnly' })
    )
  })

  it('missing onRedirect does not crash on bolt11 paste', async () => {
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

    renderStep({ onRedirect: undefined } as Partial<typeof defaultProps>)
    await act(async () => { pasteIntoInput(bolt11Str) })

    expect(stableAddToast).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'error', message: 'payment.tokenOnly' })
    )
  })

  it('validateAsync failure shows error, not redirect', async () => {
    const bolt11Str = 'lnbc100n1pjtest...'
    mockDetectAndClassify.mockReturnValue({
      type: 'bolt11',
      invoice: bolt11Str,
      amountSats: 100,
      isExpired: false,
      expiry: 3600,
    })
    mockValidateAsync.mockRejectedValue(new Error('Network error'))

    renderStep()
    await act(async () => { pasteIntoInput(bolt11Str) })

    expect(defaultProps.onRedirect).not.toHaveBeenCalled()
    expect(stableAddToast).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'error', message: 'errors.generic' })
    )
  })
})
