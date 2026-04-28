import { useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { ChevronRight, Download, Paperclip, Plus, Send, X } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import {
  DEFAULT_SUPPORT_CATEGORY,
  DEFAULT_SUPPORT_PRIORITY,
  isSupportTicketTerminal,
  type SupportAttachment,
  type SupportAttachmentUpload,
  type SupportCategory,
  type SupportMessage,
  type SupportPriority,
  type SupportSnapshot,
  type SupportTicket,
  type SupportTicketStatus,
} from '@/core/domain/support'
import zappiLogo from '@/assets/zappi.png'
import { Button } from '@/ui/components/common/Button'
import { SettingsDetailPage } from '../components/SettingsDetailPage'
import { useSupport } from '@/ui/hooks/use-support'
import { cn } from '@/ui/primitives/utils'

interface SupportPageProps {
  onBack: () => void
}

type SupportView = 'list' | 'compose' | 'detail'

const CATEGORY_OPTIONS: Array<{
  value: SupportCategory
  labelKey: string
}> = [
  {
    value: 'general',
    labelKey: 'support.categories.general',
  },
  {
    value: 'technical',
    labelKey: 'support.categories.technical',
  },
  {
    value: 'billing',
    labelKey: 'support.categories.billing',
  },
]

const PRIORITY_OPTIONS: Array<{
  value: SupportPriority
  labelKey: string
}> = [
  {
    value: 'normal',
    labelKey: 'support.priorities.normal',
  },
  {
    value: 'high',
    labelKey: 'support.priorities.high',
  },
]

export function SupportPage({ onBack }: SupportPageProps) {
  const { t } = useTranslation()
  const support = useSupport()
  const [snapshot, setSnapshot] = useState<SupportSnapshot>(() => support.getSnapshot())
  const [view, setView] = useState<SupportView>('list')
  const [selectedTicketId, setSelectedTicketId] = useState<string | null>(null)
  const [category, setCategory] = useState<SupportCategory>(DEFAULT_SUPPORT_CATEGORY)
  const [priority, setPriority] = useState<SupportPriority>(DEFAULT_SUPPORT_PRIORITY)
  const [title, setTitle] = useState('')
  const [body, setBody] = useState('')
  const [replyBody, setReplyBody] = useState('')
  const [composeFiles, setComposeFiles] = useState<File[]>([])
  const [replyFiles, setReplyFiles] = useState<File[]>([])
  const [downloadingAttachmentIds, setDownloadingAttachmentIds] = useState<Set<string>>(() => new Set())
  const [isCreating, setIsCreating] = useState(false)
  const [isSendingReply, setIsSendingReply] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)
  const lastRefreshAtRef = useRef(0)

  useEffect(() => {
    const unsubscribe = support.subscribe(setSnapshot)
    support.connect().then(setSnapshot).catch(() => {
      setFormError(t('support.connectionFailed'))
    })

    return () => {
      unsubscribe()
      support.disconnect().catch(() => undefined)
    }
  }, [support, t])

  useEffect(() => {
    const refresh = () => {
      const now = Date.now()
      if (now - lastRefreshAtRef.current < 15_000) return
      lastRefreshAtRef.current = now
      support.refresh().then(setSnapshot).catch(() => undefined)
    }
    const refreshWhenVisible = () => {
      if (document.visibilityState === 'visible') refresh()
    }

    window.addEventListener('online', refresh)
    document.addEventListener('visibilitychange', refreshWhenVisible)
    return () => {
      window.removeEventListener('online', refresh)
      document.removeEventListener('visibilitychange', refreshWhenVisible)
    }
  }, [support])

  useEffect(() => {
    if (!selectedTicketId) return
    if (snapshot.tickets.some((ticket) => ticket.id === selectedTicketId)) return

    setSelectedTicketId(null)
    setView('list')
  }, [selectedTicketId, snapshot.tickets])

  const selectedTicket = useMemo(
    () => snapshot.tickets.find((ticket) => ticket.id === selectedTicketId) ?? null,
    [selectedTicketId, snapshot.tickets],
  )

  const selectedMessages = useMemo(
    () => getConversationMessages(selectedTicket, snapshot.messages),
    [selectedTicket, snapshot.messages],
  )
  const selectedLatestSupportMessageAt = useMemo(
    () => getLatestSupportMessageAt(selectedMessages),
    [selectedMessages],
  )

  const activeView: SupportView = view === 'detail' && !selectedTicket ? 'list' : view

  useEffect(() => {
    if (activeView !== 'detail' || !selectedTicket) return
    if (selectedLatestSupportMessageAt <= (selectedTicket.readAt ?? 0)) return

    support.markTicketRead(selectedTicket.id).catch(() => undefined)
  }, [activeView, selectedLatestSupportMessageAt, selectedTicket, support])

  const openTicket = (ticketId: string) => {
    setFormError(null)
    setSelectedTicketId(ticketId)
    setView('detail')
  }

  const resetComposer = () => {
    setCategory(DEFAULT_SUPPORT_CATEGORY)
    setPriority(DEFAULT_SUPPORT_PRIORITY)
    setTitle('')
    setBody('')
    setComposeFiles([])
  }

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
      resetComposer()
      setSelectedTicketId(ticket.id)
      setView('detail')
    } catch {
      setFormError(t('support.createFailed'))
    } finally {
      setIsCreating(false)
    }
  }

  const handleSendMessage = async () => {
    if (!selectedTicket || (!replyBody.trim() && replyFiles.length === 0) || isSendingReply) return

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

  const openComposer = () => {
    setFormError(null)
    setView('compose')
  }

  const handleDownloadAttachment = async (attachment: SupportAttachment) => {
    if (attachment.state !== 'available' || downloadingAttachmentIds.has(attachment.id)) return

    setDownloadingAttachmentIds((current) => new Set(current).add(attachment.id))
    setFormError(null)
    try {
      const downloaded = await support.downloadAttachment({ attachmentId: attachment.id })
      saveDownloadedAttachment(downloaded.data, downloaded.mime, downloaded.name ?? attachment.name)
    } catch {
      setFormError(t('support.downloadFailed'))
    } finally {
      setDownloadingAttachmentIds((current) => {
        const next = new Set(current)
        next.delete(attachment.id)
        return next
      })
    }
  }

  const closeSubView = () => {
    resetComposer()
    setReplyBody('')
    setReplyFiles([])
    setView('list')
  }

  return (
    <SettingsDetailPage
      title={activeView === 'compose' ? t('support.composePageTitle') : t('support.title')}
      onBack={activeView === 'list' ? onBack : closeSubView}
      headerAction={activeView === 'list' ? (
        <button
          type="button"
          onClick={openComposer}
          className="flex h-10 items-center gap-1.5 rounded-full bg-background-card px-4 text-body font-medium text-foreground active:scale-[0.98] transition-transform"
        >
          <Plus className="w-4 h-4" strokeWidth={1.8} />
          {t('support.startNewTicket')}
        </button>
      ) : null}
    >
      <div className="px-4 pt-3 pb-28 space-y-4">
        {!snapshot.availability.available ? (
          <SupportNotice
            title={t('support.unavailableTitle')}
            description={t('support.unavailableDescription')}
          />
        ) : (
          <>
            {snapshot.status === 'error' && (
              <SupportNotice
                title={t('support.connectionFailed')}
                description={snapshot.error ?? t('support.tryAgainLater')}
                tone="danger"
              />
            )}
            {formError && (
              <SupportNotice title={formError} description={t('support.tryAgainLater')} tone="danger" />
            )}

            {activeView === 'list' && (
              <TicketListView
                tickets={snapshot.tickets}
                messages={snapshot.messages}
                onSelect={openTicket}
              />
            )}

            {activeView === 'compose' && (
              <ComposerView
                category={category}
                priority={priority}
                title={title}
                body={body}
                attachments={composeFiles}
                attachmentCapabilities={snapshot.capabilities.attachments}
                isCreating={isCreating}
                onCategoryChange={setCategory}
                onPriorityChange={setPriority}
                onTitleChange={setTitle}
                onBodyChange={setBody}
                onAttachmentsChange={setComposeFiles}
                onAttachmentError={setFormError}
                onCancel={closeSubView}
                onSubmit={handleCreateTicket}
              />
            )}

            {activeView === 'detail' && selectedTicket && (
              <ConversationView
                ticket={selectedTicket}
                messages={selectedMessages}
                replyBody={replyBody}
                attachments={replyFiles}
                attachmentCapabilities={snapshot.capabilities.attachments}
                downloadingAttachmentIds={downloadingAttachmentIds}
                isSendingReply={isSendingReply}
                onReplyBodyChange={setReplyBody}
                onAttachmentsChange={setReplyFiles}
                onAttachmentError={setFormError}
                onDownloadAttachment={handleDownloadAttachment}
                onSendMessage={handleSendMessage}
              />
            )}
          </>
        )}
      </div>
    </SettingsDetailPage>
  )
}

