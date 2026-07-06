import type { TranslationKey } from '@/i18n'
import type { TFunction } from 'i18next'
import { useEffect, useMemo, useRef, useState } from 'react'
import { motion, AnimatePresence } from 'motion/react'
import {
  ChevronDown,
  ChevronRight,
  Inbox,
  Lightbulb,
  MessageSquare,
  Sparkles,
  Trash2,
} from 'lucide-react'
import { useTranslation } from 'react-i18next'
import {
  DEFAULT_IDEA_CATEGORY,
  DEFAULT_SUPPORT_CATEGORY,
  DEFAULT_SUPPORT_PRIORITY,
  countUnreadSupportReplies,
  getLatestSupportMessageAt,
  getSupportKind,
  isIdeaCategory,
  isSupportTicketTerminal,
  type SupportAttachment,
  type SupportAttachmentUpload,
  type SupportCategory,
  type SupportIdeaCategory,
  type SupportInquiryCategory,
  type SupportKind,
  type SupportMessage,
  type SupportPriority,
  type SupportSnapshot,
  type SupportStatusEvent,
  type SupportTicket,
  type SupportTicketStatus,
} from '@/core/domain/support'
import { useSupport } from '@/ui/hooks/use-support'
import { useAppStore } from '@/store'
import { ConfirmDialog } from '@/ui/components/common/ConfirmDialog'
import { cn } from '@/ui/lib/utils'
import {
  CSActionRow,
  CSAttachmentDropzone,
  CSAttachmentPreview,
  type CSAttachmentPreviewData,
  CSCard,
  CSCategoryChip,
  CSCategoryPills,
  type CSCategoryOption,
  CSChatBubble,
  CSChatInput,
  CSFAB,
  CSPage,
  CSSecurityNotice,
  CSStatusChip,
  ticketStatusToCSKind,
} from './components/cs'

interface SupportPageProps {
  onBack: () => void
}

type SupportView =
  | 'home'
  | 'faq'
  | 'inquiry-list'
  | 'idea-list'
  | 'compose-inquiry'
  | 'compose-idea'
  | 'ticket-detail'

const FAQ_COUNT = 6
const FAQ_HOME_PREVIEW = 4

const INQUIRY_CATEGORY_OPTIONS: Array<{ value: SupportInquiryCategory; labelKey: TranslationKey }> = [
  { value: 'transfer', labelKey: 'support.categories.transfer' },
  { value: 'ecash', labelKey: 'support.categories.ecash' },
  { value: 'fee', labelKey: 'support.categories.fee' },
  { value: 'security', labelKey: 'support.categories.security' },
  { value: 'other', labelKey: 'support.categories.other' },
]

const IDEA_CATEGORY_OPTIONS: Array<{ value: SupportIdeaCategory; labelKey: TranslationKey }> = [
  { value: 'idea_ux', labelKey: 'support.categories.idea_ux' },
  { value: 'idea_feature', labelKey: 'support.categories.idea_feature' },
  { value: 'idea_perf', labelKey: 'support.categories.idea_perf' },
  { value: 'idea_other', labelKey: 'support.categories.idea_other' },
]

