import { Image as ImageIcon, ImageOff, Loader2 } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { cn } from '@/ui/primitives/utils'
import type { SupportAttachment, SupportMessage } from '@/core/domain/support'

interface CSChatBubbleProps {
  message: SupportMessage
  openingIds: Set<string>
  imageUrls: Map<string, string>
  failedImageIds: Set<string>
  onOpenAttachment: (attachment: SupportAttachment) => void
}

export function CSChatBubble({
  message,
  openingIds,
  imageUrls,
  failedImageIds,
  onOpenAttachment,
}: CSChatBubbleProps) {
  const { t } = useTranslation()
  const isUser = message.sender === 'customer'

  return (
    <div className={cn('flex flex-col gap-1.5', isUser ? 'items-end' : 'items-start')}>
      <div className="flex items-center gap-1.5">
        {!isUser && (
          <span className="w-[22px] h-[22px] rounded-full bg-brand text-white flex items-center justify-center text-[10px] font-bold tracking-[-0.005em]">
            Z
          </span>
        )}
        <span className="text-[11px] font-semibold text-brand-900 tracking-[-0.005em]">
          {isUser ? t('support.userBubbleLabel') : t('support.teamName')}
        </span>
        <span className="text-[11px] text-foreground-subtle">
          · {formatBubbleTime(message.createdAt)}
        </span>
      </div>
      <div
        className={cn(
          'max-w-[280px] px-3.5 py-3 text-[13.5px] leading-[1.6] tracking-[-0.005em] text-foreground whitespace-pre-wrap break-words',
          isUser
            ? 'bg-background-card border border-border rounded-[14px_14px_4px_14px]'
            : 'bg-brand-50 rounded-[14px_14px_14px_4px]',
        )}
      >
        {message.body}
        {message.attachments && message.attachments.length > 0 && (
          <div className="mt-2.5 flex flex-col gap-1.5">
            {message.attachments.map((attachment) => {
              const isImage = attachment.mime.startsWith('image/')
              if (isImage) {
                const url = imageUrls.get(attachment.id)
                const failed = failedImageIds.has(attachment.id)
                const ready = url !== undefined
                return (
                  <button
                    type="button"
                    key={attachment.id}
                    disabled={attachment.state !== 'available' || !ready}
                    onClick={() => onOpenAttachment(attachment)}
                    className="block w-full max-w-[240px] rounded-[10px] overflow-hidden bg-background-card border border-border disabled:opacity-80"
                  >
                    {ready ? (
                      <img
                        src={url}
                        alt={attachment.name ?? ''}
                        className="block w-full h-auto max-h-[260px] object-cover"
                      />
                    ) : failed ? (
                      <div className="w-full aspect-[4/3] flex flex-col items-center justify-center gap-1.5 text-foreground-subtle">
                        <ImageOff className="w-5 h-5" strokeWidth={1.6} />
                        <span className="text-[11px] tracking-[-0.005em]">
                          {attachment.state === 'available'
                            ? t('support.previewFailed')
                            : t('support.attachmentMetadataOnly')}
                        </span>
                      </div>
                    ) : (
                      <div className="w-full aspect-[4/3] flex items-center justify-center text-foreground-subtle">
                        <Loader2 className="w-5 h-5 animate-spin" strokeWidth={1.7} />
                      </div>
                    )}
                  </button>
                )
              }

              return (
                <button
                  type="button"
                  key={attachment.id}
                  disabled={attachment.state !== 'available' || openingIds.has(attachment.id)}
                  onClick={() => onOpenAttachment(attachment)}
                  className="flex items-center gap-2 px-2.5 py-1.5 bg-background-card border border-border rounded-[8px] text-left disabled:opacity-70"
                >
                  <ImageIcon className="w-3.5 h-3.5 text-foreground-muted shrink-0" strokeWidth={1.6} />
                  <span className="flex-1 min-w-0">
                    <span className="block text-[11.5px] text-brand-900 truncate tracking-[-0.005em]">
                      {attachment.name || attachment.mime}
                    </span>
                    <span className="block text-[10.5px] text-foreground-subtle mt-px">
                      {formatBytes(attachment.size)} · {attachmentHint(attachment, openingIds, t)}
                    </span>
                  </span>
                  {attachment.state === 'available' && openingIds.has(attachment.id) && (
                    <Loader2 className="w-3.5 h-3.5 animate-spin text-foreground-muted shrink-0" strokeWidth={1.8} />
                  )}
                </button>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}

function attachmentHint(
  attachment: SupportAttachment,
  openingIds: Set<string>,
  t: (key: string) => string,
): string {
  if (attachment.state !== 'available') return t('support.attachmentMetadataOnly')
  if (openingIds.has(attachment.id)) return t('support.openingAttachment')
  return t('support.viewAttachment')
}

function formatBubbleTime(timestamp: number): string {
  const date = new Date(timestamp)
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  const hour = String(date.getHours()).padStart(2, '0')
  const minute = String(date.getMinutes()).padStart(2, '0')
  return `${month}-${day} ${hour}:${minute}`
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}
