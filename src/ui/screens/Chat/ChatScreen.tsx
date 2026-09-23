import { ChatPaymentCard } from './ChatPaymentCard'
import { chatPaymentRequestType, parseChatPaymentNotice } from '@/core/domain/chat-payment'
import { useChatPaymentRecords } from '@/ui/hooks/use-chat-payment-records'
import { ChatCapacityError } from '@/core/errors/chat'
import { conversationCapabilities } from '@/core/domain/chat'
import { useChatMessageMotion } from '@/ui/hooks/use-chat-message-motion'
import { ConfirmDialog } from '@/ui/components/common/ConfirmDialog'
import { ChatContactMenu } from './ChatContactMenu'
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useReducedMotion } from 'motion/react'
import {
  ArrowLeft,
  ArrowUp,
  ArrowDown,
  Plus,
  Check,
  Clock,
  RotateCw,
  ShieldCheck,
  Bell,
  BellOff,
  Ban,
  Trash2,
} from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { useChat } from '@/ui/hooks/use-chat'
import { useContacts } from '@/ui/hooks/use-contacts'
import { useChatViewport } from '@/ui/hooks/use-chat-viewport'
import { useIsActivityTop } from '@/ui/navigation/use-is-activity-top'
import { useServiceRegistry } from '@/ui/hooks/use-service-registry'
import { useChatView } from '@/store/chat-view'
import { useAppStore } from '@/store'
import { ContactFormModal } from '@/ui/screens/Contacts/ContactFormModal'
import { contactPubkey } from './chat-address'
import { ChatAvatar } from './ChatAvatar'