export function SupportPage({ onBack }: SupportPageProps) {
  const { t } = useTranslation()
  const support = useSupport()
  const addToast = useAppStore((state) => state.addToast)
  const setActiveSupportTicketId = useAppStore((state) => state.setActiveSupportTicketId)

  const [snapshot, setSnapshot] = useState<SupportSnapshot>(() => support.getSnapshot())

  // Navigation stack: home (base) → level1 overlay → level2 overlay
  const [level1, setLevel1] = useState<
    'faq' | 'inquiry-list' | 'idea-list' | 'compose-inquiry' | 'compose-idea' | null
  >(null)
  const [level2, setLevel2] = useState<
    'ticket-detail' | 'compose-inquiry' | 'compose-idea' | null
  >(null)

  const [faqInitialIndex, setFaqInitialIndex] = useState<number | null>(null)
  const [selectedTicketId, setSelectedTicketId] = useState<string | null>(null)
  const [archiveTarget, setArchiveTarget] = useState<SupportTicket | null>(null)

  const [category, setCategory] = useState<SupportCategory>(DEFAULT_SUPPORT_CATEGORY)
  const [priority] = useState<SupportPriority>(DEFAULT_SUPPORT_PRIORITY)
  const [title, setTitle] = useState('')
  const [body, setBody] = useState('')
  const [composeFiles, setComposeFiles] = useState<File[]>([])

  const [replyBody, setReplyBody] = useState('')
  const [replyFiles, setReplyFiles] = useState<File[]>([])
  const [openingAttachmentIds, setOpeningAttachmentIds] = useState<Set<string>>(
    () => new Set(),
  )
  const [previewAttachment, setPreviewAttachment] = useState<CSAttachmentPreviewData | null>(null)
  const [isPreviewLoading, setIsPreviewLoading] = useState(false)

  type ImageCacheEntry =
    | { state: 'pending' }
    | { state: 'ready'; url: string; data: Uint8Array; mime: string; name?: string }
    | { state: 'failed' }
  const [imageCache, setImageCache] = useState<Map<string, ImageCacheEntry>>(() => new Map())
  const imageCacheRef = useRef(imageCache)
  imageCacheRef.current = imageCache

  const [isCreating, setIsCreating] = useState(false)
  const [isSendingReply, setIsSendingReply] = useState(false)
  const [isArchiving, setIsArchiving] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)

  useEffect(() => {
    const unsubscribe = support.subscribe(setSnapshot)
    support.connect().then(setSnapshot).catch(() => {
      setFormError(t('support.connectionFailed'))
    })
    return () => {
      unsubscribe()
    }
  }, [support, t])

  // 포그라운드 복귀 재동기화는 전역 훅(use-support-notifications)의 onWake
  // 구독이 담당한다 (설계 §10 B7 — 페이지 자체 visibility/focus 리스너와의
  // 이중 refresh 제거). 이 화면은 support.subscribe 스냅샷으로 갱신을 받는다.

  useEffect(() => {
    return () => {
      setActiveSupportTicketId(null)
    }
  }, [setActiveSupportTicketId])

  useEffect(() => {
    if (!selectedTicketId) return
    if (snapshot.tickets.some((ticket) => ticket.id === selectedTicketId)) return
    setSelectedTicketId(null)
    setLevel2(null)
  }, [selectedTicketId, snapshot.tickets])

  const selectedTicket = useMemo(
    () => snapshot.tickets.find((ticket) => ticket.id === selectedTicketId) ?? null,
    [selectedTicketId, snapshot.tickets],
  )

  const selectedMessages = useMemo(
    () => getConversationMessages(selectedTicket, snapshot.messages),
    [selectedTicket, snapshot.messages],
  )

  const selectedStatusEvents = useMemo(
    () => (selectedTicket ? snapshot.statusEvents[selectedTicket.id] ?? [] : []),
    [selectedTicket, snapshot.statusEvents],
  )

  const selectedTimeline = useMemo(
    () => buildConversationTimeline(selectedMessages, selectedStatusEvents),
    [selectedMessages, selectedStatusEvents],
  )

  const selectedLatestSupportMessageAt = useMemo(
    () => getLatestSupportMessageAt(selectedMessages),
    [selectedMessages],
  )

  const selectedKind: SupportKind = selectedTicket
    ? getSupportKind(selectedTicket.category)
    : 'inquiry'

  // Derived active view — level2 wins, then level1, then home
  const activeView: SupportView = level2 ?? level1 ?? 'home'

  useEffect(() => {
    if (activeView !== 'ticket-detail' || !selectedTicket) return
    if (selectedLatestSupportMessageAt <= (selectedTicket.readAt ?? 0)) return
    support.markTicketRead(selectedTicket.id).catch(() => undefined)
  }, [activeView, selectedLatestSupportMessageAt, selectedTicket, support])

  useEffect(() => {
    setActiveSupportTicketId(
      activeView === 'ticket-detail' && selectedTicket ? selectedTicket.id : null,
    )
  }, [activeView, selectedTicket, setActiveSupportTicketId])

  const inquiryTickets = useMemo(
    () => snapshot.tickets.filter((ticket) => !isIdeaCategory(ticket.category)),
    [snapshot.tickets],
  )
  const ideaTickets = useMemo(
    () => snapshot.tickets.filter((ticket) => isIdeaCategory(ticket.category)),
    [snapshot.tickets],
  )
  const inquiryActiveCount = useMemo(
    () => inquiryTickets.filter((ticket) => !isSupportTicketTerminal(ticket.status)).length,
    [inquiryTickets],
  )

  const inquiryUnread = useMemo(() => {
    return inquiryTickets.reduce(
      (sum, ticket) => sum + countUnreadSupportReplies(ticket, snapshot.messages[ticket.id] ?? []),
      0,
    )
  }, [inquiryTickets, snapshot.messages])

  const resetComposer = (kind: SupportKind) => {
    setCategory(kind === 'idea' ? DEFAULT_IDEA_CATEGORY : DEFAULT_SUPPORT_CATEGORY)
    setTitle('')
    setBody('')
    setComposeFiles([])
  }

  // Back from level2 → level1 still visible
  const handleBackFromLevel2 = () => {
    setFormError(null)
    if (level2 === 'ticket-detail') {
      setReplyBody('')
      setReplyFiles([])
      setSelectedTicketId(null)
    } else if (level2 === 'compose-inquiry' || level2 === 'compose-idea') {
      resetComposer(level2 === 'compose-idea' ? 'idea' : 'inquiry')
    }
    setLevel2(null)
  }

  // Back from level1 → home
  const handleBackFromLevel1 = () => {
    setFormError(null)
    if (level1 === 'compose-inquiry' || level1 === 'compose-idea') {
      resetComposer(level1 === 'compose-idea' ? 'idea' : 'inquiry')
    } else if (level1 === 'faq') {
      setFaqInitialIndex(null)
    }
    setLevel1(null)
  }

  const openTicket = (ticketId: string) => {
    setFormError(null)
    setSelectedTicketId(ticketId)
    setLevel2('ticket-detail')
  }

  // Compose opened from home → level1. From list → level2.
  const openComposeAtLevel1 = (kind: SupportKind) => {
    if (!snapshot.availability.available) return
    setFormError(null)
    resetComposer(kind)
    setLevel1(kind === 'idea' ? 'compose-idea' : 'compose-inquiry')
  }

  const openComposeAtLevel2 = (kind: SupportKind) => {
    if (!snapshot.availability.available) return
    setFormError(null)
    resetComposer(kind)
    setLevel2(kind === 'idea' ? 'compose-idea' : 'compose-inquiry')
  }

  const composerKind: SupportKind = activeView === 'compose-idea' ? 'idea' : 'inquiry'

  const handleCreateTicket = async () => {
    if (!title.trim() || !body.trim() || isCreating) return
    setIsCreating(true)
    setFormError(null)
    try {
      const ticket = await support.createTicket({
        title: title.trim(),
        body: body.trim(),
        category,
        priority,
        attachments: await filesToSupportAttachments(composeFiles),
      })
      resetComposer(composerKind)
      setSelectedTicketId(ticket.id)
      if (level2 !== null) {
        // Compose was at level2 (from list) → replace level2 with ticket-detail
        setLevel2('ticket-detail')
      } else {
        // Compose was at level1 (from home) → set list at level1, ticket at level2
        setLevel1(composerKind === 'idea' ? 'idea-list' : 'inquiry-list')
        setLevel2('ticket-detail')
      }
    } catch {
      setFormError(t('support.createFailed'))
    } finally {
      setIsCreating(false)
    }
  }

  const handleSendReply = async () => {
    if (!selectedTicket) return
    if ((!replyBody.trim() && replyFiles.length === 0) || isSendingReply) return
    setIsSendingReply(true)
    setFormError(null)
    try {
      await support.sendMessage({
        ticketId: selectedTicket.id,
        body: replyBody.trim(),
        attachments: await filesToSupportAttachments(replyFiles),
      })
      setReplyBody('')
      setReplyFiles([])
    } catch {
      setFormError(t('support.sendFailed'))
    } finally {
      setIsSendingReply(false)
    }
  }

  const handleOpenAttachment = async (attachment: SupportAttachment) => {
    if (attachment.state !== 'available') return

    const cached = imageCacheRef.current.get(attachment.id)
    if (cached?.state === 'ready') {
      setPreviewAttachment({ data: cached.data, mime: cached.mime, name: cached.name })
      return
    }

    if (openingAttachmentIds.has(attachment.id)) return
    setOpeningAttachmentIds((current) => new Set(current).add(attachment.id))
    setIsPreviewLoading(true)
    setFormError(null)
    try {
      const downloaded = await support.downloadAttachment({ attachmentId: attachment.id })
      setPreviewAttachment({
        data: downloaded.data,
        mime: downloaded.mime,
        name: downloaded.name ?? attachment.name,
      })
    } catch {
      setFormError(t('support.previewFailed'))
    } finally {
      setIsPreviewLoading(false)
      setOpeningAttachmentIds((current) => {
        const next = new Set(current)
        next.delete(attachment.id)
        return next
      })
    }
  }

  // Auto-decrypt image attachments when viewing a thread.
  useEffect(() => {
    if (activeView !== 'ticket-detail') return
    const targets: SupportAttachment[] = []
    for (const message of selectedMessages) {
      if (!message.attachments) continue
      for (const attachment of message.attachments) {
        if (
          attachment.mime.startsWith('image/') &&
          attachment.state === 'available' &&
          !imageCacheRef.current.has(attachment.id)
        ) {
          targets.push(attachment)
        }
      }
    }
    if (targets.length === 0) return

    setImageCache((prev) => {
      const next = new Map(prev)
      for (const a of targets) next.set(a.id, { state: 'pending' })
      return next
    })

    let cancelled = false
    for (const attachment of targets) {
      void (async () => {
        try {
          const downloaded = await support.downloadAttachment({ attachmentId: attachment.id })
          if (cancelled) return
          const arrayBuffer = downloaded.data.buffer.slice(
            downloaded.data.byteOffset,
            downloaded.data.byteOffset + downloaded.data.byteLength,
          ) as ArrayBuffer
          const blob = new Blob([arrayBuffer], { type: downloaded.mime })
          const url = URL.createObjectURL(blob)
          setImageCache((prev) => {
            if (cancelled) {
              URL.revokeObjectURL(url)
              return prev
            }
            const existing = prev.get(attachment.id)
            if (existing && existing.state === 'ready') {
              URL.revokeObjectURL(url)
              return prev
            }
            const next = new Map(prev)
            next.set(attachment.id, {
              state: 'ready',
              url,
              data: downloaded.data,
              mime: downloaded.mime,
              name: downloaded.name ?? attachment.name,
            })
            return next
          })
        } catch {
          if (cancelled) return
          setImageCache((prev) => {
            const next = new Map(prev)
            next.set(attachment.id, { state: 'failed' })
            return next
          })
        }
      })()
    }
    return () => {
      cancelled = true
    }
  }, [activeView, selectedMessages, support])

  // Revoke all object URLs on unmount.
  useEffect(() => {
    return () => {
      for (const entry of imageCacheRef.current.values()) {
        if (entry.state === 'ready') URL.revokeObjectURL(entry.url)
      }
    }
  }, [])

  const imageUrls = useMemo(() => {
    const map = new Map<string, string>()
    for (const [id, entry] of imageCache) {
      if (entry.state === 'ready') map.set(id, entry.url)
    }
    return map
  }, [imageCache])

  const failedImageIds = useMemo(() => {
    const set = new Set<string>()
    for (const [id, entry] of imageCache) {
      if (entry.state === 'failed') set.add(id)
    }
    return set
  }, [imageCache])

  const handleDownloadFromPreview = (attachment: CSAttachmentPreviewData) => {
    saveDownloadedAttachment(attachment.data, attachment.mime, attachment.name)
  }

  const handleClosePreview = () => {
    setPreviewAttachment(null)
  }

  const handleArchiveTicket = async () => {
    if (!archiveTarget || isArchiving) return
    setIsArchiving(true)
    setFormError(null)
    try {
      await support.archiveTicket(archiveTarget.id)
      addToast({ type: 'success', message: t('support.deleted'), duration: 2500 })
      setArchiveTarget(null)
      setSelectedTicketId(null)
      setLevel2(null) // level1 (list) remains visible
    } catch {
      setFormError(t('support.deleteFailed'))
    } finally {
      setIsArchiving(false)
    }
  }

  const unavailable = !snapshot.availability.available
  const connectionError = snapshot.status === 'error'
  const noticeBanner =
    unavailable
      ? { title: t('support.unavailableTitle'), description: t('support.unavailableDescription'), tone: 'default' as const }
      : connectionError
        ? { title: t('support.connectionFailed'), description: snapshot.error ?? t('support.tryAgainLater'), tone: 'danger' as const }
        : formError
          ? { title: formError, description: t('support.tryAgainLater'), tone: 'danger' as const }
          : null

  // Per-layer header info
  const level1HeaderInfo = level1 !== null
    ? getHeaderInfo(level1, t, null, () => {})
    : null

  const level2HeaderInfo = level2 !== null
    ? getHeaderInfo(
        level2,
        t,
        level2 === 'ticket-detail' ? selectedTicket : null,
        () => { if (selectedTicket) setArchiveTarget(selectedTicket) },
      )
    : null

  // Per-layer footers
  const level1FooterNode = level1 !== null
    ? renderFooter({
        view: level1,
        title, body, isCreating,
        onSubmit: handleCreateTicket,
        submitLabel: t(level1 === 'compose-idea' ? 'support.submitIdea' : 'support.submitInquiry'),
        selectedTicket: null, selectedKind: 'inquiry',
        replyBody: '', replyFiles: [],
        onReplyBodyChange: () => {}, onReplyFilesChange: () => {}, onSendReply: () => {},
        isSendingReply: false,
        capabilities: snapshot.capabilities.attachments,
        onAttachmentError: setFormError,
        placeholder: '', t,
      })
    : null

  const level2FooterNode = level2 !== null
    ? renderFooter({
        view: level2,
        title, body, isCreating,
        onSubmit: handleCreateTicket,
        submitLabel: t(level2 === 'compose-idea' ? 'support.submitIdea' : 'support.submitInquiry'),
        selectedTicket, selectedKind,
        replyBody, replyFiles,
        onReplyBodyChange: setReplyBody, onReplyFilesChange: setReplyFiles,
        onSendReply: handleSendReply, isSendingReply,
        capabilities: snapshot.capabilities.attachments,
        onAttachmentError: setFormError,
        placeholder: t(selectedKind === 'idea' ? 'support.ideaReplyPlaceholder' : 'support.replyPlaceholder'),
        t,
      })
    : null

  const iosTransition = { type: 'tween', ease: [0.32, 0.72, 0, 1], duration: 0.35 } as const

  return (
    <>
      {/* ── Layer 0: Home (base, always rendered) ────────────────────── */}
      <CSPage
        title={t('support.heroTitle')}
        subtitle={t('support.helpHomeSubtitle')}
        onBack={onBack}
      >
        {level1 === null && noticeBanner && (
          <div className="px-5 mb-3"><NoticeBanner {...noticeBanner} /></div>
        )}
        <HelpHomeView
          inquiryCount={inquiryActiveCount}
          inquiryUnread={inquiryUnread}
          ideaCount={ideaTickets.length}
          onComposeInquiry={() => openComposeAtLevel1('inquiry')}
          onOpenInquiryList={() => setLevel1('inquiry-list')}
          onComposeIdea={() => openComposeAtLevel1('idea')}
          onOpenIdeaList={() => setLevel1('idea-list')}
          onFaqItemClick={(index) => { setFaqInitialIndex(index); setLevel1('faq') }}
          onSeeAllFaq={() => { setFaqInitialIndex(null); setLevel1('faq') }}
          disabled={unavailable}
        />
      </CSPage>

      {/* ── Layer 1: First push (FAQ / lists / compose from home) ─────── */}
      <AnimatePresence>
        {level1 !== null && (
          <motion.div
            key={level1}
            className="fixed inset-0 z-[66] bg-background"
            initial={{ x: '100%' }}
            animate={{ x: 0 }}
            exit={{ x: '100%' }}
            transition={iosTransition}
          >
            <CSPage
              title={level1HeaderInfo!.title}
              subtitle={level1HeaderInfo!.subtitle}
              onBack={handleBackFromLevel1}
              right={level1HeaderInfo!.right}
              meta={level1HeaderInfo!.meta}
              footer={level1FooterNode}
            >
              {level2 === null && noticeBanner && (
                <div className="px-5 mb-3"><NoticeBanner {...noticeBanner} /></div>
              )}

              {level1 === 'faq' && (
                <FaqView initialExpandedIndex={faqInitialIndex} />
              )}
              {level1 === 'inquiry-list' && (
                <TicketListView
                  kind="inquiry"
                  tickets={inquiryTickets}
                  messagesByTicket={snapshot.messages}
                  onSelect={openTicket}
                  onCompose={() => openComposeAtLevel2('inquiry')}
                  disabled={unavailable}
                />
              )}
              {level1 === 'idea-list' && (
                <TicketListView
                  kind="idea"
                  tickets={ideaTickets}
                  messagesByTicket={snapshot.messages}
                  onSelect={openTicket}
                  onCompose={() => openComposeAtLevel2('idea')}
                  disabled={unavailable}
                />
              )}
              {(level1 === 'compose-inquiry' || level1 === 'compose-idea') && (
                <ComposeView
                  kind={level1 === 'compose-idea' ? 'idea' : 'inquiry'}
                  title={title} body={body} category={category} files={composeFiles}
                  capabilities={snapshot.capabilities.attachments}
                  isSubmitting={isCreating}
                  onTitleChange={setTitle} onBodyChange={setBody}
                  onCategoryChange={setCategory} onFilesChange={setComposeFiles}
                  onAttachmentError={setFormError}
                />
              )}
            </CSPage>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── Layer 2: Second push (ticket-detail / compose from list) ──── */}
      <AnimatePresence>
        {level2 !== null && (
          <motion.div
            key={level2 === 'ticket-detail' ? `ticket-${selectedTicketId}` : level2}
            className="fixed inset-0 z-[67] bg-background"
            initial={{ x: '100%' }}
            animate={{ x: 0 }}
            exit={{ x: '100%' }}
            transition={iosTransition}
          >
            <CSPage
              title={level2HeaderInfo!.title}
              subtitle={level2HeaderInfo!.subtitle}
              onBack={handleBackFromLevel2}
              right={level2HeaderInfo!.right}
              meta={level2HeaderInfo!.meta}
              footer={level2FooterNode}
            >
              {noticeBanner && (
                <div className="px-5 mb-3"><NoticeBanner {...noticeBanner} /></div>
              )}

              {level2 === 'ticket-detail' && selectedTicket && (
                <ConversationView
                  kind={selectedKind}
                  timeline={selectedTimeline}
                  ticketTerminal={isSupportTicketTerminal(selectedTicket.status)}
                  openingIds={openingAttachmentIds}
                  imageUrls={imageUrls}
                  failedImageIds={failedImageIds}
                  onOpenAttachment={handleOpenAttachment}
                />
              )}
              {(level2 === 'compose-inquiry' || level2 === 'compose-idea') && (
                <ComposeView
                  kind={level2 === 'compose-idea' ? 'idea' : 'inquiry'}
                  title={title} body={body} category={category} files={composeFiles}
                  capabilities={snapshot.capabilities.attachments}
                  isSubmitting={isCreating}
                  onTitleChange={setTitle} onBodyChange={setBody}
                  onCategoryChange={setCategory} onFilesChange={setComposeFiles}
                  onAttachmentError={setFormError}
                />
              )}
            </CSPage>
          </motion.div>
        )}
      </AnimatePresence>

      <CSAttachmentPreview
        attachment={previewAttachment}
        loading={isPreviewLoading && !previewAttachment}
        onClose={handleClosePreview}
        onDownload={handleDownloadFromPreview}
      />

      <ConfirmDialog
        isOpen={archiveTarget !== null}
        onClose={() => {
          if (!isArchiving) setArchiveTarget(null)
        }}
        onConfirm={handleArchiveTicket}
        title={t('support.deleteTitle')}
        icon={<Trash2 className="w-6 h-6" strokeWidth={1.8} />}
        confirmLabel={t('support.leaveTicket')}
        cancelLabel={t('common.cancel')}
        loading={isArchiving}
      />
    </>
  )
}

