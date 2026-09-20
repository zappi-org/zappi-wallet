import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ReactNode } from 'react'

import { ContactsScreen } from '@/ui/screens/Contacts/ContactsScreen'
import type { Contact } from '@/core/types/contact'
import type { InputType, ValidatedData } from '@/core/domain/input-types'

let activityTop = true
vi.mock('@/ui/navigation/use-is-activity-top', () => ({
  useIsActivityTop: () => activityTop,
}))
beforeEach(() => {
  activityTop = true
})

// ─── Mocks ───

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}))

vi.mock('motion/react', () => ({
  AnimatePresence: ({ children }: { children: ReactNode }) => <>{children}</>,
  motion: {
    div: ({
      children,
      className,
    }: {
      children: ReactNode
      className?: string
    }) => <div className={className}>{children}</div>,
  },
}))

const addToast = vi.fn()
const storeState = { addToast, settings: { mints: ['https://mint.a'] } }
vi.mock('@/store', () => ({
  useAppStore: (selector: (s: typeof storeState) => unknown) =>
    selector(storeState),
}))

const mockDetectAndClassify = vi.fn<(raw: string) => InputType>()
const mockValidateAsync =
  vi.fn<(input: InputType) => Promise<ValidatedData>>()
const stableInputParser = {
  detectAndClassify: mockDetectAndClassify,
  validateAsync: mockValidateAsync,
}
vi.mock('@/ui/hooks/use-input-parser', () => ({
  useInputParser: () => stableInputParser,
}))

const mockResolve = vi.fn()
const mockResolveWithInfo = vi.fn()
// Stable reference like the real context — a fresh object per render re-runs effects.
const stableRegistry = {
  nostrDirectPayment: {
    resolve: mockResolve,
    resolveWithInfo: mockResolveWithInfo,
  },
}
vi.mock('@/ui/hooks/use-service-registry', () => ({
  useServiceRegistry: () => stableRegistry,
}))

const contacts: Contact[] = []
vi.mock('@/ui/hooks/use-contacts', () => ({
  useContacts: () => ({
    contacts,
    createContact: vi.fn(),
    updateContact: vi.fn(),
    deleteContact: vi.fn(),
  }),
}))

vi.mock('@/ui/components/common/BottomSheet', () => ({
  BottomSheet: ({
    isOpen,
    children,
    title,
  }: {
    isOpen: boolean
    children: ReactNode
    title: string
  }) =>
    isOpen ? (
      <div role="dialog" aria-label={title}>
        {children}
      </div>
    ) : null,
}))

// Heavy sheets — only their open/closed state matters here.
vi.mock('@/ui/components/payment/MintSelectBottomSheet', () => ({
  MintSelectBottomSheet: ({ isOpen }: { isOpen: boolean }) =>
    isOpen ? <div data-testid="mint-select" /> : null,
}))
vi.mock('@/ui/screens/Contacts/ContactFormModal', () => ({
  ContactFormModal: () => null,
}))

// ─── Helpers ───

function setContacts(next: Contact[]) {
  contacts.length = 0
  contacts.push(...next)
}

function makeContact(overrides: Partial<Contact>): Contact {
  return {
    id: 'c1',
    name: 'Alice',
    address: 'alice@example.com',
    addressType: 'lightning',
    createdAt: 0,
    updatedAt: 0,
    ...overrides,
  }
}

async function tapSend() {
  const user = userEvent.setup()
  await user.click(screen.getByText('Alice'))
  await user.click(screen.getByRole('button', { name: /chat.sendMoney/ }))
}

// ─── Suite ───

