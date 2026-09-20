import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useChatNotifications } from '@/ui/hooks/use-chat'
import { useAppStore } from '@/store'
import { useChatView } from '@/store/chat-view'
import type { ServiceRegistry } from '@/core/ports/driving/service-registry'
import type {
  ChatMessage,
  ChatSnapshot,
  Conversation,
} from '@/core/domain/chat'
import type { Contact } from '@/core/domain/contact'

vi.mock('react-i18next', () => {
  const t = (key: string) => key
  return { useTranslation: () => ({ t }) }
})
vi.mock('@/ui/navigation/navigation-store', () => ({
  navigateToScreen: vi.fn(),
}))

const peer = 'a'.repeat(64)
const contact: Contact = {
  id: 'friend',
  name: 'Alice',
  addresses: [{ type: 'npub', value: peer }],
  createdAt: 0,
  updatedAt: 0,
}
function setup(list = vi.fn(async () => [contact])) {
  const conversation: Conversation = {
    id: 'room',
    account: 'me',
    peer,
    channel: 'direct',
    unread: 1,
    updatedAt: 0,
    muted: false,
    pinned: false,
    blocked: false,
    preview: '',
    draft: '',
  }
  const snapshot: ChatSnapshot = {
    conversations: [conversation],
    messages: [],
    ready: true,
    error: false,
  }
  let listener: ((message: ChatMessage) => void) | undefined
  const registry = {
    chat: {
      getSnapshot: () => snapshot,
      subscribe: () => () => {},
      onMessage: (callback: typeof listener) => {
        listener = callback
        return () => {
          listener = undefined
        }
      },
      connect: vi.fn(async () => {}),
      disconnect: vi.fn(),
    },
    contact: { list },
    crypto: { encodeNpub: () => 'npub1abcdefghijklmnopqrstuvxyz' },
  } as unknown as ServiceRegistry
  const hook = renderHook(
    ({ unlocked }) => useChatNotifications(registry, unlocked),
    { initialProps: { unlocked: true } }
  )
  return {
    ...hook,
    conversation,
    registry,
    emit: (patch: Partial<ChatMessage> = {}) =>
      act(() =>
        listener?.({
          id: 'new',
          conversationId: 'room',
          sender: peer,
          recipient: 'me',
          content: 'Hello',
          createdAt: Date.now(),
          outgoing: false,
          status: 'received',
          ...patch,
        })
      ),
  }
}

beforeEach(() => {
  useAppStore.setState({ toasts: [], isLocked: false })
  useChatView.getState().setActive(null)
  vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible')
})