// ──────────────────────────────────────────────────────────────────────────────
// Help Home

interface HelpHomeViewProps {
  inquiryCount: number
  inquiryUnread: number
  ideaCount: number
  onComposeInquiry: () => void
  onOpenInquiryList: () => void
  onComposeIdea: () => void
  onOpenIdeaList: () => void
  onFaqItemClick: (index: number) => void
  onSeeAllFaq: () => void
  disabled?: boolean
}

function HelpHomeView({
  inquiryCount,
  inquiryUnread,
  ideaCount,
  onComposeInquiry,
  onOpenInquiryList,
  onComposeIdea,
  onOpenIdeaList,
  onFaqItemClick,
  onSeeAllFaq,
  disabled,
}: HelpHomeViewProps) {
  const { t } = useTranslation()
  const faqQuestions = Array.from({ length: FAQ_HOME_PREVIEW }, (_, i) =>
    t(`support.faq.q${i + 1}` as TranslationKey),
  )
  const inquiryListSubtitle =
    inquiryUnread > 0
      ? t('support.actions.inquiryList.subtitleWithUnread', {
          count: inquiryCount,
          unread: inquiryUnread,
        })
      : t('support.actions.inquiryList.subtitle', { count: inquiryCount })

  const ideaListSubtitle = ideaCount > 0
    ? t('support.actions.ideaList.subtitle', { count: ideaCount })
    : t('support.actions.ideaList.empty')

  return (
    <div className="pb-8">
      <div className="px-5 mb-4">
        <div className="flex items-center justify-between mb-2.5">
          <span className="text-[13px] font-semibold text-foreground-muted tracking-[-0.005em]">
            {t('support.faqTitle')}
          </span>
          <button
            type="button"
            onClick={onSeeAllFaq}
            className="text-[12px] font-medium text-foreground-subtle"
          >
            {t('support.faqSeeAll')} →
          </button>
        </div>
        <CSCard padding="none">
          {faqQuestions.map((question, index) => (
            <button
              type="button"
              key={index}
              onClick={() => onFaqItemClick(index)}
              className={cn(
                'w-full flex items-center justify-between px-4 py-3.5 text-left',
                index !== 0 && 'border-t border-border/60',
              )}
            >
              <span className="text-[14px] text-foreground tracking-[-0.005em]">{question}</span>
              <ChevronRight className="w-4 h-4 text-foreground-subtle shrink-0" strokeWidth={2} />
            </button>
          ))}
        </CSCard>
      </div>

      <div className="px-5 flex flex-col gap-2.5">
        <CSActionRow
          icon={<MessageSquare className="w-[22px] h-[22px] text-brand-900" strokeWidth={1.7} />}
          accent="brand"
          title={t('support.actions.composeInquiry.title')}
          subtitle={t('support.actions.composeInquiry.subtitle')}
          onClick={onComposeInquiry}
          disabled={disabled}
        />
        <CSActionRow
          icon={<Inbox className="w-[22px] h-[22px] text-brand-900" strokeWidth={1.7} />}
          accent="brand"
          title={t('support.actions.inquiryList.title')}
          subtitle={inquiryListSubtitle}
          badge={inquiryUnread > 0 ? (inquiryUnread > 99 ? '99+' : inquiryUnread) : undefined}
          onClick={onOpenInquiryList}
        />
        <div className="h-1.5" />
        <CSActionRow
          icon={<Lightbulb className="w-[22px] h-[22px] text-[#9A6B00]" strokeWidth={1.7} />}
          accent="pending"
          title={t('support.actions.composeIdea.title')}
          subtitle={t('support.actions.composeIdea.subtitle')}
          onClick={onComposeIdea}
          disabled={disabled}
        />
        <CSActionRow
          icon={<Sparkles className="w-[22px] h-[22px] text-brand-900" strokeWidth={1.7} />}
          accent="neutral"
          title={t('support.actions.ideaList.title')}
          subtitle={ideaListSubtitle}
          onClick={onOpenIdeaList}
        />
      </div>

    </div>
  )
}

