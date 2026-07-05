import { useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import type { ServiceRegistry } from '@/core/ports/driving/service-registry'
import {
  countUnreadSupportReplies,
  type SupportMessage,
  type SupportSnapshot,
  type SupportTicket,
} from '@/core/domain/support'
import { useAppStore } from '@/store'
import { onWake } from '@/core/utils/wake-signal'

export function useSupportNotifications(registry: ServiceRegistry | null): void {
  const { t } = useTranslation()
  const addToast = useAppStore((state) => state.addToast)
  const setSupportUnreadSummary = useAppStore((state) => state.setSupportUnreadSummary)
  const activeSupportTicketId = useAppStore((state) => state.activeSupportTicketId)
  const activeSupportTicketIdRef = useRef<string | null>(activeSupportTicketId)

  useEffect(() => {
    activeSupportTicketIdRef.current = activeSupportTicketId
  }, [activeSupportTicketId])

  useEffect(() => {
    if (!registry) {
      setSupportUnreadSummary(0, [])
      return
    }

    const support = registry.support
    const seenSupportMessageIds = new Set<string>()
    let initialConnectCompleted = false
    let disposed = false
    let lastRefreshAt = 0

    const rememberSupportMessages = (snapshot: SupportSnapshot) => {
      for (const message of getSupportMessages(snapshot)) {
        seenSupportMessageIds.add(message.id)
      }
    }

    const handleSnapshot = (snapshot: SupportSnapshot) => {
      setSupportUnreadSummary(...calculateUnreadSummary(snapshot))

      if (!initialConnectCompleted) {
        rememberSupportMessages(snapshot)
        return
      }

      for (const message of getSupportMessages(snapshot)) {
        if (seenSupportMessageIds.has(message.id)) continue
        seenSupportMessageIds.add(message.id)

        if (message.ticketId === activeSupportTicketIdRef.current) continue
        const ticket = snapshot.tickets.find((item) => item.id === message.ticketId)
        if (!ticket) continue

        addToast({
          type: 'info',
          message: t('support.replyToast', { title: ticket.title }),
          duration: 4000,
        })
      }
    }

    const unsubscribe = support.subscribe(handleSnapshot)

    support.connect()
      .then((snapshot) => {
        if (disposed) return
        rememberSupportMessages(snapshot)
        initialConnectCompleted = true
        setSupportUnreadSummary(...calculateUnreadSummary(snapshot))
      })
      .catch(() => {
        initialConnectCompleted = true
      })

    const refresh = () => {
      const now = Date.now()
      if (now - lastRefreshAt < 15_000) return
      lastRefreshAt = now
      support.refresh().catch(() => undefined)
    }

    // onWake 단일 소유 (설계 §10 B7): online/visibility 자체 리스너 2계통을
    // 3s 디바운스된 공용 wake 신호 구독 1곳으로 통일. 15s 자체 스로틀은
    // onWake 위에 유지된다.
    const stopWake = onWake(refresh)

    return () => {
      disposed = true
      unsubscribe()
      stopWake()
      setSupportUnreadSummary(0, [])
    }
  }, [registry, addToast, setSupportUnreadSummary, t])
}

function calculateUnreadSummary(snapshot: SupportSnapshot): [number, string[]] {
  let count = 0
  const ticketIds: string[] = []

  for (const ticket of snapshot.tickets) {
    const unread = countUnreadSupportReplies(ticket, snapshot.messages[ticket.id] ?? [])
    if (unread <= 0) continue
    count += unread
    ticketIds.push(ticket.id)
  }

  return [count, ticketIds]
}

function getSupportMessages(snapshot: SupportSnapshot): SupportMessage[] {
  return snapshot.tickets.flatMap((ticket: SupportTicket) =>
    (snapshot.messages[ticket.id] ?? []).filter((message) => message.sender === 'support'),
  )
}