interface TicketListViewProps {
  tickets: SupportTicket[]
  messages: SupportSnapshot['messages']
  onSelect: (ticketId: string) => void
}

function TicketListView({ tickets, messages, onSelect }: TicketListViewProps) {
  const { t } = useTranslation()
  const unreadCount = tickets.filter((ticket) => isTicketUnread(ticket, messages[ticket.id] ?? [])).length

  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between px-1">
        <div>
          <p className="text-subtitle font-semibold text-foreground">
            {t('support.myTickets')}
          </p>
          {tickets.length > 0 && (
            <p className="text-label text-foreground-subtle mt-0.5">
              {t('support.ticketCount', { count: tickets.length })}
            </p>
          )}
        </div>
        <div className="flex items-center gap-2">
          {unreadCount > 0 && (
            <span className="rounded-full bg-brand/10 px-2.5 py-1 text-label font-semibold text-brand">
              {t('support.unreadCount', { count: unreadCount })}
            </span>
          )}
        </div>
      </div>

      {tickets.length === 0 ? (
        <div className="rounded-[28px] bg-background-card border border-border/70 p-7 text-center">
          <p className="text-body font-semibold text-foreground">{t('support.noTickets')}</p>
        </div>
      ) : (
        <div className="space-y-2">
          {tickets.map((ticket) => (
            <TicketCard
              key={ticket.id}
              ticket={ticket}
              messages={messages[ticket.id] ?? []}
              onSelect={() => onSelect(ticket.id)}
            />
          ))}
        </div>
      )}
    </section>
  )
}