// ──────────────────────────────────────────────────────────────────────────────
// FAQ

function FaqView({ initialExpandedIndex }: { initialExpandedIndex: number | null }) {
  const { t } = useTranslation()
  const [expandedIndex, setExpandedIndex] = useState<number | null>(initialExpandedIndex)
  const itemRefs = useRef<(HTMLDivElement | null)[]>([])

  useEffect(() => {
    if (initialExpandedIndex == null) return
    const timer = setTimeout(() => {
      itemRefs.current[initialExpandedIndex]?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    }, 100)
    return () => clearTimeout(timer)
  }, [initialExpandedIndex])

  const toggle = (index: number) => {
    setExpandedIndex((prev) => {
      const next = prev === index ? null : index
      if (next !== null) {
        setTimeout(() => {
          itemRefs.current[next]?.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
        }, 50)
      }
      return next
    })
  }

  return (
    <div className="px-5 pb-8">
      <CSCard padding="none">
        {Array.from({ length: FAQ_COUNT }, (_, i) => i).map((index) => {
          const expanded = expandedIndex === index
          const n = index + 1
          return (
            <div
              key={index}
              ref={(el) => { itemRefs.current[index] = el }}
              className={cn(index !== 0 && 'border-t border-border/60')}
            >
              <button
                type="button"
                onClick={() => toggle(index)}
                className="w-full flex items-center justify-between px-4 py-3.5 text-left gap-3"
              >
                <span className="text-[14px] text-foreground tracking-[-0.005em] flex-1">
                  {t(`support.faq.q${n}` as TranslationKey)}
                </span>
                <ChevronDown
                  className={cn(
                    'w-4 h-4 text-foreground-subtle shrink-0 transition-transform duration-200',
                    expanded && 'rotate-180',
                  )}
                  strokeWidth={2}
                />
              </button>
              {expanded && (
                <div className="px-4 pb-4 text-[13px] text-foreground-muted leading-relaxed tracking-[-0.005em] whitespace-pre-line">
                  {t(`support.faq.a${n}` as TranslationKey)}
                </div>
              )}
            </div>
          )
        })}
      </CSCard>
    </div>
  )
}

