import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, act } from '@testing-library/react'

import { SendInputStep } from '@/ui/screens/Send/steps/SendInputStep'
import type { Contact } from '@/core/types/contact'
import type { InputType, ValidatedData } from '@/core/domain/input-types'

const mockDetectAndClassify = vi.fn<(input: string) => InputType>()
const mockValidateAsync = vi.fn<(input: InputType) => Promise<ValidatedData>>()
const mockInputParser = { detectAndClassify: mockDetectAndClassify, validateAsync: mockValidateAsync }
const stableT = (key: string) => key
const stableAddToast = vi.fn()
const mockContacts: Contact[] = []
const displayNameByUrl = new Map<string, string>()
const stableStore = {
  settings: { mints: [] as string[] },
  addToast: stableAddToast,
}

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
    getDisplayName: (url: string) => displayNameByUrl.get(url) ?? url,
    getIconUrl: () => undefined,
  }),
}))

vi.mock('@/ui/hooks/use-contacts', () => ({
  useContacts: () => ({ contacts: mockContacts }),
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
  onBack: vi.fn(),
  onNext: vi.fn(),
  onRedirect: vi.fn(),
  mintUrl: 'https://source.mint',
}

function renderStep(overrides: Partial<typeof defaultProps> = {}) {
  return render(<SendInputStep {...defaultProps} {...overrides} />)
}

function typeIntoInput(value: string) {
  const input = screen.getByPlaceholderText('send.destination.placeholder')
  act(() => {
    ;(input as HTMLInputElement).focus()
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value)
    input.dispatchEvent(new Event('input', { bubbles: true }))
    input.dispatchEvent(new Event('change', { bubbles: true }))
  })
}

describe('SendInputStep selection flows', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    mockDetectAndClassify.mockReset()
    mockValidateAsync.mockReset()
    defaultProps.onBack.mockReset()
    defaultProps.onNext.mockReset()
    defaultProps.onRedirect.mockReset()
    stableAddToast.mockReset()
    mockContacts.length = 0
    displayNameByUrl.clear()
    stableStore.settings.mints = ['https://source.mint', 'https://target.mint']

    displayNameByUrl.set('https://source.mint', 'Source Wallet')
    displayNameByUrl.set('https://target.mint', 'Target Wallet')

    mockDetectAndClassify.mockImplementation((input) => ({ type: 'unknown', input }))
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('contact selection clears stale error, skips label revalidation, and advances with the raw address', async () => {
    mockContacts.push({
      id: 'contact-1',
      name: 'Alice',
      address: 'alice@example.com',
      addressType: 'lightning',
      createdAt: 1,
      updatedAt: 1,
    })

    mockDetectAndClassify
      .mockReturnValueOnce({ type: 'unknown', input: 'not-an-address' })
      .mockReturnValueOnce({ type: 'lightning-address', address: 'alice@example.com' })

    mockValidateAsync.mockResolvedValue({
      type: 'lightning-address',
      address: 'alice@example.com',
      lnurlParams: {
        callback: '',
        minSendable: 0,
        maxSendable: 100000,
        metadata: '',
        tag: 'payRequest',
        domain: 'example.com',
      },
    })

    renderStep()
    typeIntoInput('not-an-address')

    await act(async () => { vi.advanceTimersByTime(500) })
    expect(screen.getByText('send.destination.unrecognized')).toBeInTheDocument()

    await act(async () => {
      screen.getByText('contacts.title').click()
    })
    await act(async () => {
      screen.getByText('Alice').click()
    })

    expect(screen.queryByText('send.destination.unrecognized')).not.toBeInTheDocument()
    expect(screen.getByDisplayValue('Alice')).toBeInTheDocument()

    await act(async () => { vi.advanceTimersByTime(500) })
    expect(mockDetectAndClassify).toHaveBeenCalledTimes(1)

    await act(async () => {
      screen.getByRole('button', { name: 'send.next' }).click()
    })

    expect(mockDetectAndClassify).toHaveBeenLastCalledWith('alice@example.com')
    expect(defaultProps.onNext).toHaveBeenCalledWith({
      destination: 'Alice',
      validatedData: expect.objectContaining({
        type: 'lightning-address',
        address: 'alice@example.com',
      }),
      amountFromInvoice: undefined,
    })
  })

  it('my-wallet selection clears stale error and proceeds without revalidation', async () => {
    renderStep()
    typeIntoInput('not-an-address')

    await act(async () => { vi.advanceTimersByTime(500) })
    expect(screen.getByText('send.destination.unrecognized')).toBeInTheDocument()

    await act(async () => {
      screen.getByText('Target Wallet').click()
    })

    expect(screen.queryByText('send.destination.unrecognized')).not.toBeInTheDocument()
    expect(screen.getByDisplayValue('@Target Wallet')).toBeInTheDocument()

    await act(async () => {
      screen.getByRole('button', { name: 'send.next' }).click()
    })

    expect(mockValidateAsync).not.toHaveBeenCalled()
    expect(defaultProps.onNext).toHaveBeenCalledWith({
      destination: '@Target Wallet',
      validatedData: {
        type: 'my-wallet',
        targetMintUrl: 'https://target.mint',
        targetMintName: 'Target Wallet',
      },
      amountFromInvoice: undefined,
    })
  })
})