interface ComposerViewProps {
  category: SupportCategory
  priority: SupportPriority
  title: string
  body: string
  attachments: File[]
  attachmentCapabilities: SupportSnapshot['capabilities']['attachments']
  isCreating: boolean
  onCategoryChange: (category: SupportCategory) => void
  onPriorityChange: (priority: SupportPriority) => void
  onTitleChange: (title: string) => void
  onBodyChange: (body: string) => void
  onAttachmentsChange: (files: File[]) => void
  onAttachmentError: (message: string) => void
  onCancel: () => void
  onSubmit: () => void
}

function ComposerView({
  category,
  priority,
  title,
  body,
  attachments,
  attachmentCapabilities,
  isCreating,
  onCategoryChange,
  onPriorityChange,
  onTitleChange,
  onBodyChange,
  onAttachmentsChange,
  onAttachmentError,
  onCancel,
  onSubmit,
}: ComposerViewProps) {
  const { t } = useTranslation()

  return (
    <section className="rounded-[28px] bg-background-card border border-border/70 overflow-hidden shadow-sm">
      <div className="p-4 space-y-5">
        <OptionGroup label={t('support.categoryLabel')}>
          {CATEGORY_OPTIONS.map((option) => (
            <OptionCard
              key={option.value}
              selected={category === option.value}
              title={t(option.labelKey)}
              onClick={() => onCategoryChange(option.value)}
            />
          ))}
        </OptionGroup>

        <OptionGroup label={t('support.priorityLabel')}>
          {PRIORITY_OPTIONS.map((option) => (
            <OptionCard
              key={option.value}
              selected={priority === option.value}
              title={t(option.labelKey)}
              onClick={() => onPriorityChange(option.value)}
            />
          ))}
        </OptionGroup>

        <label className="block">
          <span className="text-label font-medium text-foreground-muted">
            {t('support.requestTitleLabel')}
          </span>
          <input
            value={title}
            onChange={(event) => onTitleChange(event.target.value)}
            maxLength={120}
            placeholder={t('support.titlePlaceholder')}
            className="mt-1.5 w-full rounded-2xl bg-background px-4 py-3 text-body text-foreground placeholder:text-foreground-subtle outline-none focus:ring-2 focus:ring-brand/30"
          />
        </label>

        <label className="block">
          <span className="text-label font-medium text-foreground-muted">
            {t('support.requestBodyLabel')}
          </span>
          <textarea
            value={body}
            onChange={(event) => onBodyChange(event.target.value)}
            maxLength={2000}
            rows={6}
            placeholder={t('support.bodyPlaceholder')}
            className="mt-1.5 w-full rounded-2xl bg-background px-4 py-3 text-body text-foreground placeholder:text-foreground-subtle outline-none focus:ring-2 focus:ring-brand/30 resize-none"
          />
        </label>

        <p className="text-caption text-foreground-muted">{t('support.privacyNote')}</p>

        <AttachmentPicker
          files={attachments}
          capabilities={attachmentCapabilities}
          disabled={isCreating}
          onChange={onAttachmentsChange}
          onError={onAttachmentError}
        />

        <div className="flex gap-2">
          <Button
            variant="secondary"
            size="lg"
            onClick={onCancel}
            disabled={isCreating}
            className="flex-1"
          >
            {t('common.cancel')}
          </Button>
          <Button
            variant="brand"
            size="lg"
            onClick={onSubmit}
            disabled={!title.trim() || !body.trim() || isCreating}
            className="flex-[1.4]"
          >
            {isCreating ? t('support.submittingTicket') : t('support.createTicket')}
          </Button>
        </div>
      </div>
    </section>
  )
}