// ──────────────────────────────────────────────────────────────────────────────
// Ticket list (inquiry or idea)

interface TicketListViewProps {
  kind: SupportKind
  tickets: SupportTicket[]
  messagesByTicket: SupportSnapshot['messages']
  onSelect: (ticketId: string) => void
  onCompose: () => void
  disabled?: boolean
}

function TicketListView({
  kind,
  tickets,
  messagesByTicket,
  onSelect,
  onCompose,
  disabled,
}: TicketListViewProps) {
  const { t } = useTranslation()
  const isIdea = kind === 'idea'

  const subtitleKey = isIdea ? 'support.ideaListSubtitle' : 'support.inquiryListSubtitle'
  const emptyKey = isIdea ? 'support.ideaListEmpty' : 'support.inquiryListEmpty'
  const fabLabelKey = isIdea ? 'support.fabNewIdea' : 'support.fabNewInquiry'
  const noTicketsKey = isIdea ? 'support.ideaListEmpty' : 'support.noTickets'
  const subtitleCount = isIdea
    ? tickets.length
    : tickets.filter((t) => !isSupportTicketTerminal(t.status)).length

  return (
    <div className="pb-24">
      <div className="px-5 mb-3 text-[13px] text-foreground-muted tracking-[-0.005em]">
        {subtitleCount === 0
          ? t(emptyKey)
          : t(subtitleKey, { count: subtitleCount })}
      </div>

      {tickets.length === 0 ? (
        <div className="px-5">
          <CSCard className="py-8 text-center">
            <p className="text-[14px] font-semibold text-foreground">{t(noTicketsKey)}</p>
          </CSCard>
        </div>
      ) : (
        <div className="px-5 flex flex-col gap-2.5">
          {tickets.map((ticket) => (
            <TicketCard
              key={ticket.id}
              ticket={ticket}
              kind={kind}
              messages={messagesByTicket[ticket.id] ?? []}
              onClick={() => onSelect(ticket.id)}
            />
          ))}
        </div>
      )}

      {!disabled && <CSFAB label={t(fabLabelKey)} onClick={onCompose} />}
    </div>
  )
}

