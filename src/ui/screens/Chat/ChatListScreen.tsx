import { QRCodeDisplay } from '@/ui/components/common/QRCodeDisplay'
import { useCopyFeedback } from '@/ui/hooks/use-copy-feedback'
import { chatPaymentRequestType, parseChatPaymentNotice } from '@/core/domain/chat-payment'
import { conversationCapabilities } from '@/core/domain/chat'
import { useChatViewport } from '@/ui/hooks/use-chat-viewport'
import { useIsActivityTop } from '@/ui/navigation/use-is-activity-top'
import { QrScannerModal } from '@/ui/components/common/QrScannerModal'
import { CameraFilled } from '@/ui/components/icons/CameraFilled'
import { useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { motion, useReducedMotion, useAnimationControls } from 'motion/react'
import {
  QrCode,
  MessageCircle,
  Plus,
  Search,
  Trash2,
  Pin,
  BellOff,
  MoreHorizontal,
} from 'lucide-react'
import type { Conversation } from '@/core/domain/chat'
import { unreadBadge } from '@/core/domain/chat'
import { chatOpenErrorKey, contactPubkey } from './chat-address'
import { useChat } from '@/ui/hooks/use-chat'
import { useContacts } from '@/ui/hooks/use-contacts'
import { useChatView } from '@/store/chat-view'
import { useAppStore } from '@/store'
import { Modal } from '@/ui/components/common/Modal'
import { ConfirmDialog } from '@/ui/components/common/ConfirmDialog'
import { ChatAvatar } from './ChatAvatar'

export default function ChatListScreen({
  onOpen,
  ownAddress,
}: {
  onOpen: () => void
  ownAddress?: string
}) {
  const { t } = useTranslation()
  const { chat, conversations, ready, error, errorReason } = useChat()
  const { contacts } = useContacts()
  const select = useChatView((s) => s.select)
  const [showAddress, setShowAddress] = useState(false)
  const { copy, share, isCopied, isShared } = useCopyFeedback()
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState<'all' | 'unread' | 'unknown'>('all')
  const [compose, setCompose] = useState(false)
  const [scanner, setScanner] = useState(false)
  const isTop = useIsActivityTop()
  const composeViewport = useChatViewport(compose && !scanner && isTop)
  const [address, setAddress] = useState('')
  const [busy, setBusy] = useState(false)
  const [target, setTarget] = useState<Conversation | null>(null)
  const [destructiveAction, setDestructiveAction] = useState<
    'delete' | 'block'
  >('delete')
  const [destructiveBusy, setDestructiveBusy] = useState(false)
  const [destructiveTarget, setDestructiveTarget] =
    useState<Conversation | null>(null)
  const names = useMemo(
    () => new Map(contacts.map((c) => [contactPubkey(c.address), c.name])),
    [contacts]
  )
  const name = (c: Conversation) =>
    (conversationCapabilities(c).contacts ? names.get(c.peer) : undefined) ??
    (c.contextId
      ? t('chat.contextLabel', { id: c.contextId.slice(0, 8) })
      : `${c.peer.slice(0, 8)}…${c.peer.slice(-4)}`)
  const run = (work: Promise<unknown>) => {
    void work.catch(() =>
      useAppStore
        .getState()
        .addToast({ type: 'error', message: t('chat.saveFailed') })
    )
  }
  const start = async (value: string) => {
    const peer = contactPubkey(value)
    if (!peer) {
      useAppStore
        .getState()
        .addToast({ type: 'error', message: t('chat.invalidAddress') })
      return
    }
    setBusy(true)
    try {
      await chat.connect()
      select(await chat.open(value))
      setCompose(false)
      onOpen()
    } catch (error) {
      useAppStore
        .getState()
        .addToast({ type: 'error', message: t(chatOpenErrorKey(error)) })
    } finally {
      setBusy(false)
    }
  }
  const filtered = conversations
    .filter((c) => !c.deletedAt && !c.blocked)
    .filter((c) => filter !== 'unread' || c.unread > 0)
    .filter(
      (c) =>
        filter !== 'unknown' ||
        (conversationCapabilities(c).contacts && !names.has(c.peer))
    )
    .filter((c) =>
      `${name(c)} ${c.contextId ?? ''} ${c.preview}`
        .toLowerCase()
        .includes(query.toLowerCase())
    )
    .sort(
      (a, b) =>
        Number(b.pinned) - Number(a.pinned) || b.updatedAt - a.updatedAt
    )
  return (
    <div className="h-full bg-background text-foreground flex flex-col pt-safe">
      <header className="relative flex h-14 items-center justify-between px-5 shrink-0">
        <button
          className="size-11 flex items-center justify-center disabled:opacity-30"
          disabled={!ownAddress}
          onClick={() => setShowAddress(true)}
          aria-label={t('chat.myAddress')}
        >
          <QrCode size={22} />
        </button>
        <h1 className="absolute inset-0 flex items-center justify-center text-subtitle font-semibold pointer-events-none">
          {t('chat.title')}
        </h1>
        <button
          className="size-11 flex items-center justify-center"
          onClick={() => setCompose(true)}
          aria-label={t('chat.newChat')}
        >
          <Plus size={23} />
        </button>
      </header>
      <div className="px-4 pb-3">
        <label className="flex items-center gap-2 rounded-card bg-background-card border border-border px-3">
          <Search size={18} />
          <input
            aria-label={t('common.search')}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t('chat.search')}
            className="h-11 w-full bg-transparent outline-none text-base"
          />
        </label>
      </div>
      <div className="flex gap-2 px-4 pb-3">
        {(['all', 'unread', 'unknown'] as const).map((f) => (
          <button
            key={f}
            aria-pressed={filter === f}
            onClick={() => setFilter(f)}
            className={`min-h-10 px-4 rounded-full text-caption font-medium ${
              filter === f ? 'bg-brand text-white' : 'bg-foreground/[0.05]'
            }`}
          >
            {t(`chat.${f}`)}
          </button>
        ))}
      </div>
      <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain pb-app-nav">
        {error && (
          <button
            onClick={() => run(chat.connect())}
            className="m-4 text-accent-danger"
          >
            {t(
              errorReason === 'storage'
                ? 'chat.storageFull'
                : errorReason === 'receive'
                ? 'chat.receiveFull'
                : 'chat.loadFailed'
            )}{' '}
            · {t('common.retry')}
          </button>
        )}
        {!ready ? (
          <div className="px-4 space-y-5" aria-label={t('common.loading')}>
            {[1, 2, 3].map((n) => (
              <div
                key={n}
                className="h-16 bg-foreground/5 rounded-card animate-pulse motion-reduce:animate-none"
              />
            ))}
          </div>
        ) : filtered.length === 0 ? (
          <div className="px-8 py-16 text-center">
            <MessageCircle className="mx-auto mb-5 text-brand" size={36} />
            <h2 className="text-lg font-semibold">
              {t(
                query || filter !== 'all'
                  ? 'chat.noResults'
                  : 'chat.emptyTitle'
              )}
            </h2>
            <button
              className="mt-6 px-5 py-3 bg-brand text-white rounded-full font-semibold"
              onClick={() => setCompose(true)}
            >
              {t('chat.newChat')}
            </button>
          </div>
        ) : (
          filtered.map((c) => (
            <ChatRow
              key={c.id}
              conversation={c}
              name={name(c)}
              onOpen={() => {
                select(c.id)
                onOpen()
              }}
              onDelete={() => {
                setDestructiveAction('delete')
                setDestructiveTarget(c)
              }}
              onMenu={() => setTarget(c)}
            />
          ))
        )}
        {conversations.some((c) => c.blocked) && (
          <details className="m-4 text-caption">
            <summary className="py-3">{t('chat.blockedContacts')}</summary>
            {conversations
              .filter((c) => c.blocked)
              .map((c) => (
                <button
                  key={c.id}
                  className="flex w-full justify-between py-3"
                  onClick={() => run(chat.update(c.id, { blocked: false }))}
                >
                  <span>{name(c)}</span>
                  <span>{t('chat.unblock')}</span>
                </button>
              ))}
          </details>
        )}
      </div>
      <Modal
        isOpen={compose && !scanner && isTop}
        viewportRef={composeViewport}
        contentClassName="flex min-h-0 flex-col overflow-hidden px-5 py-4"
        onClose={() => setCompose(false)}
        title={t('chat.newChat')}
      >
        <form
          onSubmit={(e) => {
            e.preventDefault()
            void start(address)
          }}
          className="shrink-0 space-y-4"
        >
          <div className="flex items-center rounded-card border border-border focus-within:ring-2 focus-within:ring-brand">
            <input
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              aria-label={t('contacts.address')}
              placeholder="npub1… / nprofile1…"
              className="min-w-0 flex-1 bg-transparent p-3 text-base outline-none"
            />
            <button
              type="button"
              aria-label={t('scanner.title')}
              className="size-11 shrink-0 flex items-center justify-center"
              onClick={() => setScanner(true)}
            >
              <CameraFilled />
            </button>
          </div>
          <button
            disabled={busy || !address.trim()}
            className="w-full rounded-card bg-brand text-white py-3 disabled:opacity-40"
          >
            {t('chat.start')}
          </button>
        </form>
        <div
          className="mt-4 min-h-0 max-h-64 overflow-y-auto overscroll-contain"
          aria-label={t('contacts.title')}
        >
          {contacts
            .filter((c) => contactPubkey(c.address))
            .map((c) => (
              <button
                key={c.id}
                disabled={busy}
                className="flex w-full items-center gap-3 py-3"
                onClick={() => void start(c.address)}
              >
                <ChatAvatar name={c.name} />
                <span>{c.name}</span>
              </button>
            ))}
        </div>
      </Modal>
      <Modal
        isOpen={showAddress && isTop}
        onClose={() => setShowAddress(false)}
        title={t('chat.myAddress')}
      >
        {ownAddress && (
          <div className="space-y-4 py-3">
            <div className="flex justify-center">
              <QRCodeDisplay value={`nostr:${ownAddress}`} />
            </div>
            <p className="break-all text-center text-caption text-foreground-muted">
              {ownAddress}
            </p>
            <div className="flex gap-3">
              <button
                className="flex-1 rounded-full bg-brand/10 py-3 text-brand"
                onClick={() => void copy(ownAddress)}
              >
                {t(isCopied() ? 'common.copied' : 'common.copy')}
              </button>
              <button
                className="flex-1 rounded-full bg-brand py-3 text-white"
                onClick={() => void share(`nostr:${ownAddress}`)}
              >
                {t(isShared() ? 'toast.shared' : 'receive.qr.share')}
              </button>
            </div>
          </div>
        )}
      </Modal>
      <Modal
        isOpen={!!target && isTop}
        onClose={() => setTarget(null)}
        title={target ? name(target) : ''}
      >
        {target && (
          <div className="flex flex-col">
            {(
              [
                [
                  target.pinned ? 'unpin' : 'pin',
                  () => chat.update(target.id, { pinned: !target.pinned }),
                ],
                [
                  target.muted ? 'unmute' : 'mute',
                  () => chat.update(target.id, { muted: !target.muted }),
                ],
              ] as const
            ).map(([key, action]) => (
              <button
                key={key}
                className="text-left py-4"
                onClick={() => {
                  run(action())
                  setTarget(null)
                }}
              >
                {t(`chat.${key}`)}
              </button>
            ))}
            {conversationCapabilities(target).blocking && (
              <button
                className="text-left py-4"
                onClick={() => {
                  setDestructiveAction('block')
                  setDestructiveTarget(target)
                  setTarget(null)
                }}
              >
                {t('chat.block')}
              </button>
            )}
            {conversationCapabilities(target).deletion && (
              <button
                className="text-left py-4 text-accent-danger"
                onClick={() => {
                  setDestructiveAction('delete')
                  setDestructiveTarget(target)
                  setTarget(null)
                }}
              >
                {t('common.delete')}
              </button>
            )}
          </div>
        )}
      </Modal>
      <QrScannerModal
        isOpen={scanner && isTop}
        onClose={() => setScanner(false)}
        onScan={(value) => {
          setScanner(false)
          const scanned = value.trim().replace(/^nostr:/i, '')
          if (contactPubkey(scanned)) setAddress(scanned)
          else
            useAppStore
              .getState()
              .addToast({ type: 'error', message: t('chat.invalidAddress') })
        }}
      />
      <ConfirmDialog
        isOpen={!!destructiveTarget && isTop}
        onClose={() => {
          if (!destructiveBusy) setDestructiveTarget(null)
        }}
        loading={destructiveBusy}
        onConfirm={async () => {
          if (!destructiveTarget || destructiveBusy) return
          setDestructiveBusy(true)
          try {
            if (destructiveAction === 'delete')
              await chat.delete(destructiveTarget.id)
            else await chat.update(destructiveTarget.id, { blocked: true })
            setDestructiveTarget(null)
          } catch {
            useAppStore
              .getState()
              .addToast({ type: 'error', message: t('chat.saveFailed') })
          } finally {
            setDestructiveBusy(false)
          }
        }}
        title={t(
          destructiveAction === 'delete' ? 'chat.deleteTitle' : 'chat.block'
        )}
        description={t(
          destructiveAction === 'delete'
            ? 'chat.deleteDescription'
            : 'chat.blockDescription'
        )}
        confirmLabel={t(
          destructiveAction === 'delete' ? 'common.delete' : 'chat.block'
        )}
        cancelLabel={t('common.cancel')}
      />
    </div>
  )
}