function OptionGroup({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <p className="text-label font-semibold text-foreground-muted mb-2">{label}</p>
      <div className="flex flex-wrap gap-2">{children}</div>
    </div>
  )
}

interface OptionCardProps {
  selected: boolean
  title: string
  onClick: () => void
}

function OptionCard({ selected, title, onClick }: OptionCardProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'h-10 rounded-full border px-4 text-body font-medium transition-colors active:scale-[0.99]',
        selected
          ? 'border-brand/70 bg-brand/5'
          : 'border-border/70 bg-background active:bg-background-hover',
      )}
    >
      {title}
    </button>
  )
}

interface AttachmentPickerProps {
  files: File[]
  capabilities: SupportSnapshot['capabilities']['attachments']
  disabled?: boolean
  compact?: boolean
  onChange: (files: File[]) => void
  onError: (message: string) => void
}

function AttachmentPicker({
  files,
  capabilities,
  disabled = false,
  compact = false,
  onChange,
  onError,
}: AttachmentPickerProps) {
  const { t } = useTranslation()
  const inputRef = useRef<HTMLInputElement>(null)

  if (!capabilities.available) {
    return null
  }

  const addFiles = (selected: FileList | null) => {
    if (!selected || selected.length === 0) return

    const next = [...files]
    for (const file of Array.from(selected)) {
      if (next.length >= capabilities.maxCount) {
        onError(t('support.attachmentLimit', { count: capabilities.maxCount }))
        break
      }
      if (file.size > capabilities.maxSizeBytes) {
        onError(t('support.attachmentTooLarge', { size: formatAttachmentSize(capabilities.maxSizeBytes) }))
        continue
      }
      next.push(file)
    }
    onChange(next)
  }

  return (
    <div className={cn('space-y-2', compact ? 'mb-1' : '')}>
      {files.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {files.map((file, index) => (
            <span
              key={`${file.name}:${file.size}:${index}`}
              className="inline-flex max-w-full items-center gap-1.5 rounded-full bg-background px-2.5 py-1 text-label text-foreground"
            >
              <Paperclip className="w-3.5 h-3.5 shrink-0" strokeWidth={1.8} />
              <span className="truncate max-w-[190px]">{file.name}</span>
              <span className="text-foreground-muted">{formatAttachmentSize(file.size)}</span>
              <button
                type="button"
                aria-label={t('support.removeAttachment')}
                disabled={disabled}
                onClick={() => onChange(files.filter((_, fileIndex) => fileIndex !== index))}
                className="rounded-full p-0.5 text-foreground-muted disabled:opacity-40"
              >
                <X className="w-3.5 h-3.5" strokeWidth={1.8} />
              </button>
            </span>
          ))}
        </div>
      )}
      <button
        type="button"
        disabled={disabled || files.length >= capabilities.maxCount}
        onClick={() => inputRef.current?.click()}
        className={cn(
          'inline-flex items-center gap-1.5 rounded-full border border-border/70 bg-background px-3 py-2 text-label font-semibold text-foreground transition-colors active:scale-[0.99] disabled:opacity-40',
          compact && 'py-1.5',
        )}
      >
        <Paperclip className="w-3.5 h-3.5" strokeWidth={1.8} />
        {t('support.attachFile')}
      </button>
      <input
        ref={inputRef}
        type="file"
        multiple
        className="hidden"
        disabled={disabled}
        onChange={(event) => {
          addFiles(event.currentTarget.files)
          event.currentTarget.value = ''
        }}
      />
    </div>
  )
}