export default function ChatScreen({
  onBack,
  onSend,
  onRequest,
  onPay,
  onDetails,
}: {
  onBack: () => void
  onSend: (address: string, name: string) => void | Promise<void>
  onRequest: () => void
  onPay: (content: string, messageId?: string) => Promise<void>
  onDetails?: (transactionId: string) => Promise<void>
}) {
  const { t, i18n } = useTranslation()
  const { chat, conversations, messages, error, errorReason } = useChat()
  const id = useChatView((s) => s.selectedId)
  const submittedInSession = useChatView((s) => s.submittedRequests)
  const conversation = conversations.find((c) => c.id === id)
  const capabilities = conversation
    ? conversationCapabilities(conversation)
    : { contacts: false, payments: false, deletion: false, blocking: false }
  const { contacts, createContact, updateContact } = useContacts()
  const { crypto, inputParser } = useServiceRegistry()
  const contact = contacts.find(
    (c) =>
      capabilities.contacts && contactPubkey(c.address) === conversation?.peer
  )
  const npub =
    conversation && capabilities.contacts
      ? crypto.encodeNpub(conversation.peer)
      : ''
  const name =
    contact?.name ??
    (conversation?.contextId
      ? t('chat.contextLabel', { id: conversation.contextId.slice(0, 8) })
      : `${(npub || conversation?.peer || '').slice(0, 12)}…`)
  const top = useIsActivityTop()
  const reduced = useReducedMotion()
  const [text, setText] = useState(conversation?.draft ?? '')
  const [draftLoaded, setDraftLoaded] = useState(!!conversation)
  const draftHydrated = useRef(!!conversation)
  const [actions, setActions] = useState(false)
  const [form, setForm] = useState(false)
  const viewport = useChatViewport(top && !form)
  const [sending, setSending] = useState(false)
  const [unsaved, setUnsaved] = useState<string[]>([])
  const sendPending = useRef(false)
  const keepComposerFocus = useRef(false)
  const actionButton = useRef<HTMLButtonElement>(null)
  const actionTouchFocus = useRef(false)
  const actionTouchHandled = useRef(false)
  const [confirmation, setConfirmation] = useState<'block' | 'delete' | null>(
    null
  )
  const [confirming, setConfirming] = useState(false)
  const [retrying, setRetrying] = useState<string | null>(null)
  const [startingPayment, setStartingPayment] = useState(false)
  const [away, setAway] = useState(false)
  const scroll = useRef<HTMLDivElement>(null)
  const input = useRef<HTMLTextAreaElement>(null)
  const composerActionsAvailable =
    !!conversation && !conversation.blocked && capabilities.payments
  useEffect(() => {
    const button = actionButton.current
    if (!button) return
    const onTouchEnd = (event: TouchEvent) => {
      if (!actionTouchFocus.current) return
      actionTouchFocus.current = false
      actionTouchHandled.current = true
      if (event.cancelable) event.preventDefault()
      input.current?.focus({ preventScroll: true })
      const touch = event.changedTouches[0]
      const bounds = button.getBoundingClientRect()
      if (
        event.changedTouches.length !== 1 ||
        touch.clientX < bounds.left ||
        touch.clientX > bounds.right ||
        touch.clientY < bounds.top ||
        touch.clientY > bounds.bottom
      )
        return
      setActions((open) => !open)
    }
    // Safari needs a non-passive touch end to keep the keyboard open.
    button.addEventListener('touchend', onTouchEnd, { passive: false })
    return () => button.removeEventListener('touchend', onTouchEnd)
  }, [composerActionsAvailable])
  const atBottom = useRef(true)
  const touchingTranscript = useRef(false)
  const draft = useRef(text)
  useLayoutEffect(() => {
    if (!conversation || draftHydrated.current) return
    draftHydrated.current = true
    draft.current = conversation.draft
    setText(conversation.draft)
    setDraftLoaded(true)
  }, [conversation])
  const thread = useMemo(
    () => messages.filter((m) => m.conversationId === id),
    [messages, id]
  )
  const [firstVisibleId, setFirstVisibleId] = useState<string | null>(
    () => thread[Math.max(0, thread.length - 80)]?.id ?? null
  )
  const firstVisibleIndex = firstVisibleId
    ? Math.max(
        0,
        thread.findIndex((message) => message.id === firstVisibleId)
      )
    : Math.max(0, thread.length - 80)
  const page = thread.slice(firstVisibleIndex)
  const submittedRequests = new Set(
    thread.flatMap((message) =>
      message.outgoing &&
      message.payment?.kind === 'send' &&
      message.payment.requestMessageId
        ? [message.payment.requestMessageId]
        : []
    )
  )
  const paymentRecords = useChatPaymentRecords(page, top)
  const historyPosition = useRef<{ height: number; top: number } | null>(null)
  useLayoutEffect(() => {
    if (!firstVisibleId && thread.length)
      setFirstVisibleId(thread[Math.max(0, thread.length - 80)].id)
  }, [firstVisibleId, thread])
  const fail = () =>
    useAppStore
      .getState()
      .addToast({ type: 'error', message: t('chat.saveFailed') })
  useEffect(() => {
    if (!top || !id) return
    const update = () => {
      const active = document.visibilityState === 'visible'
      useChatView.getState().setActive(active ? id : null)
      if (active && atBottom.current)
        void chat.markRead(id).catch(() => undefined)
    }
    update()
    document.addEventListener('visibilitychange', update)
    return () => {
      document.removeEventListener('visibilitychange', update)
      useChatView.getState().setActive(null)
    }
  }, [chat, id, top])
  useEffect(() => {
    if (
      top &&
      id &&
      conversation?.unread &&
      atBottom.current &&
      document.visibilityState === 'visible'
    )
      void chat.markRead(id).catch(() => undefined)
  }, [chat, id, top, conversation?.unread])
  useEffect(() => {
    if (!draftLoaded) return
    draft.current = text
    if (!id) return
    const timer = setTimeout(() => {
      void chat.update(id, { draft: text }).catch(() => undefined)
    }, 400)
    return () => clearTimeout(timer)
  }, [chat, id, text, draftLoaded])
  useEffect(
    () => () => {
      if (id && draftHydrated.current)
        void chat.update(id, { draft: draft.current }).catch(() => undefined)
    },
    [chat, id]
  )
  useLayoutEffect(() => {
    if (!input.current) return
    input.current.style.height = 'auto'
    input.current.style.height = `${Math.min(
      input.current.scrollHeight,
      128
    )}px`
  }, [text])
  const messageMotion = useChatMessageMotion({
    messages: thread,
    scroll,
    input,
    atBottom,
    active: top && !!conversation,
    reduced: !!reduced,
    setAway,
  })
  useLayoutEffect(() => {
    const node = scroll.current
    const saved = historyPosition.current
    if (!node || !saved) return
    node.scrollTo({
      top: saved.top + node.scrollHeight - saved.height,
      behavior: 'instant',
    })
    historyPosition.current = null
  }, [firstVisibleId])
  const syncReadPosition = () => {
    const node = scroll.current
    if (!node) return
    atBottom.current =
      !touchingTranscript.current &&
      node.scrollHeight - node.scrollTop - node.clientHeight < 8
    if (atBottom.current) {
      setAway(false)
      if (
        id &&
        top &&
        conversation?.unread &&
        document.visibilityState === 'visible'
      )
        void chat.markRead(id).catch(() => undefined)
    }
  }
  const send = async (preserveFocus = false, unsavedIndex?: number) => {
    const content = unsavedIndex === undefined ? text : unsaved[unsavedIndex]
    if (!id || sendPending.current || !content?.trim()) return
    if (unsavedIndex === undefined) messageMotion.captureComposer(content)
    if (preserveFocus) input.current?.focus({ preventScroll: true })
    sendPending.current = true
    setSending(true)
    const existingIds = new Set(chat.getSnapshot().messages.map((m) => m.id))
    if (unsavedIndex === undefined) {
      setText('')
      draft.current = ''
    }
    atBottom.current = true
    try {
      await chat.enqueue(id, content)
      if (unsavedIndex !== undefined)
        setUnsaved((items) =>
          items.filter((_, index) => index !== unsavedIndex)
        )
    } catch (error) {
      if (
        !chat
          .getSnapshot()
          .messages.some(
            (m) =>
              !existingIds.has(m.id) &&
              m.outgoing &&
              m.conversationId === id &&
              m.content === content.trim()
          )
      ) {
        if (unsavedIndex === undefined) {
          if (!draft.current) {
            setText(content)
            draft.current = content
          } else setUnsaved((items) => [...items, content])
        }
      }
      useAppStore.getState().addToast({
        type: 'error',
        message: t(
          error instanceof ChatCapacityError
            ? 'chat.storageFull'
            : 'chat.sendFailed'
        ),
      })
    } finally {
      sendPending.current = false
      setSending(false)
    }
  }
  if (!conversation)
    return (
      <div className="h-full pt-safe p-5">
        <button onClick={onBack} className="py-4">
          {t('common.back')}
        </button>
        <p>{t('chat.emptyTitle')}</p>
      </div>
    )
  return (
    <div
      ref={viewport}
      className="absolute inset-x-0 top-0 h-full min-h-0 flex flex-col overflow-hidden bg-background text-foreground pt-safe"
    >
      <header className="relative flex items-center justify-between gap-2 px-3 py-2 shrink-0 border-b border-border/40">
        <button
          onClick={onBack}
          aria-label={t('common.back')}
          className="size-11 flex items-center justify-center"
        >
          <ArrowLeft size={23} />
        </button>
        <div className="pointer-events-none absolute inset-x-14 inset-y-0 flex min-w-0 flex-col items-center justify-center text-center">
          <h1 className="max-w-full font-semibold truncate">{name}</h1>
          <p className="flex items-center gap-1 text-[11px] text-foreground-muted">
            <ShieldCheck size={12} />
            {t('chat.encrypted')}
          </p>
        </div>
        <ChatContactMenu
          known={!!contact}
          onContact={capabilities.contacts ? () => setForm(true) : undefined}
          actions={[
            {
              key: 'mute',
              label: t(conversation.muted ? 'chat.unmute' : 'chat.mute'),
              icon: conversation.muted ? (
                <Bell size={18} />
              ) : (
                <BellOff size={18} />
              ),
              onSelect: () => {
                void chat
                  .update(conversation.id, { muted: !conversation.muted })
                  .catch(fail)
              },
            },
            {
              key: 'block',
              label: t(conversation.blocked ? 'chat.unblock' : 'chat.block'),
              icon: <Ban size={18} />,
              onSelect: () => {
                if (conversation.blocked)
                  void chat
                    .update(conversation.id, { blocked: false })
                    .catch(fail)
                else setConfirmation('block')
              },
            },
            {
              key: 'delete',
              label: t('chat.deleteConversation'),
              icon: <Trash2 size={18} />,
              danger: true,
              onSelect: () => setConfirmation('delete'),
            },
          ].filter(
            (item) =>
              (item.key !== 'delete' || capabilities.deletion) &&
              (item.key !== 'block' || capabilities.blocking)
          )}
        />
      </header>
      {capabilities.contacts && !contact && (
        <button
          onClick={() => setForm(true)}
          className="text-caption text-brand px-4 py-3 bg-brand/5 text-left"
        >
          {t('chat.unknownContact')}
        </button>
      )}
      {error && (
        <p
          role="status"
          className="px-4 py-2 text-caption text-accent-danger"
        >
          {t(
            errorReason === 'storage'
              ? 'chat.storageFull'
              : errorReason === 'receive'
              ? 'chat.receiveFull'
              : 'chat.loadFailed'
          )}
        </p>
      )}
      <div
        ref={scroll}
        role="log"
        aria-label={t('chat.title')}
        aria-live="polite"
        aria-relevant="additions"
        className="flex-1 min-h-0 overflow-y-auto overscroll-contain px-4 py-4 [overflow-anchor:none]"
        onTouchStart={() => {
          touchingTranscript.current = true
          atBottom.current = false
          messageMotion.interrupt()
        }}
        onTouchEnd={() => {
          touchingTranscript.current = false
          syncReadPosition()
        }}
        onTouchCancel={() => {
          touchingTranscript.current = false
          syncReadPosition()
        }}
        onWheel={(event) => {
          if (event.deltaY < 0) atBottom.current = false
          messageMotion.interrupt()
        }}
        onScroll={syncReadPosition}
      >
        {firstVisibleIndex > 0 && (
          <button
            className="w-full py-3 text-brand text-caption"
            onClick={() => {
              messageMotion.interrupt()
              atBottom.current = false
              const node = scroll.current!
              historyPosition.current = {
                height: node.scrollHeight,
                top: node.scrollTop,
              }
              setFirstVisibleId(
                thread[Math.max(0, firstVisibleIndex - 80)].id
              )
            }}
          >
            {t('chat.older')}
          </button>
        )}
        {!thread.length && (
          <p className="py-12 text-center text-caption text-foreground-muted">
            {t('chat.sayHello')}
          </p>
        )}
        <div className="flow-root [overflow:clip]" data-chat-motion-clip>
          <div ref={messageMotion.content}>
            {page.map((m, index) => {
              const day = new Date(m.createdAt).toLocaleDateString(
                i18n.language,
                { month: 'long', day: 'numeric' }
              )
              const prior = page[index - 1]
              const newDay =
                !prior ||
                new Date(prior.createdAt).toDateString() !==
                  new Date(m.createdAt).toDateString()
              let requestAmount: number | undefined
              let requestUnit = 'sat'
              let requestMemo: string | undefined
              const notice = capabilities.payments
                ? parseChatPaymentNotice(m.content)
                : null
              const paymentRecord = paymentRecords.get(m.id)
              const requestType = chatPaymentRequestType(m.content)
              if (requestType === 'cashu') {
                try {
                  const parsed = inputParser.decodeCashuRequest(m.content.trim())
                  requestAmount = parsed.amount
                  requestUnit = parsed.unit
                  if (typeof parsed.description === 'string') requestMemo = parsed.description.trim() || undefined
                } catch {
                  /* Validation is repeated before payment. */
                }
              }
              const request = capabilities.payments && requestType !== null
              return (
                <div
                  key={m.id}
                  ref={(node) => {
                    if (node) messageMotion.rows.current.set(m.id, node)
                    else messageMotion.rows.current.delete(m.id)
                  }}
                >
                  {newDay && (
                    <p className="text-center text-[11px] text-foreground-muted py-4">
                      {day}
                    </p>
                  )}
                  <div
                    className={`group flex items-end gap-1.5 mb-3 ${
                      m.outgoing ? 'justify-end' : 'justify-start'
                    }`}
                  >
                    {!m.outgoing && (
                      <span data-chat-avatar className="self-start mt-0.5">
                        <ChatAvatar name={name} size="small" />
                      </span>
                    )}
                    <div
                      className={`flex min-w-0 max-w-[calc(100%-2.5rem)] items-end gap-1.5 ${
                        m.outgoing ? 'flex-row-reverse' : ''
                      }`}
                    >
                      <div
                        ref={(node) => {
                          if (node)
                            messageMotion.bubbles.current.set(m.id, node)
                          else messageMotion.bubbles.current.delete(m.id)
                        }}
                        className={
                          request || notice
                            ? 'min-w-0 max-w-full'
                            : `min-w-0 rounded-[20px] px-4 py-2.5 ${
                                m.outgoing
                                  ? 'bg-brand text-white rounded-br-md'
                                  : 'bg-background-card border border-border/50 rounded-bl-md'
                              }`
                        }
                      >
                        {request || notice ? (
                          <ChatPaymentCard
                            peerName={name}
                            description={requestMemo}
                            kind={notice ? 'send' : 'request'}
                            amount={
                              notice?.amount ??
                              m.payment?.amount ??
                              requestAmount
                            }
                            unit={notice?.unit ?? requestUnit}
                            outgoing={m.outgoing}
                            status={
                              paymentRecord?.status ??
                              (notice ? 'notice' : 'unknown')
                            }
                            expiresAt={
                              m.expiresAt ?? (m.payment?.kind === 'request'
                                ? m.payment.expiresAt
                                : undefined)
                            }
                            paymentSubmitted={submittedRequests.has(m.id) || !!submittedInSession[`${id}:${m.id}`]}
                            onPay={
                              request &&
                              !m.outgoing
                                ? () => onPay(m.content, m.id)
                                : undefined
                            }
                            onDetails={
                              paymentRecord?.transaction && onDetails
                                ? () => {
                                    void onDetails(
                                      paymentRecord.transaction!.id
                                    ).catch(fail)
                                  }
                                : undefined
                            }
                          />
                        ) : (
                          <p className="whitespace-pre-wrap break-words [overflow-wrap:anywhere] text-base leading-relaxed select-text">
                            {m.content}
                          </p>
                        )}
                      </div>
                      <div
                        data-chat-metadata
                        className="flex shrink-0 flex-col items-end gap-0.5 pb-1 text-[10px] text-foreground-muted"
                      >
                        <time
                          className="whitespace-nowrap"
                          dateTime={new Date(m.createdAt).toISOString()}
                        >
                          {new Date(m.createdAt).toLocaleTimeString(
                            i18n.language,
                            { hour: '2-digit', minute: '2-digit' }
                          )}
                        </time>
                        {m.outgoing &&
                          (m.status === 'sent' ? (
                            <Check size={12} aria-label={t('chat.sent')} />
                          ) : m.status === 'sending' ? (
                            <Clock size={12} aria-label={t('chat.sending')} />
                          ) : (
                            <button
                              className="text-accent-danger flex items-center gap-1 min-h-8 px-1"
                              disabled={!!retrying}
                              onClick={async () => {
                                setRetrying(m.id)
                                try {
                                  await chat.retry(m.id, m.conversationId)
                                } catch {
                                  fail()
                                } finally {
                                  setRetrying(null)
                                }
                              }}
                            >
                              <RotateCw size={12} />
                              {t('common.retry')}
                            </button>
                          ))}
                      </div>
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      </div>
      {away && (
        <button
          onClick={() => {
            atBottom.current = true
            scroll.current?.scrollTo({
              top: scroll.current.scrollHeight,
              behavior: reduced ? 'instant' : 'smooth',
            })
            setAway(false)
          }}
          className="absolute right-5 bottom-24 flex gap-2 rounded-full bg-brand text-white px-4 py-2 shadow-sm"
        >
          <ArrowDown size={18} />
          {t('chat.newMessages')}
        </button>
      )}
      {conversation.blocked ? (
        <p className="p-5 text-center text-caption">{t('chat.blocked')}</p>
      ) : (
        <footer
          className="shrink-0 px-3 pt-2 bg-background-card border-t border-border/40"
          style={{
            paddingBottom:
              'max(10px, var(--chat-bottom-inset, env(safe-area-inset-bottom)))',
          }}
        >
          {unsaved.length > 0 && (
            <div
              role="status"
              className="max-h-32 overflow-y-auto pb-2 text-caption"
            >
              {unsaved.map((content, index) => (
                <div key={index} className="flex items-center gap-3 py-2">
                  <div className="min-w-0 flex-1">
                    <p className="text-accent-danger">
                      {t('chat.sendFailed')}
                    </p>
                    <p className="truncate" title={content}>
                      {content}
                    </p>
                  </div>
                  <button
                    type="button"
                    disabled={sending}
                    onClick={() => void send(false, index)}
                    className="shrink-0 px-3 py-2 text-brand disabled:opacity-40"
                  >
                    {t('common.retry')}
                  </button>
                </div>
              ))}
            </div>
          )}
          {capabilities.payments && actions && (
            <div className="flex gap-2 pb-3">
              <button
                className="flex-1 rounded-full bg-brand/10 text-brand py-3 text-caption font-semibold"
                disabled={startingPayment}
                onClick={async () => {
                  if (startingPayment) return
                  setStartingPayment(true)
                  try {
                    await onSend(npub, name)
                    setActions(false)
                  } catch {
                    fail()
                  } finally {
                    setStartingPayment(false)
                  }
                }}
              >
                {t(startingPayment ? 'common.loading' : 'chat.sendMoney')}
              </button>
              <button
                className="flex-1 rounded-full bg-brand/10 text-brand py-3 text-caption font-semibold"
                onClick={() => {
                  setActions(false)
                  onRequest()
                }}
              >
                {t('chat.request')}
              </button>
            </div>
          )}
          <form
            className="flex gap-2 items-end"
            onKeyDown={(e) => {
              if (e.key === 'Escape' && actions) {
                e.preventDefault()
                setActions(false)
              }
            }}
            onSubmit={(e) => {
              e.preventDefault()
              void send()
            }}
          >
            {capabilities.payments && (
              <button
                ref={actionButton}
                type="button"
                aria-label={t(actions ? 'common.close' : 'chat.paymentActions')}
                aria-expanded={actions}
                className="size-11 shrink-0 flex items-center justify-center"
                onPointerDown={(event) => {
                  actionTouchHandled.current = false
                  if (document.activeElement === input.current)
                    event.preventDefault()
                }}
                onMouseDown={(event) => {
                  if (document.activeElement === input.current)
                    event.preventDefault()
                }}
                onTouchStart={(event) => {
                  actionTouchHandled.current = false
                  actionTouchFocus.current =
                    event.touches.length === 1 &&
                    document.activeElement === input.current
                }}
                onTouchCancel={() => {
                  actionTouchFocus.current = false
                  actionTouchHandled.current = true
                }}
                onClick={(event) => {
                  if (event.detail > 0 && actionTouchHandled.current) return
                  setActions((open) => !open)
                }}
              >
                <Plus
                  size={24}
                  aria-hidden="true"
                  className="transition-transform duration-200 ease-[cubic-bezier(0.22,1,0.36,1)] motion-reduce:transition-none"
                  style={{ transform: actions ? 'rotate(45deg)' : 'rotate(0deg)' }}
                />
              </button>
            )}
            <textarea
              ref={input}
              rows={1}
              maxLength={4000}
              value={text}
              onChange={(e) => {
                draft.current = e.target.value
                setText(e.target.value)
              }}
              onKeyDown={(e) => {
                if (
                  e.key === 'Enter' &&
                  !e.shiftKey &&
                  !e.nativeEvent.isComposing &&
                  matchMedia('(pointer: fine)').matches
                ) {
                  e.preventDefault()
                  void send()
                }
              }}
              placeholder={t('chat.messagePlaceholder')}
              aria-label={t('chat.messagePlaceholder')}
              className="min-h-11 flex-1 min-w-0 resize-none rounded-[22px] bg-background px-4 py-2.5 text-base outline-none focus-visible:ring-2 focus-visible:ring-brand"
            />
            <button
              type="button"
              onPointerDown={(event) => {
                keepComposerFocus.current =
                  document.activeElement === input.current
                if (keepComposerFocus.current) event.preventDefault()
              }}
              onMouseDown={(event) => {
                if (document.activeElement === input.current)
                  event.preventDefault()
              }}
              onTouchStart={() => {
                keepComposerFocus.current =
                  document.activeElement === input.current
              }}
              onTouchEnd={(event) => {
                if (!keepComposerFocus.current) return
                event.preventDefault()
                const touch = event.changedTouches[0]
                const bounds = event.currentTarget.getBoundingClientRect()
                if (
                  touch &&
                  (touch.clientX < bounds.left ||
                    touch.clientX > bounds.right ||
                    touch.clientY < bounds.top ||
                    touch.clientY > bounds.bottom)
                )
                  return
                void send(true)
              }}
              onClick={() => {
                void send(keepComposerFocus.current)
              }}
              disabled={sending || !text.trim()}
              aria-label={t('common.send')}
              className="size-11 shrink-0 flex items-center justify-center rounded-full bg-brand text-white disabled:opacity-40"
            >
              <ArrowUp size={23} />
            </button>
          </form>
        </footer>
      )}
      <ConfirmDialog
        isOpen={confirmation !== null && top}
        onClose={() => {
          if (!confirming) setConfirmation(null)
        }}
        title={t(
          confirmation === 'delete' ? 'chat.deleteTitle' : 'chat.block'
        )}
        description={t(
          confirmation === 'delete'
            ? 'chat.deleteDescription'
            : 'chat.blockDescription'
        )}
        confirmLabel={t(
          confirmation === 'delete' ? 'common.delete' : 'chat.block'
        )}
        cancelLabel={t('common.cancel')}
        loading={confirming}
        confirmVariant="destructive"
        onConfirm={async () => {
          if (confirming) return
          setConfirming(true)
          try {
            if (confirmation === 'delete') {
              await chat.delete(conversation.id)
              useChatView.getState().select(null)
              onBack()
            } else await chat.update(conversation.id, { blocked: true })
            setConfirmation(null)
          } catch {
            fail()
          } finally {
            setConfirming(false)
          }
        }}
      />
      <ContactFormModal
        isOpen={form && top}
        onClose={() => setForm(false)}
        contact={contact}
        initialAddress={npub}
        onSave={async (data) => {
          if (contact)
            await updateContact(contact.id, {
              ...data,
              addressType: data.address.includes('@') ? 'lightning' : 'npub',
            })
          else
            await createContact({
              ...data,
              addressType: data.address.includes('@') ? 'lightning' : 'npub',
            })
        }}
      />
    </div>
  )
}
