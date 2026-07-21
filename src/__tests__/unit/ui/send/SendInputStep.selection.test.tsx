import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, act } from '@testing-library/react'

import { SendInputStep } from '@/ui/screens/Send/steps/SendInputStep'
import type { Contact } from '@/core/types/contact'
import type { InputType, ValidatedData } from '@/core/domain/input-types'
import { ServiceProvider } from '@/ui/hooks/service-context'
import type { ServiceRegistry } from '@/core/ports/driving/service-registry'

const mockDetectAndClassify = vi.fn<(input: string) => InputType>()
const mockValidateAsync = vi.fn<(input: InputType) => Promise<ValidatedData>>()
const mockInputParser = { detectAndClassify: mockDetectAndClassify, validateAsync: mockValidateAsync }
const stableT = (key: string) => key
const stableAddToast = vi.fn()
const mockContacts: Contact[] = []
const mockFindByAddress = vi.fn(async (address: string) =>
  mockContacts.find((contact) => contact.address.toLowerCase() === address.toLowerCase()) ?? null
)
const displayNameByUrl = new Map<string, string>()
const mockNostrDirectPayment = { resolve: vi.fn() }
const mockRegistry = { nostrDirectPayment: mockNostrDirectPayment } as unknown as ServiceRegistry
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
  onBack: vi.fn(),
  onNext: vi.fn(),
  onDirectTransfer: vi.fn(),
  onRedirect: vi.fn(),
  mintUrl: 'https://source.mint',
}

function renderStep(overrides: Partial<typeof defaultProps> = {}) {
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
    mockNostrDirectPayment.resolve.mockReset()
    defaultProps.onBack.mockReset()
    defaultProps.onNext.mockReset()
    defaultProps.onDirectTransfer.mockReset()
    defaultProps.onRedirect.mockReset()
    stableAddToast.mockReset()
    mockFindByAddress.mockClear()
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

  it('shows the address book tab before my wallets', () => {
    mockContacts.push({
      id: 'contact-1',
      name: 'Alice',
      address: 'alice@example.com',
      addressType: 'lightning',
      createdAt: 1,
      updatedAt: 1,
    })

    renderStep()

    const contactsTab = screen.getByRole('button', { name: 'contacts.title' })
    const walletsTab = screen.getByRole('button', { name: 'send.myWalletList' })

    expect(contactsTab.compareDocumentPosition(walletsTab) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
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
    // Selecting the contact validates the raw address and advances in one gesture.
    await act(async () => {
      screen.getByText('Alice').click()
    })

    expect(screen.queryByText('send.destination.unrecognized')).not.toBeInTheDocument()
    // Only the initial typed detection + the contact-address validation ran.
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

  it('my-wallet selection clears stale error and auto-advances without revalidation', async () => {
    renderStep()
    typeIntoInput('not-an-address')

    await act(async () => { vi.advanceTimersByTime(500) })
    expect(screen.getByText('send.destination.unrecognized')).toBeInTheDocument()

    // Wallet pick advances straight to the amount step, showing the plain name.
    await act(async () => {
      screen.getByText('Target Wallet').click()
    })

    expect(screen.queryByText('send.destination.unrecognized')).not.toBeInTheDocument()
    expect(mockValidateAsync).not.toHaveBeenCalled()
    expect(defaultProps.onNext).toHaveBeenCalledWith({
      destination: 'Target Wallet',
      validatedData: {
        type: 'my-wallet',
        targetMintUrl: 'https://target.mint',
        targetMintName: 'Target Wallet',
      },
    })
  })

  it('uses a saved contact name when a lightning address is typed directly', async () => {
    mockContacts.push({
      id: 'contact-1',
      name: 'Alice',
      address: 'alice@example.com',
      addressType: 'lightning',
      createdAt: 1,
      updatedAt: 1,
    })

    mockDetectAndClassify.mockReturnValue({ type: 'lightning-address', address: 'alice@example.com' })
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
    typeIntoInput('alice@example.com')

    await act(async () => { vi.advanceTimersByTime(500) })
    await act(async () => {
      screen.getByRole('button', { name: 'send.next' }).click()
    })

    expect(defaultProps.onNext).toHaveBeenCalledWith({
      destination: 'Alice',
      validatedData: expect.objectContaining({
        type: 'lightning-address',
        address: 'alice@example.com',
      }),
      amountFromInvoice: undefined,
    })
  })

  it('uses a saved contact name when an LNURL is typed directly', async () => {
    const lnurl = 'lnurl1directpayment'
    mockContacts.push({
      id: 'contact-1',
      name: 'LNURL Shop',
      address: lnurl,
      addressType: 'custom',
      createdAt: 1,
      updatedAt: 1,
    })

    mockDetectAndClassify.mockReturnValue({ type: 'lnurl', lnurl })
    mockValidateAsync.mockResolvedValue({
      type: 'lnurl-pay',
      lnurl,
      params: {
        callback: '',
        minSendable: 0,
        maxSendable: 100000,
        metadata: '',
        tag: 'payRequest',
        domain: 'example.com',
      },
    })

    renderStep()
    typeIntoInput(lnurl)

    await act(async () => { vi.advanceTimersByTime(500) })
    await act(async () => {
      screen.getByRole('button', { name: 'send.next' }).click()
    })

    expect(defaultProps.onNext).toHaveBeenCalledWith({
      destination: 'LNURL Shop',
      validatedData: expect.objectContaining({
        type: 'lnurl-pay',
        lnurl,
      }),
      amountFromInvoice: undefined,
    })
  })

  it('uses a saved contact name when an npub is typed directly', async () => {
    const npub = 'npub1zappitestrecipient'
    mockContacts.push({
      id: 'contact-1',
      name: 'Bob',
      address: npub,
      addressType: 'npub',
      createdAt: 1,
      updatedAt: 1,
    })
    mockNostrDirectPayment.resolve.mockResolvedValue({
      status: 'ready',
      validatedData: {
        type: 'cashu-request',
        request: npub,
        parsed: {
          id: 'request-id',
          unit: 'sat',
          mints: ['https://source.mint'],
          transports: [],
          hasNostrTransport: true,
          nostrTarget: npub,
          hasPostTransport: false,
          sameMintOnly: true,
        },
      },
      commonMintUrls: ['https://source.mint'],
    })

    renderStep()
    typeIntoInput(npub)

    await act(async () => { vi.advanceTimersByTime(500) })
    await act(async () => {
      screen.getByRole('button', { name: 'send.next' }).click()
    })

    expect(defaultProps.onNext).toHaveBeenCalledWith({
      destination: 'Bob',
      validatedData: expect.objectContaining({
        type: 'cashu-request',
        request: npub,
      }),
      amountFromInvoice: undefined,
    })
  })

  it('shows the direct-transfer CTA when the input is empty and fires onDirectTransfer', () => {
    renderStep()
    const cta = screen.getByRole('button', { name: 'send.direct.cta' })
    act(() => {
      cta.click()
    })
    expect(defaultProps.onDirectTransfer).toHaveBeenCalledOnce()
    expect(defaultProps.onNext).not.toHaveBeenCalled()
  })

  it('switches the CTA to Next once a destination is entered', () => {
    renderStep()
    expect(screen.getByRole('button', { name: 'send.direct.cta' })).toBeInTheDocument()
    typeIntoInput('npub1xxx')
    expect(screen.getByRole('button', { name: 'send.next' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'send.direct.cta' })).not.toBeInTheDocument()
  })
})