interface ConversationViewProps {
  ticket: SupportTicket
  messages: SupportMessage[]
  replyBody: string
  attachments: File[]
  attachmentCapabilities: SupportSnapshot['capabilities']['attachments']
  downloadingAttachmentIds: Set<string>
  isSendingReply: boolean
  onReplyBodyChange: (body: string) => void
  onAttachmentsChange: (files: File[]) => void
  onAttachmentError: (message: string) => void
  onDownloadAttachment: (attachment: SupportAttachment) => void
  onSendMessage: () => void
}

function ConversationView({
  ticket,
  messages,
  replyBody,
  attachments,
  attachmentCapabilities,
  downloadingAttachmentIds,
  isSendingReply,
  onReplyBodyChange,
  onAttachmentsChange,
  onAttachmentError,
  onDownloadAttachment,
  onSendMessage,
}: ConversationViewProps) {
  const { t } = useTranslation()
  const isTerminal = isSupportTicketTerminal(ticket.status)

  return (
    <section className="rounded-[28px] bg-background-card border border-border/70 overflow-hidden shadow-sm">
      <div className="px-4 py-4 border-b border-border/70">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-title font-semibold text-foreground truncate">{ticket.title}</p>
            <p className="text-caption text-foreground-muted mt-1">
              {t(`support.categories.${ticket.category}`)} · {formatSupportTime(ticket.updatedAt)}
            </p>
          </div>
          <StatusPill status={ticket.status} />
        </div>
      </div>

      <div className="p-4 space-y-3">
        {messages.map((message) => (
          <MessageBubble
            key={message.id}
            message={message}
            downloadingAttachmentIds={downloadingAttachmentIds}
            onDownloadAttachment={onDownloadAttachment}
          />
        ))}
        {isTerminal && (
          <div className="flex justify-center">
            <p className="rounded-full bg-background px-3 py-1.5 text-label font-medium text-foreground-muted">
              {ticket.status === 'resolved' ? t('support.resolvedNotice') : t('support.closedNotice')}
            </p>
          </div>
        )}
      </div>

      {!isTerminal && (
        <div className="p-3 border-t border-border/70 bg-background-card">
          <AttachmentPicker
            files={attachments}
            capabilities={attachmentCapabilities}
            disabled={isSendingReply}
            compact
            onChange={onAttachmentsChange}
            onError={onAttachmentError}
          />
          <div className="flex items-end gap-2 rounded-2xl bg-background p-2 mt-2">
            <textarea
              value={replyBody}
              onChange={(event) => onReplyBodyChange(event.target.value)}
              maxLength={1200}
              rows={1}
              placeholder={t('support.replyPlaceholder')}
              className="min-h-10 flex-1 bg-transparent px-2 py-2 text-body text-foreground placeholder:text-foreground-subtle outline-none resize-none"
            />
            <button
              type="button"
              onClick={onSendMessage}
              disabled={(!replyBody.trim() && attachments.length === 0) || isSendingReply}
              aria-label={t('support.sendMessage')}
              className="w-10 h-10 rounded-xl bg-brand text-white flex items-center justify-center disabled:opacity-40 active:scale-[0.98] transition-transform shrink-0"
            >
              <Send className="w-4 h-4" strokeWidth={1.8} />
            </button>
          </div>
          {isSendingReply && (
            <p className="text-label text-foreground-muted mt-2 px-1">{t('support.sendingMessage')}</p>
          )}
        </div>
      )}
    </section>
  )
}