interface TicketCardProps {
  ticket: SupportTicket
  kind: SupportKind
  messages: SupportMessage[]
  onClick: () => void
}

function TicketCard({ ticket, kind, messages, onClick }: TicketCardProps) {
  const { t } = useTranslation()
  const unread = countUnreadSupportReplies(ticket, messages) > 0
  const isIdea = kind === 'idea'

  return (
    <CSCard onClick={onClick}>
      <div className="flex items-center justify-between">
        {isIdea ? (
          <span className="inline-flex items-center gap-1.5 text-brand">
            <Sparkles className="w-3.5 h-3.5" strokeWidth={1.7} />
            <span className="text-[11px] font-semibold tracking-[0.02em]">
              {t('support.proposalLabel')}
            </span>
          </span>
        ) : (
          <CSStatusChip kind={ticketStatusToCSKind(ticket.status)} />
        )}
        {unread && (
          <span className="text-[10px] font-bold text-brand bg-brand-50 rounded-full px-2 py-[3px] leading-none tracking-[-0.005em]">
            {t('support.unreadBadge')}
          </span>
        )}
      </div>
      <div className="text-[16px] font-semibold text-foreground mt-3 tracking-[-0.01em] truncate">
        {ticket.title}
      </div>
      <div className="flex items-center gap-2 mt-2">
        <span className="text-[12px] text-foreground-muted">
          {t(`support.categories.${ticket.category}`)}
        </span>
        <span className="w-0.5 h-0.5 rounded-full bg-foreground-subtle" />
        <span className="text-[12px] text-foreground-subtle">
          {formatTicketTime(ticket.updatedAt)}
        </span>
      </div>
    </CSCard>
  )
}

// ──────────────────────────────────────────────────────────────────────────────
// Compose (inquiry or idea)

interface ComposeViewProps {
  kind: SupportKind
  title: string
  body: string
  category: SupportCategory
  files: File[]
  capabilities: SupportSnapshot['capabilities']['attachments']
  isSubmitting: boolean
  onTitleChange: (value: string) => void
  onBodyChange: (value: string) => void
  onCategoryChange: (value: SupportCategory) => void
  onFilesChange: (value: File[]) => void
  onAttachmentError: (message: string) => void
}

function ComposeView({
  kind,
  title,
  body,
  category,
  files,
  capabilities,
  isSubmitting,
  onTitleChange,
  onBodyChange,
  onCategoryChange,
  onFilesChange,
  onAttachmentError,
}: ComposeViewProps) {
  const { t } = useTranslation()
  const isIdea = kind === 'idea'
  const optionDefs = isIdea ? IDEA_CATEGORY_OPTIONS : INQUIRY_CATEGORY_OPTIONS
  const options: CSCategoryOption<SupportCategory>[] = optionDefs.map((opt) => ({
    value: opt.value as SupportCategory,
    label: t(opt.labelKey),
  }))

  const titleLabel = isIdea ? t('support.requestTitleLabel') : t('support.requestTitleLabel')
  const bodyLabelKey = isIdea ? 'support.requestBodyLabel' : 'support.requestBodyLabel'
  const titlePlaceholder = isIdea
    ? t('support.titlePlaceholderIdea')
    : t('support.titlePlaceholderInquiry')
  const bodyPlaceholder = isIdea
    ? t('support.bodyPlaceholderIdea')
    : t('support.bodyPlaceholderInquiry')

  return (
    <div className="px-5 pb-8 flex flex-col gap-5">
      <div>
        <FieldLabel required>{titleLabel}</FieldLabel>
        <input
          value={title}
          onChange={(event) => onTitleChange(event.target.value)}
          placeholder={titlePlaceholder}
          maxLength={120}
          disabled={isSubmitting}
          className="mt-2 w-full bg-background-card border border-border rounded-[12px] px-3.5 py-3 text-[14px] text-foreground tracking-[-0.005em] placeholder:text-foreground-subtle outline-none focus:border-brand"
        />
      </div>

      <div>
        <FieldLabel required>{t('support.categoryLabel')}</FieldLabel>
        <div className="mt-2">
          <CSCategoryPills<SupportCategory>
            options={options}
            value={category}
            onChange={onCategoryChange}
            ariaLabel={t('support.categoryLabel')}
            disabled={isSubmitting}
          />
        </div>
      </div>

      <div>
        <FieldLabel required>{t(bodyLabelKey)}</FieldLabel>
        <textarea
          value={body}
          onChange={(event) => onBodyChange(event.target.value)}
          placeholder={bodyPlaceholder}
          maxLength={2000}
          disabled={isSubmitting}
          className="mt-2 w-full bg-background-card border border-border rounded-[12px] px-3.5 py-3 text-[14px] text-foreground tracking-[-0.005em] placeholder:text-foreground-subtle outline-none focus:border-brand resize-none"
          style={{ minHeight: 130, lineHeight: 1.55 }}
        />
        <p className="text-right text-[11px] text-foreground-subtle mt-1">
          {t('support.bodyCounter', { count: body.length })}
        </p>
      </div>

      {!isIdea && (
        <CSSecurityNotice
          title={t('support.securityNoticeTitle')}
          description={t('support.securityNoticeBody')}
        />
      )}

      <div>
        <FieldLabel>{t('support.attachmentLabel')}</FieldLabel>
        <div className="mt-2">
          <CSAttachmentDropzone
            files={files}
            capabilities={capabilities}
            disabled={isSubmitting}
            onChange={onFilesChange}
            onError={onAttachmentError}
          />
        </div>
      </div>

      <p className="text-center text-[11px] text-foreground-subtle tracking-[-0.005em]">
        {t('support.attachmentEncryptedNote')}
      </p>
    </div>
  )
}

