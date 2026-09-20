import type { ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import ChatListScreen from '@/ui/screens/Chat/ChatListScreen'
import { npubEncode } from '@/adapters/nostr/internal/nostr-crypto'
import { ChatAddressError, ChatCapacityError } from '@/core/errors/chat'
import { useAppStore } from '@/store'

let top = true
let hasConversation = false
vi.mock('@/ui/navigation/use-is-activity-top', () => ({
  useIsActivityTop: () => top,
}))
beforeEach(() => {
  top = true
  hasConversation = false
  open.mockReset().mockResolvedValue('conversation')
  connect.mockReset().mockResolvedValue(undefined)
  useAppStore.setState({ toasts: [] })
})
const address = npubEncode('b'.repeat(64))
const open = vi.fn().mockResolvedValue('conversation')
const connect = vi.fn().mockResolvedValue(undefined)
vi.mock('@/ui/components/common/QRCodeDisplay', () => ({
  QRCodeDisplay: () => <div data-testid="chat-address-qr" />,
}))
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
    i18n: { language: 'en' },
  }),
}))
vi.mock('@/ui/hooks/use-chat', () => ({
  useChat: () => ({
    chat: { open, connect },
    conversations: hasConversation
      ? [
          {
            id: 'chat',
            channel: 'direct',
            peer: 'b'.repeat(64),
            preview: '',
            draft: '',
            unread: 0,
            updatedAt: 0,
          },
        ]
      : [],
    ready: true,
    error: false,
  }),
}))
vi.mock('@/ui/hooks/use-contacts', () => ({
  useContacts: () => ({
    contacts: Array.from({ length: 30 }, (_, i) => ({
      id: `contact-${i}`,
      name: `Person ${i}`,
      address,
    })),
  }),
}))
vi.mock('@/ui/components/common/Modal', () => ({
  Modal: ({ isOpen, children }: { isOpen: boolean; children: ReactNode }) =>
    isOpen ? <div role="dialog">{children}</div> : null,
}))
vi.mock('@/ui/components/common/QrScannerModal', () => ({
  QrScannerModal: ({
    isOpen,
    onScan,
  }: {
    isOpen: boolean
    onScan: (value: string) => void
  }) =>
    isOpen ? (
      <button onClick={() => onScan(`nostr:${address}`)}>
        Scan test address
      </button>
    ) : null,
}))

describe('new chat camera input', () => {
  it.each([
    [new Error('Storage locked'), 'chat.openFailed'],
    [new ChatAddressError('self'), 'chat.selfAddress'],
    [new ChatCapacityError('storage'), 'chat.storageFull'],
  ])('does not mislabel a valid address when opening fails (%s)', async (error, key) => {
    open.mockRejectedValueOnce(error)
    render(<ChatListScreen onOpen={vi.fn()} />)
    fireEvent.click(screen.getAllByRole('button', { name: 'chat.newChat' })[0])
    fireEvent.change(screen.getByRole('textbox', { name: 'contacts.address' }), { target: { value: address } })
    fireEvent.click(screen.getByRole('button', { name: 'chat.start' }))
    await waitFor(() => expect(useAppStore.getState().toasts.at(-1)?.message).toBe(key))
    expect(connect).toHaveBeenCalledOnce()
  })

  it('waits for initialization before opening a valid address', async () => {
    let ready!: () => void
    connect.mockReturnValueOnce(new Promise<void>(resolve => { ready = resolve }))
    render(<ChatListScreen onOpen={vi.fn()} />)
    fireEvent.click(screen.getAllByRole('button', { name: 'chat.newChat' })[0])
    fireEvent.click(screen.getByRole('button', { name: 'Person 0' }))
    expect(open).not.toHaveBeenCalled()
    ready()
    await waitFor(() => expect(open).toHaveBeenCalledWith(address))
  })
  it('fills a scanned address and leaves starting the conversation to the user', async () => {
    const onOpen = vi.fn()
    render(<ChatListScreen onOpen={onOpen} />)
    fireEvent.click(
      screen.getAllByRole('button', { name: 'chat.newChat' })[0]
    )
    expect(
      screen.getByRole('button', { name: 'Person 29' })
    ).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'scanner.title' }))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Scan test address' }))
    expect(
      screen.getByRole('textbox', { name: 'contacts.address' })
    ).toHaveValue(address)
    expect(open).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'chat.start' }))
    await waitFor(() => expect(onOpen).toHaveBeenCalledOnce())
    expect(open).toHaveBeenCalledWith(address)
  })
})

it.each(['menu', 'delete'])(
  'hides a covered conversation list %s dialog',
  (kind) => {
    hasConversation = true
    const view = render(<ChatListScreen onOpen={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: 'chat.actions' }))
    if (kind === 'delete')
      fireEvent.click(screen.getByRole('button', { name: 'common.delete' }))
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    top = false
    view.rerender(<ChatListScreen onOpen={vi.fn()} />)
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  }
)