describe('chat notification previews', () => {
  it('shows contact and normalized Unicode preview without reconnecting', async () => {
    const h = setup()
    h.emit({ content: '  Hello\n  ' + '🙂'.repeat(40) })
    await waitFor(() =>
      expect(useAppStore.getState().toasts[0]?.message).toBe(
        'Alice: Hello ' + '🙂'.repeat(34) + '...'
      )
    )
    expect(h.registry.chat.connect).toHaveBeenCalledOnce()
  })

  it.each([
    ['CREQBsecret-request', 'chat.paymentRequest'],
    [
      JSON.stringify({
        type: 'zappi-payment',
        version: 1,
        amount: 100,
        unit: 'sat',
        recipient: peer,
        transactionId: 'tx-1',
      }),
      'chat.paymentCard.noticeTitle',
    ],
  ])('hides payment payload %s', async (content, expected) => {
    const h = setup()
    h.emit({ content })
    await waitFor(() =>
      expect(useAppStore.getState().toasts[0]?.message).toBe(
        `Alice: ${expected}`
      )
    )
  })

  it('uses a short address when contacts are unavailable', async () => {
    const h = setup(
      vi.fn(async (): Promise<Contact[]> => {
        throw new Error('unavailable')
      })
    )
    h.emit()
    await waitFor(() =>
      expect(useAppStore.getState().toasts[0]?.message).toBe(
        'npub1abcde...vxyz: Hello'
      )
    )
  })

  it('limits long sender names', async () => {
    const h = setup(vi.fn(async () => [{ ...contact, name: '가'.repeat(30) }]))
    h.emit()
    await waitFor(() =>
      expect(useAppStore.getState().toasts[0]?.message).toBe(
        `${'가'.repeat(20)}...: Hello`
      )
    )
  })

  it.each([
    'own',
    'muted',
    'blocked',
    'deleted',
    'active',
    'background',
    'history',
  ])('suppresses %s messages', async (kind) => {
    const h = setup()
    if (kind === 'muted') h.conversation.muted = true
    if (kind === 'blocked') h.conversation.blocked = true
    if (kind === 'deleted') h.conversation.deletedAt = 1
    if (kind === 'active') useChatView.getState().setActive('room')
    if (kind === 'background')
      vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden')
    h.emit({
      outgoing: kind === 'own',
      createdAt: kind === 'history' ? 1 : Date.now(),
    })
    await act(async () => {})
    expect(useAppStore.getState().toasts).toHaveLength(0)
  })

  it.each(['lock', 'unmount', 'enter', 'mute'])(
    'rechecks %s while contacts load',
    async (kind) => {
      let resolve!: (contacts: Contact[]) => void
      const h = setup(
        vi.fn(
          () =>
            new Promise<Contact[]>((done) => {
              resolve = done
            })
        )
      )
      h.emit()
      if (kind === 'lock') h.rerender({ unlocked: false })
      if (kind === 'unmount') h.unmount()
      if (kind === 'enter') useChatView.getState().setActive('room')
      if (kind === 'mute') h.conversation.muted = true
      await act(async () => resolve([contact]))
      expect(useAppStore.getState().toasts).toHaveLength(0)
    }
  )

  it('clears only chat previews when locked', async () => {
    const h = setup()
    useAppStore.getState().addToast({ type: 'success', message: 'Saved' })
    h.emit()
    await waitFor(() => expect(useAppStore.getState().toasts).toHaveLength(2))
    act(() => useAppStore.getState().setLocked(true))
    expect(useAppStore.getState().toasts.map((toast) => toast.message)).toEqual(
      ['Saved']
    )
  })

  it('discards an older lookup that resolves after a newer notification', async () => {
    const initialTime = Date.now()
    const now = vi.spyOn(Date, 'now').mockReturnValue(initialTime)
    const pending: Array<(contacts: Contact[]) => void> = []
    const h = setup(
      vi.fn(() => new Promise<Contact[]>((done) => pending.push(done)))
    )
    h.emit({ content: 'Older' })
    now.mockReturnValue(initialTime + 3000)
    h.emit({ content: 'Latest' })
    await act(async () => pending[1]([contact]))
    await act(async () => pending[0]([contact]))
    expect(useAppStore.getState().toasts.map((toast) => toast.message)).toEqual(
      ['Alice: Latest']
    )
    now.mockRestore()
  })

  it('blocks pending previews as soon as the store locks', async () => {
    let resolve!: (contacts: Contact[]) => void
    const h = setup(
      vi.fn(
        () =>
          new Promise<Contact[]>((done) => {
            resolve = done
          })
      )
    )
    h.emit()
    act(() => useAppStore.getState().setLocked(true))
    await act(async () => resolve([contact]))
    expect(useAppStore.getState().toasts).toHaveLength(0)
  })

  it('does not associate trade participants with ordinary contacts', async () => {
    const list = vi.fn(async () => [contact])
    const h = setup(list)
    h.conversation.channel = 'trade'
    h.conversation.contextId = 'order'
    h.emit()
    await waitFor(() =>
      expect(useAppStore.getState().toasts[0]?.message).toBe(
        'chat.contextLabel: Hello'
      )
    )
    expect(list).not.toHaveBeenCalled()
  })
})