function FieldLabel({ children, required }: { children: React.ReactNode; required?: boolean }) {
  return (
    <label className="block text-[13px] font-semibold text-brand-900 tracking-[-0.005em]">
      {children}
      {required && <span className="ml-0.5 text-brand">*</span>}
    </label>
  )
}

// ──────────────────────────────────────────────────────────────────────────────
// Conversation

interface ConversationViewProps {
  kind: SupportKind
  timeline: ConversationTimelineItem[]
  ticketTerminal: boolean
  openingIds: Set<string>
  imageUrls: Map<string, string>
  failedImageIds: Set<string>
  onOpenAttachment: (attachment: SupportAttachment) => void
}

function ConversationView({
  kind,
  timeline,
  ticketTerminal,
  openingIds,
  imageUrls,
  failedImageIds,
  onOpenAttachment,
}: ConversationViewProps) {
  const { t } = useTranslation()
  const footerKey = kind === 'idea' ? 'support.threadFooterIdea' : 'support.threadFooterInquiry'

  return (
    <div className="px-5 pb-4 flex flex-col gap-4">
      {timeline.map((item) => {
        if (item.kind === 'message') {
          return (
            <CSChatBubble
              key={item.id}
              message={item.message}
              openingIds={openingIds}
              imageUrls={imageUrls}
              failedImageIds={failedImageIds}
              onOpenAttachment={onOpenAttachment}
            />
          )
        }
        return <StatusEventRow key={item.id} event={item.event} />
      })}
      {!ticketTerminal && (
        <p className="text-center text-[11px] text-foreground-subtle py-2 tracking-[-0.005em]">
          {t(footerKey)}
        </p>
      )}
    </div>
  )
}

function StatusEventRow({ event }: { event: SupportStatusEvent }) {
  const { t } = useTranslation()
  return (
    <div className="flex items-center gap-2 my-1">
      <span className="flex-1 h-px bg-border" />
      <span className="text-[11px] text-foreground-muted tracking-[-0.005em] text-center">
        {t(`support.threadStatusEvent.${event.to}`)}
        <span className="text-foreground-subtle"> · {formatStatusEventTime(event.at)}</span>
      </span>
      <span className="flex-1 h-px bg-border" />
    </div>
  )
}

// ──────────────────────────────────────────────────────────────────────────────
// Notices

function NoticeBanner({
  title,
  description,
  tone,
}: {
  title: string
  description: string
  tone: 'default' | 'danger'
}) {
  return (
    <div
      className={cn(
        'rounded-[16px] p-4',
        tone === 'danger' ? 'bg-accent-danger/10' : 'bg-background-card border border-border',
      )}
    >
      <p
        className={cn(
          'text-[14px] font-semibold',
          tone === 'danger' ? 'text-accent-danger' : 'text-foreground',
        )}
      >
        {title}
      </p>
      <p className="text-[12px] text-foreground-muted mt-1 leading-relaxed">{description}</p>
    </div>
  )
}

// ──────────────────────────────────────────────────────────────────────────────
// Header / footer helpers

interface HeaderInfo {
  title: string
  subtitle?: string
  right?: React.ReactNode
  meta?: React.ReactNode
}

function getHeaderInfo(
  view: SupportView,
  t: TFunction,
  ticket: SupportTicket | null,
  onArchiveTicket: () => void,
): HeaderInfo {
  switch (view) {
    case 'home':
      return {
        title: t('support.heroTitle'),
        subtitle: t('support.helpHomeSubtitle'),
      }
    case 'faq':
      return {
        title: t('support.faqTitle'),
      }
    case 'inquiry-list':
      return {
        title: t('support.inquiryListTitle'),
      }
    case 'idea-list':
      return {
        title: t('support.ideaListTitle'),
      }
    case 'compose-inquiry':
      return {
        title: t('support.composePageTitle'),
        subtitle: t('support.composeInquirySubtitle'),
      }
    case 'compose-idea':
      return {
        title: t('support.composeIdeaPageTitle'),
        subtitle: t('support.composeIdeaSubtitle'),
      }
    case 'ticket-detail': {
      if (!ticket) return { title: t('support.title') }
      const isIdea = isIdeaCategory(ticket.category)
      return {
        title: ticket.title,
        subtitle: t(isIdea ? 'support.ideaDetailMetadata' : 'support.detailMetadata', {
          date: formatTicketDate(ticket.createdAt),
        }),
        meta: (
          <>
            {isIdea ? (
              <span className="inline-flex items-center gap-1.5 rounded-full bg-brand-50 text-brand px-2.5 py-1 text-[11px] font-semibold leading-none tracking-[-0.005em]">
                <Sparkles className="w-3 h-3" strokeWidth={1.7} />
                {t('support.ideaBadge')}
              </span>
            ) : (
              <CSStatusChip kind={ticketStatusToCSKind(ticket.status)} />
            )}
            <CSCategoryChip label={t(`support.categories.${ticket.category}`)} />
          </>
        ),
        right: (
          <button
            type="button"
            onClick={onArchiveTicket}
            aria-label={t('support.deleteTicket')}
            className="w-8 h-8 rounded-lg flex items-center justify-center text-foreground-muted hover:bg-foreground/[0.04] active:bg-foreground/[0.06]"
          >
            <Trash2 className="w-4 h-4" strokeWidth={1.7} />
          </button>
        ),
      }
    }
  }
}

interface RenderFooterArgs {
  view: SupportView
  title: string
  body: string
  isCreating: boolean
  onSubmit: () => void
  submitLabel: string
  selectedTicket: SupportTicket | null
  selectedKind: SupportKind
  replyBody: string
  replyFiles: File[]
  onReplyBodyChange: (value: string) => void
  onReplyFilesChange: (files: File[]) => void
  onSendReply: () => void
  isSendingReply: boolean
  capabilities: SupportSnapshot['capabilities']['attachments']
  onAttachmentError: (message: string) => void
  placeholder: string
  t: TFunction
}

