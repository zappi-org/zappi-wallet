import { useEffect, useSyncExternalStore } from 'react'
import { useTranslation } from 'react-i18next'
import type { ServiceRegistry } from '@/core/ports/driving/service-registry'
import type { ChatSnapshot } from '@/core/domain/chat'
import { conversationCapabilities, unreadChatCount } from '@/core/domain/chat'
import {
  chatPaymentRequestType,
  parseChatPaymentNotice,
} from '@/core/domain/chat-payment'
import { contactPubkey } from '@/ui/screens/Chat/chat-address'
import { useServiceRegistry } from './use-service-registry'
import { useChatView } from '@/store/chat-view'
import { useAppStore } from '@/store'
import { navigateToScreen } from '@/ui/navigation/navigation-store'

const empty: ChatSnapshot = {
  conversations: [],
  messages: [],
  ready: false,
  error: false,
}
const noopSubscribe = () => () => undefined
const emptySnapshot = () => empty
export function useChat() {
  const { chat } = useServiceRegistry()
  const snapshot = useSyncExternalStore(
    chat.subscribe,
    chat.getSnapshot,
    chat.getSnapshot
  )
  return { chat, ...snapshot }
}

export function useChatNotifications(
  registry: ServiceRegistry | null,
  unlocked: boolean
) {
  const { t } = useTranslation()
  const chat = registry?.chat
  const snapshot = useSyncExternalStore(
    chat?.subscribe ?? noopSubscribe,
    chat?.getSnapshot ?? emptySnapshot,
    emptySnapshot
  )
  useEffect(() => {
    if (!registry || !chat || !unlocked) return
    const started = Date.now()
    let lastToast = 0
    let active = true
    let sequence = 0
    const toastIds = new Set<string>()
    const clearPreviews = () => {
      const ids = [...toastIds]
      toastIds.clear()
      for (const id of ids) useAppStore.getState().removeToast(id)
    }
    const stopLock = useAppStore.subscribe((state, previous) => {
      if (state.isLocked && !previous.isLocked) {
        active = false
        clearPreviews()
      }
    })
    const eligible = (conversationId: string) => {
      const conversation = chat
        .getSnapshot()
        .conversations.find((c) => c.id === conversationId)
      return active &&
        !useAppStore.getState().isLocked &&
        document.visibilityState === 'visible' &&
        useChatView.getState().activeId !== conversationId &&
        conversation &&
        !conversation.muted &&
        !conversation.blocked &&
        !conversation.deletedAt
        ? conversation
        : null
    }
    const stop = chat.onMessage((message) => {
      const conversation = eligible(message.conversationId)
      if (
        !conversation ||
        message.outgoing ||
        message.createdAt < started - 5000 ||
        Date.now() - lastToast < 2500
      )
        return
      lastToast = Date.now()
      const current = ++sequence
      void (async () => {
        let sender = conversation.contextId
          ? t('chat.contextLabel', { id: conversation.contextId.slice(0, 8) })
          : `${message.sender.slice(0, 8)}...${message.sender.slice(-4)}`
        if (conversationCapabilities(conversation).contacts) {
          try {
            const address = registry.crypto.encodeNpub(message.sender)
            sender = `${address.slice(0, 10)}...${address.slice(-4)}`
          } catch {
            /* Keep a short identifier for non-Nostr channels. */
          }
          try {
            const contacts = await registry.contact.list()
            const contact = contacts.find((c) =>
              c.addresses.some((a) => contactPubkey(a.value) === message.sender)
            )
            if (contact) sender = contact.name
          } catch {
            /* The address remains available without contacts. */
          }
        }
        if (current !== sequence || !eligible(message.conversationId)) return
        const content = parseChatPaymentNotice(message.content)
          ? t('chat.paymentCard.noticeTitle')
          : chatPaymentRequestType(message.content)
          ? t('chat.paymentRequest')
          : message.content
        const onAction = () => {
          if (!active || useAppStore.getState().isLocked) return
          useChatView.getState().select(message.conversationId)
          navigateToScreen('chat')
        }
        const store = useAppStore.getState()
        for (const id of toastIds) {
          if (!store.toasts.some((toast) => toast.id === id))
            toastIds.delete(id)
        }
        store.addToast({
          type: 'info',
          message: `${preview(sender, 20)}: ${preview(content, 40)}`,
          duration: 4500,
          onAction,
        })
        const toast = useAppStore
          .getState()
          .toasts.find((item) => item.onAction === onAction)
        if (toast) toastIds.add(toast.id)
      })()
    })
    void chat.connect().catch(() => undefined)
    return () => {
      active = false
      stopLock()
      clearPreviews()
      stop()
      chat.disconnect()
      useChatView.getState().setActive(null)
    }
  }, [registry, chat, unlocked, t])
  return unlocked ? unreadChatCount(snapshot.conversations) : 0
}

function preview(value: string, limit: number): string {
  const characters = Array.from(value.replace(/\s+/gu, ' ').trim())
  return (
    characters.slice(0, limit).join('') +
    (characters.length > limit ? '...' : '')
  )
}
