/**
 * A destination replacement that fails must disarm the previous recipient.
 *
 * Regression: paste/scan call processExternalInput bare (the return value is
 * ignored), so an early return on unrecognized input used to leave the already
 * validated recipient on screen and sendable — the user believes the destination
 * was swapped and hits Next.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, act } from '@testing-library/react'

import { SendInputStep } from '@/ui/screens/Send/steps/SendInputStep'
import type { InputType, ValidatedData } from '@/core/domain/input-types'
import type { SendableValidatedData } from '@/ui/screens/Send/SendFlow'
import { ServiceProvider } from '@/ui/hooks/service-context'
import type { ServiceRegistry } from '@/core/ports/driving/service-registry'

const mockDetectAndClassify = vi.fn<(input: string) => InputType>()
const mockValidateAsync = vi.fn<(input: InputType) => Promise<ValidatedData>>()
const mockInputParser = { detectAndClassify: mockDetectAndClassify, validateAsync: mockValidateAsync }
const stableT = (key: string) => key
const stableAddToast = vi.fn()
const stableStore = { settings: { mints: [] as string[] }, addToast: stableAddToast }
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

const ALICE: SendableValidatedData = {
  type: 'email-address',
  address: 'alice@example.com',
  lnurlParams: {
    callback: '',
    minSendable: 0,
    maxSendable: 100000,
    metadata: '',
    tag: 'payRequest',
    domain: 'example.com',
  },
}

const defaultProps = {
  onBack: vi.fn(),
  onNext: vi.fn(),
  onDirectTransfer: vi.fn(),
  onRedirect: vi.fn(),
  mintUrl: 'https://mint.example.com',
}

/** Arm the step with an already validated recipient (as after a successful submit). */
function renderWithValidatedRecipient() {
  return render(
    <ServiceProvider registry={mockRegistry}>
      <SendInputStep
        {...defaultProps}
        initialDestination="alice@example.com"
        initialValidatedData={ALICE}
      />
    </ServiceProvider>
  )
}

function destinationInput(): HTMLInputElement {
  return screen.getByPlaceholderText('send.destination.placeholder') as HTMLInputElement
}

/** Simulate paste via native event (the bare processExternalInput caller). */
function pasteIntoInput(text: string) {
  const event = new Event('paste', { bubbles: true, cancelable: true })
  ;(event as unknown as Record<string, unknown>).clipboardData = { getData: () => text }
  destinationInput().dispatchEvent(event)
}

describe('SendInputStep failed replacement', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    mockDetectAndClassify.mockReset()
    mockValidateAsync.mockReset()
    // Reset the implementation too: a test that parks the lookup would otherwise
    // leave it pending for every test after it.
    mockFindByAddress.mockReset()
    mockFindByAddress.mockImplementation(async () => null)
    mockNostrDirectPayment.resolve.mockReset()
    defaultProps.onBack.mockReset()
    defaultProps.onNext.mockReset()
    defaultProps.onDirectTransfer.mockReset()
    defaultProps.onRedirect.mockReset()
    stableAddToast.mockReset()
    stableStore.settings.mints = []
    mockDetectAndClassify.mockImplementation((input) => ({ type: 'unknown', input }))
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('an unrecognized paste replaces the previous recipient instead of hiding behind it', async () => {
    renderWithValidatedRecipient()
    expect(destinationInput().value).toBe('alice@example.com')

    await act(async () => { pasteIntoInput('definitely-not-an-address') })

    // The attempted destination is what the field shows — the old one is gone.
    expect(destinationInput().value).toBe('definitely-not-an-address')
  })

  it('Next after an unrecognized paste cannot send to the previous recipient', async () => {
    renderWithValidatedRecipient()

    await act(async () => { pasteIntoInput('definitely-not-an-address') })
    await act(async () => {
      screen.getByRole('button', { name: 'send.next' }).click()
      await vi.runAllTimersAsync()
    })

    expect(defaultProps.onNext).not.toHaveBeenCalled()
    expect(stableAddToast).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'error', message: 'send.destination.unrecognized' }),
    )
  })

  /**
   * The contact lookup is an IndexedDB round trip, so the replacement is in
   * flight for a moment before anything is reset. Until this disarm the old
   * recipient stayed validated across that window and Next still sent to them.
   */
  /**
   * The contact lookup is an IndexedDB round trip, so the replacement is in
   * flight for a moment. Clearing only the validation was not enough: Next
   * re-reads the *displayed* destination, so the old recipient's text was
   * revalidated and advanced to once the lookup finally resolved.
   */
  it('Next during a pending lookup cannot advance to the replaced recipient', async () => {
    let releaseLookup: (() => void) | undefined
    mockFindByAddress.mockImplementation(
      () => new Promise<null>((resolve) => { releaseLookup = () => resolve(null) }),
    )

    renderWithValidatedRecipient()

    await act(async () => { pasteIntoInput('definitely-not-an-address') })

    // The replacement is already on screen, so Next has nothing stale to act on.
    expect(destinationInput().value).toBe('definitely-not-an-address')

    await act(async () => {
      screen.getByRole('button', { name: 'send.next' }).click()
    })
    await act(async () => {
      releaseLookup?.()
      await vi.runAllTimersAsync()
    })

    expect(defaultProps.onNext).not.toHaveBeenCalled()
  })

  it('an unrecognized paste is never silent — the detector names it inline', async () => {
    renderWithValidatedRecipient()

    await act(async () => { pasteIntoInput('definitely-not-an-address') })
    await act(async () => { vi.advanceTimersByTime(500) })

    expect(screen.getByText('send.destination.unrecognized')).toBeInTheDocument()
  })

  /**
   * The reset clears the inline error, and setDestination is a no-op when the
   * text is unchanged — so without an explicit re-arm the detector never runs
   * again and the second attempt says nothing at all.
   */
  it('repeating the same unrecognized paste says so again', async () => {
    renderWithValidatedRecipient()

    await act(async () => { pasteIntoInput('definitely-not-an-address') })
    await act(async () => { vi.advanceTimersByTime(500) })
    expect(screen.getByText('send.destination.unrecognized')).toBeInTheDocument()

    await act(async () => { pasteIntoInput('definitely-not-an-address') })
    await act(async () => { vi.advanceTimersByTime(500) })

    expect(screen.getByText('send.destination.unrecognized')).toBeInTheDocument()
  })

  it('repeating the same broken cashu token reports it again', async () => {
    renderWithValidatedRecipient()

    await act(async () => { pasteIntoInput('cashuBbroken') })
    await act(async () => { vi.advanceTimersByTime(500) })

    await act(async () => { pasteIntoInput('cashuBbroken') })
    await act(async () => { vi.advanceTimersByTime(500) })

    expect(
      stableAddToast.mock.calls.filter(
        ([toast]) => toast.message === 'send.destination.invalidCashuToken',
      ),
    ).toHaveLength(2)
  })

  it('an invalid cashu token paste clears the recipient and is reported once', async () => {
    renderWithValidatedRecipient()

    await act(async () => { pasteIntoInput('cashuBbroken') })
    expect(destinationInput().value).toBe('cashuBbroken')

    await act(async () => { vi.advanceTimersByTime(500) })
    expect(
      stableAddToast.mock.calls.filter(
        ([toast]) => toast.message === 'send.destination.invalidCashuToken',
      ),
    ).toHaveLength(1)
  })
})