describe('ContactsScreen send', () => {
  const onSendToContact = vi.fn()

  beforeEach(() => {
    addToast.mockReset()
    onSendToContact.mockReset()
    mockResolve.mockReset()
    mockResolveWithInfo.mockReset()
    mockDetectAndClassify.mockReset()
    mockValidateAsync.mockReset()
  })

  // A rejected npub lookup (relays unreachable, malformed npub) used to escape
  // the try/finally and leave the tap silent once the spinner cleared.
  it('surfaces an error when the npub lookup rejects', async () => {
    setContacts([makeContact({ address: 'npub1alice', addressType: 'npub' })])
    mockResolve.mockRejectedValue(new Error('relay unreachable'))

    render(<ContactsScreen onSendToContact={onSendToContact} />)
    await tapSend()

    await waitFor(() =>
      expect(addToast).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'error',
          message: 'send.destination.lookupFailed',
        })
      )
    )
    expect(screen.queryByTestId('mint-select')).not.toBeInTheDocument()
    expect(onSendToContact).not.toHaveBeenCalled()
  })

  // An address that resolved to neither ecash info nor LNURL pay used to reach
  // the send screen and only fail there at an unavailable fee.
  it('rejects an email address with neither ecash info nor LNURL pay', async () => {
    setContacts([makeContact({})])
    mockDetectAndClassify.mockReturnValue({
      type: 'email-address',
      address: 'alice@example.com',
    })
    mockValidateAsync.mockResolvedValue({
      type: 'email-address',
      address: 'alice@example.com',
    })

    render(<ContactsScreen onSendToContact={onSendToContact} />)
    await tapSend()

    await waitFor(() =>
      expect(addToast).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'error',
          message: 'send.destination.validationFailed',
        })
      )
    )
    expect(screen.queryByTestId('mint-select')).not.toBeInTheDocument()
    expect(onSendToContact).not.toHaveBeenCalled()
  })

  // The capability guard must not swallow a usable LNURL-only address.
  it('still routes an LNURL-only email address to mint selection', async () => {
    setContacts([makeContact({})])
    mockDetectAndClassify.mockReturnValue({
      type: 'email-address',
      address: 'alice@example.com',
    })
    mockValidateAsync.mockResolvedValue({
      type: 'email-address',
      address: 'alice@example.com',
      lnurlParams: {
        callback: 'https://example.com/lnurlp/callback',
        minSendable: 1000,
        maxSendable: 1000000,
        metadata: '[]',
        tag: 'payRequest',
        domain: 'example.com',
      },
    })

    render(<ContactsScreen onSendToContact={onSendToContact} />)
    await tapSend()

    await waitFor(() =>
      expect(screen.getByTestId('mint-select')).toBeInTheDocument()
    )
    expect(addToast).not.toHaveBeenCalled()
  })
})

describe('favorite contact actions', () => {
  it('opens the selected favorite in its own sheet without expanding a distant contact row', async () => {
    const user = userEvent.setup()
    const onChat = vi.fn().mockResolvedValue(undefined)
    setContacts([
      makeContact({
        favorite: true,
        address: 'npub1alice',
        addressType: 'npub',
      }),
    ])
    render(
      <ContactsScreen onChatWithContact={onChat} onSendToContact={vi.fn()} />
    )
    const favorites = screen.getByRole('region', { name: 'chat.favorites' })
    await user.click(within(favorites).getByRole('button', { name: 'Alice' }))
    const sheet = screen.getByRole('dialog', { name: 'Alice' })
    expect(
      within(sheet).getByRole('button', { name: 'chat.title' })
    ).toBeInTheDocument()
    expect(
      screen.getAllByRole('button', { name: /chat.sendMoney/ })
    ).toHaveLength(1)
    await user.click(
      within(sheet).getByRole('button', { name: 'chat.title' })
    )
    expect(onChat).toHaveBeenCalledWith('npub1alice')
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })
})

it('hides contact deletion confirmation when another screen covers contacts', async () => {
  setContacts([makeContact({})])
  const user = userEvent.setup()
  const view = render(<ContactsScreen />)
  await user.click(screen.getByText('Alice'))
  await user.click(screen.getByRole('button', { name: 'common.delete' }))
  expect(screen.getByRole('dialog')).toBeInTheDocument()
  activityTop = false
  view.rerender(<ContactsScreen />)
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
})

it('offers both actions for a shared npub contact', async () => {
  setContacts([makeContact({ address: 'npub1wallet', addressType: 'npub' })])
  render(
    <ContactsScreen onChatWithContact={vi.fn()} onSendToContact={vi.fn()} />
  )
  await userEvent.click(screen.getByRole('button', { name: /Alice/ }))
  const sheet = screen.getByRole('dialog', { name: 'Alice' })
  expect(
    within(sheet).queryByRole('button', { name: 'chat.title' })
  ).toBeInTheDocument()
  expect(
    within(sheet).getByRole('button', { name: 'chat.sendMoney' })
  ).toBeInTheDocument()
})

it('does not offer chat for a Lightning contact', async () => {
  setContacts([
    makeContact({ address: 'alice@example.com', addressType: 'lightning' }),
  ])
  render(
    <ContactsScreen onChatWithContact={vi.fn()} onSendToContact={vi.fn()} />
  )
  await userEvent.click(screen.getByRole('button', { name: /Alice/ }))
  const sheet = screen.getByRole('dialog', { name: 'Alice' })
  expect(
    within(sheet).getByRole('button', { name: 'chat.sendMoney' })
  ).toBeInTheDocument()
  expect(
    within(sheet).queryByRole('button', { name: 'chat.title' })
  ).not.toBeInTheDocument()
})