function ChatRow({
  conversation: c,
  name,
  onOpen,
  onDelete,
  onMenu,
}: {
  conversation: Conversation
  name: string
  onOpen: () => void
  onDelete: () => void
  onMenu: () => void
}) {
  const { t, i18n } = useTranslation()
  const reduced = useReducedMotion()
  const controls = useAnimationControls()
  const settle = (open: boolean) => {
    setRevealed(open)
    void controls.start({
      x: open ? -80 : 0,
      transition: reduced
        ? { duration: 0 }
        : { type: 'spring', stiffness: 450, damping: 38 },
    })
  }
  const [revealed, setRevealed] = useState(false)
  const dragged = useRef(false)
  return (
    <div className="relative overflow-hidden border-b border-border/40">
      {conversationCapabilities(c).deletion && (
        <button
          onClick={onDelete}
          aria-label={t('common.delete')}
          tabIndex={revealed ? 0 : -1}
          aria-hidden={!revealed}
          className="absolute inset-y-0 right-0 w-20 bg-accent-danger text-white flex items-center justify-center"
        >
          <Trash2 size={21} />
        </button>
      )}
      <motion.div
        drag={conversationCapabilities(c).deletion ? 'x' : false}
        dragConstraints={{ left: -80, right: 0 }}
        dragElastic={0.05}
        dragMomentum={false}
        onDragStart={() => {
          dragged.current = true
        }}
        onDragEnd={(_, info) => {
          settle(info.offset.x < -35 || info.velocity.x < -250)
          setTimeout(() => {
            dragged.current = false
          }, 0)
        }}
        animate={controls}
        transition={
          reduced
            ? { duration: 0 }
            : { type: 'spring', stiffness: 450, damping: 38 }
        }
        style={{ touchAction: 'pan-y' }}
        className="relative flex items-center bg-background-card"
      >
        <button
          className="flex flex-1 min-w-0 items-center gap-3 px-4 py-4 text-left"
          onClick={() => {
            if (dragged.current) return
            if (revealed) settle(false)
            else onOpen()
          }}
        >
          <ChatAvatar name={name} />
          <span className="flex-1 min-w-0">
            <span className="flex justify-between gap-2">
              <span className="font-semibold truncate">{name}</span>
              <time className="text-[11px] text-foreground-muted shrink-0">
                {c.updatedAt > 0
                  ? new Date(c.updatedAt).toLocaleDateString(i18n.language, {
                      month: 'short',
                      day: 'numeric',
                    })
                  : ''}
              </time>
            </span>
            <span className="flex items-center justify-between mt-1 gap-2">
              <span className="text-caption truncate text-foreground-muted">
                {c.draft
                  ? `${t('chat.draft')}: ${c.draft}`
                  : parseChatPaymentNotice(c.preview)
                  ? t('chat.paymentCard.noticeTitle')
                  : chatPaymentRequestType(c.preview)
                  ? t('chat.paymentRequest')
                  : c.preview || t('chat.sayHello')}
              </span>
              {c.unread > 0 && (
                <span className="bg-brand text-white min-w-5 px-1.5 rounded-full text-[11px] text-center">
                  {unreadBadge(c.unread)}
                </span>
              )}
            </span>
          </span>
        </button>
        <button
          className="w-11 min-h-12 flex flex-col items-center gap-1 shrink-0"
          aria-label={t('chat.actions')}
          onClick={onMenu}
        >
          {c.pinned && <Pin size={13} />}
          {c.muted && <BellOff size={13} />}
          <MoreHorizontal size={19} />
        </button>
      </motion.div>
    </div>
  )
}