function renderFooter(args: RenderFooterArgs): React.ReactNode {
  const { view, title, body, isCreating, onSubmit, submitLabel } = args

  if (view === 'compose-inquiry' || view === 'compose-idea') {
    const enabled = title.trim().length > 0 && body.trim().length > 0 && !isCreating
    return (
      <div className="px-5 pt-3 pb-4">
        <button
          type="button"
          onClick={onSubmit}
          disabled={!enabled}
          className={cn(
            'w-full h-[50px] rounded-[14px] text-[15px] font-semibold tracking-[-0.005em] flex items-center justify-center gap-2 transition-transform active:scale-[0.99]',
            enabled ? 'bg-brand text-white' : 'bg-[#D7D9E5] text-white cursor-not-allowed',
          )}
          style={enabled ? { boxShadow: '0 4px 12px -4px rgba(81,90,192,0.5)' } : undefined}
        >
          {isCreating ? (
            <span className="inline-flex items-center gap-2">
              <span className="w-4 h-4 border-2 border-white/40 border-t-white rounded-full animate-spin" />
              {args.t('support.submittingTicket')}
            </span>
          ) : (
            submitLabel
          )}
        </button>
      </div>
    )
  }

  if (
    view === 'ticket-detail' &&
    args.selectedTicket &&
    (args.selectedKind === 'idea' || !isSupportTicketTerminal(args.selectedTicket.status))
  ) {
    return (
      <CSChatInput
        value={args.replyBody}
        onChange={args.onReplyBodyChange}
        onSend={args.onSendReply}
        files={args.replyFiles}
        onFilesChange={args.onReplyFilesChange}
        capabilities={args.capabilities}
        disabled={args.isSendingReply}
        placeholder={args.placeholder}
        onAttachmentError={args.onAttachmentError}
      />
    )
  }

  return null
}

// ──────────────────────────────────────────────────────────────────────────────
// Helpers

type ConversationTimelineItem =
  | { kind: 'message'; id: string; at: number; message: SupportMessage }
  | { kind: 'status'; id: string; at: number; event: SupportStatusEvent }

function buildConversationTimeline(
  messages: SupportMessage[],
  statusEvents: SupportStatusEvent[],
): ConversationTimelineItem[] {
  const items: ConversationTimelineItem[] = [
    ...messages.map((message): ConversationTimelineItem => ({
      kind: 'message', id: message.id, at: message.createdAt, message,
    })),
    ...statusEvents
      // 'open' is the initial state of every ticket — skip noisy "reopened"
      // unless agent actually moves back to it (terminal lock will block).
      .filter((event) => event.to !== ('open' as SupportTicketStatus))
      .map((event): ConversationTimelineItem => ({
        kind: 'status', id: event.id, at: event.at, event,
      })),
  ]
  items.sort((a, b) => a.at - b.at)
  return items
}

function formatStatusEventTime(timestamp: number): string {
  const date = new Date(timestamp)
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  const hh = String(date.getHours()).padStart(2, '0')
  const mm = String(date.getMinutes()).padStart(2, '0')
  return `${m}-${d} ${hh}:${mm}`
}

function getConversationMessages(
  ticket: SupportTicket | null,
  messagesByTicket: SupportSnapshot['messages'],
): SupportMessage[] {
  if (!ticket) return []
  const messages = messagesByTicket[ticket.id] ?? []
  const hasInitialTicket = messages.some((message) => message.id === `ticket:${ticket.id}`)
  if (hasInitialTicket || !ticket.body) return messages
  return [
    {
      id: `ticket:${ticket.id}`,
      ticketId: ticket.id,
      threadId: ticket.threadId,
      body: ticket.body,
      sender: 'customer',
      channel: 'thread',
      createdAt: ticket.createdAt,
    },
    ...messages,
  ]
}

const CANVAS_STRIPPABLE_MIMES = new Set(['image/jpeg', 'image/png', 'image/webp'])

function mimeToExt(mime: string): string {
  const MAP: Record<string, string> = {
    'image/jpeg': 'jpg',
    'image/png': 'png',
    'image/webp': 'webp',
    'image/gif': 'gif',
    'image/heic': 'heic',
    'image/avif': 'avif',
    'application/pdf': 'pdf',
    'video/mp4': 'mp4',
    'video/quicktime': 'mov',
    'audio/mpeg': 'mp3',
    'audio/wav': 'wav',
    'text/plain': 'txt',
  }
  return MAP[mime] ?? 'bin'
}

function stripExifViaCanvas(file: File): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file)
    const img = new Image()
    img.onload = () => {
      URL.revokeObjectURL(url)
      const canvas = document.createElement('canvas')
      canvas.width = img.naturalWidth
      canvas.height = img.naturalHeight
      canvas.getContext('2d')!.drawImage(img, 0, 0)
      canvas.toBlob(
        async (blob) => {
          if (!blob) { reject(new Error('canvas export failed')); return }
          resolve(new Uint8Array(await blob.arrayBuffer()))
        },
        file.type,
        file.type === 'image/jpeg' ? 0.92 : undefined,
      )
    }
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('image load failed')) }
    img.src = url
  })
}

async function filesToSupportAttachments(files: File[]): Promise<SupportAttachmentUpload[]> {
  return Promise.all(
    files.map(async (file) => {
      const mime = file.type || 'application/octet-stream'
      const name = `${crypto.randomUUID()}.${mimeToExt(mime)}`

      if (CANVAS_STRIPPABLE_MIMES.has(mime)) {
        try {
          const data = await stripExifViaCanvas(file)
          return { name, mime, size: data.byteLength, data }
        } catch {
          // canvas 실패 시 원본 바이트 폴백
        }
      }

      const data = new Uint8Array(await file.arrayBuffer())
      return { name, mime, size: data.byteLength, data }
    }),
  )
}

function saveDownloadedAttachment(data: Uint8Array, mime: string, name?: string): void {
  const blob = new Blob([toArrayBuffer(data)], { type: mime })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = name ?? 'attachment'
  link.click()
  window.setTimeout(() => URL.revokeObjectURL(url), 0)
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer
}

function formatTicketTime(timestamp: number): string {
  const date = new Date(timestamp)
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  const hh = String(date.getHours()).padStart(2, '0')
  const mm = String(date.getMinutes()).padStart(2, '0')
  return `${y}-${m}-${d} ${hh}:${mm}`
}

function formatTicketDate(timestamp: number): string {
  const date = new Date(timestamp)
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}
