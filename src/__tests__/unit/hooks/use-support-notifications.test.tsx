import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useSupportNotifications } from '@/ui/hooks/use-support-notifications'
import { useAppStore } from '@/store'
import type { ServiceRegistry } from '@/core/ports/driving/service-registry'
import type { SupportListener, SupportSnapshot } from '@/core/domain/support'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, params?: Record<string, string>) =>
      key === 'support.replyToast' ? `reply:${params?.title ?? ''}` : key,
  }),
}))

describe('useSupportNotifications', () => {
  beforeEach(() => {
    useAppStore.setState({
      toasts: [],
      supportUnreadCount: 0,
      supportUnreadTicketIds: [],
      activeSupportTicketId: null,
    })
  })

  it('updates unread count without toasting initial support history', async () => {
    const support = makeSupportService(makeSnapshot(['message-1']))
    renderHook(() => useSupportNotifications(makeRegistry(support)))

    await waitFor(() => {
      expect(useAppStore.getState().supportUnreadCount).toBe(1)
      expect(support.connect).toHaveBeenCalledOnce()
    })
    expect(useAppStore.getState().toasts).toHaveLength(0)
  })

  it('toasts only newly observed support replies outside the active ticket', async () => {
    const support = makeSupportService(makeSnapshot(['message-1']))
    renderHook(() => useSupportNotifications(makeRegistry(support)))

    await waitFor(() => expect(support.connect).toHaveBeenCalledOnce())

    act(() => {
      support.emit(makeSnapshot(['message-1', 'message-2']))
    })

    await waitFor(() => {
      expect(useAppStore.getState().supportUnreadCount).toBe(2)
      expect(useAppStore.getState().toasts).toMatchObject([{ type: 'info', message: 'reply:Need help' }])
    })
  })

  it('keeps unread badges but suppresses toast for the active ticket', async () => {
    useAppStore.setState({ activeSupportTicketId: 'ticket-1' })
    const support = makeSupportService(makeSnapshot(['message-1']))
    renderHook(() => useSupportNotifications(makeRegistry(support)))

    await waitFor(() => expect(support.connect).toHaveBeenCalledOnce())

    act(() => {
      support.emit(makeSnapshot(['message-1', 'message-2']))
    })

    await waitFor(() => expect(useAppStore.getState().supportUnreadCount).toBe(2))
    expect(useAppStore.getState().toasts).toHaveLength(0)
  })
})

function makeSnapshot(messageIds: string[]): SupportSnapshot {
  return {
    status: 'connected',
    availability: { available: true },
    capabilities: {
      attachments: {
        available: false,
        maxCount: 0,
        maxSizeBytes: 0,
      },
    },
    customerId: 'customer',
    tickets: [{
      id: 'ticket-1',
      threadId: 'thread-1',
      title: 'Need help',
      body: 'Help body',
      status: 'open',
      priority: 'normal',
      category: 'general',
      createdAt: 1,
      updatedAt: messageIds.length,
    }],
    messages: {
      'ticket-1': messageIds.map((id, index) => ({
        id,
        ticketId: 'ticket-1',
        threadId: 'thread-1',
        body: `Reply ${index + 1}`,
        sender: 'support',
        channel: 'thread',
        createdAt: index + 1,
      })),
    },
  }
}

function makeSupportService(initialSnapshot: SupportSnapshot) {
  let snapshot = initialSnapshot
  const listeners = new Set<SupportListener>()

  return {
    connect: vi.fn(async () => snapshot),
    refresh: vi.fn(async () => snapshot),
    subscribe: vi.fn((listener: SupportListener) => {
      listeners.add(listener)
      listener(snapshot)
      return () => listeners.delete(listener)
    }),
    emit(nextSnapshot: SupportSnapshot) {
      snapshot = nextSnapshot
      for (const listener of listeners) {
        listener(snapshot)
      }
    },
  }
}

function makeRegistry(support: ReturnType<typeof makeSupportService>): ServiceRegistry {
  return { support } as unknown as ServiceRegistry
}