interface TicketCardProps {
  ticket: SupportTicket
  messages: SupportMessage[]
  onSelect: () => void
}

function TicketCard({ ticket, messages, onSelect }: TicketCardProps) {
  const { t } = useTranslation()
  const unread = isTicketUnread(ticket, messages)

  return (
    <button
      type="button"
      onClick={onSelect}
      className={cn(
        'w-full rounded-3xl border p-4 text-left transition-colors active:scale-[0.99] active:bg-background-hover',
        unread ? 'border-brand/45 bg-brand/5' : 'border-border/70 bg-background-card',
      )}
    >
      <div className="flex items-center gap-3">
        <div className={cn(
          'h-12 w-12 rounded-[20px] flex items-center justify-center shrink-0 overflow-hidden',
          unread ? 'bg-brand/15 ring-1 ring-brand/25' : 'bg-background',
        )}>
          <img src={zappiLogo} alt="" className="h-8 w-8 object-contain" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-label text-foreground-subtle">
            {formatSupportTime(ticket.updatedAt)}
          </p>
          <p className="text-body font-semibold text-foreground truncate mt-0.5">
            {ticket.title}
          </p>
        </div>
        <div className="flex flex-col items-end gap-2 shrink-0">
          <StatusPill status={ticket.status} />
          <div className="h-5 flex items-center">
            {unread ? (
              <span className="rounded-full bg-brand px-2 py-0.5 text-label font-semibold text-white">
                {t('support.unreadBadge')}
              </span>
            ) : (
              <ChevronRight className="w-4 h-4 text-foreground-subtle" strokeWidth={1.8} />
            )}
          </div>
        </div>
      </div>
    </button>
  )
}

function MessageBubble({
  message,
  downloadingAttachmentIds,
  onDownloadAttachment,
}: {
  message: SupportMessage
  downloadingAttachmentIds: Set<string>
  onDownloadAttachment: (attachment: SupportAttachment) => void
}) {
  const { t } = useTranslation()
  const isCustomer = message.sender === 'customer'

  return (
    <div className={cn('flex', isCustomer ? 'justify-end' : 'justify-start')}>
      <div
        className={cn(
          'rounded-[22px] px-3.5 py-2.5 max-w-[86%]',
          isCustomer
            ? 'bg-brand text-white rounded-br-md'
            : 'bg-background text-foreground rounded-bl-md',
        )}
      >
        {message.body && (
          <p className="text-body whitespace-pre-wrap break-words leading-relaxed">{message.body}</p>
        )}
        {message.attachments && message.attachments.length > 0 && (
          <div className={cn('space-y-1.5', message.body ? 'mt-2' : '')}>
            {message.attachments.map((attachment) => (
              <button
                type="button"
                key={attachment.id}
                disabled={attachment.state !== 'available' || downloadingAttachmentIds.has(attachment.id)}
                onClick={() => onDownloadAttachment(attachment)}
                className={cn(
                  'flex w-full items-center gap-2 rounded-2xl px-2.5 py-2 text-left transition-opacity disabled:opacity-70',
                  isCustomer ? 'bg-white/12' : 'bg-background-card',
                )}
              >
                <Paperclip className="w-3.5 h-3.5 shrink-0" strokeWidth={1.8} />
                <span className="min-w-0">
                  <span className="block truncate text-label font-semibold">
                    {attachment.name || attachment.mime}
                  </span>
                  <span className={cn('block text-label', isCustomer ? 'text-white/70' : 'text-foreground-muted')}>
                    {formatAttachmentSize(attachment.size)} · {
                      attachment.state === 'available'
                        ? downloadingAttachmentIds.has(attachment.id)
                          ? t('support.downloadingAttachment')
                          : t('support.downloadAttachment')
                        : t('support.attachmentMetadataOnly')
                    }
                  </span>
                </span>
                {attachment.state === 'available' && (
                  <Download className="ml-auto w-3.5 h-3.5 shrink-0" strokeWidth={1.8} />
                )}
              </button>
            ))}
          </div>
        )}
        <p className={cn(
          'text-label mt-1.5',
          isCustomer ? 'text-white/70' : 'text-foreground-muted',
        )}>
          {formatSupportTime(message.createdAt)}
        </p>
      </div>
    </div>
  )
}

interface SupportNoticeProps {
  title: string
  description: string
  tone?: 'default' | 'danger'
}

function SupportNotice({ title, description, tone = 'default' }: SupportNoticeProps) {
  return (
    <div className={cn(
      'rounded-card p-4',
      tone === 'danger' ? 'bg-accent-danger/10' : 'bg-background-card',
    )}>
      <p className={cn(
        'text-body font-semibold',
        tone === 'danger' ? 'text-accent-danger' : 'text-foreground',
      )}>
        {title}
      </p>
      <p className="text-caption text-foreground-muted mt-1 leading-relaxed">{description}</p>
    </div>
  )
}

function StatusPill({ status }: { status: SupportTicketStatus }) {
  const { t } = useTranslation()

  return (
    <span className={cn(
      'shrink-0 rounded-full px-2.5 py-1 text-label font-semibold',
      status === 'open' && 'bg-brand/10 text-brand',
      status === 'in_progress' && 'bg-amber-500/10 text-amber-600',
      status === 'resolved' && 'bg-emerald-500/10 text-emerald-600',
      status === 'closed' && 'bg-foreground/[0.06] text-foreground-muted',
    )}>
      {t(`support.status.${status}`)}
    </span>
  )
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

function isTicketUnread(ticket: SupportTicket, messages: SupportMessage[]): boolean {
  const latestSupportAt = getLatestSupportMessageAt(messages)
  return latestSupportAt > (ticket.readAt ?? 0)
}

function getLatestSupportMessageAt(messages: SupportMessage[]): number {
  return messages.reduce((latest, message) => {
    if (message.sender !== 'support') return latest
    return Math.max(latest, message.createdAt)
  }, 0)
}

async function filesToSupportAttachments(files: File[]): Promise<SupportAttachmentUpload[]> {
  return Promise.all(files.map(async (file) => ({
    name: file.name,
    mime: file.type || 'application/octet-stream',
    size: file.size,
    data: new Uint8Array(await file.arrayBuffer()),
  })))
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

function formatAttachmentSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

function formatSupportTime(timestamp: number): string {
  return new Date(timestamp).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}
