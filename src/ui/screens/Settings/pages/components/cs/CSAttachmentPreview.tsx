import { useEffect, useMemo, useState } from 'react'
import { Download, ExternalLink, FileText, Loader2, X } from 'lucide-react'
import { useTranslation } from 'react-i18next'

export interface CSAttachmentPreviewData {
  data: Uint8Array
  mime: string
  name?: string
}

interface CSAttachmentPreviewProps {
  attachment: CSAttachmentPreviewData | null
  loading?: boolean
  onClose: () => void
  onDownload: (attachment: CSAttachmentPreviewData) => void
}

export function CSAttachmentPreview({
  attachment,
  loading,
  onClose,
  onDownload,
}: CSAttachmentPreviewProps) {
  const { t } = useTranslation()
  const blobUrl = useObjectUrl(attachment)
  const isImage = attachment ? attachment.mime.startsWith('image/') : false

  if (!attachment && !loading) return null

  return (
    <div className="fixed inset-0 z-[80] bg-black/85 flex flex-col pt-safe pb-safe">
      <div className="flex items-center justify-between px-4 py-3 shrink-0">
        <p className="text-[14px] font-semibold text-white truncate max-w-[60%]">
          {attachment?.name ?? t('support.attachmentLabel')}
        </p>
        <div className="flex items-center gap-1.5">
          {attachment && !loading && (
            <button
              type="button"
              onClick={() => onDownload(attachment)}
              aria-label={t('support.downloadAttachment')}
              className="h-9 px-3 rounded-full bg-white/15 text-white text-[12px] font-semibold flex items-center gap-1.5 active:scale-[0.98] transition-transform"
            >
              <Download className="w-3.5 h-3.5" strokeWidth={1.8} />
              {t('support.downloadAttachment')}
            </button>
          )}
          <button
            type="button"
            onClick={onClose}
            aria-label={t('common.close')}
            className="w-9 h-9 rounded-full bg-white/15 text-white flex items-center justify-center active:scale-[0.98] transition-transform"
          >
            <X className="w-4 h-4" strokeWidth={2} />
          </button>
        </div>
      </div>

      <div className="flex-1 flex items-center justify-center px-4 overflow-hidden">
        {loading || !attachment || !blobUrl ? (
          <Loader2 className="w-7 h-7 text-white/70 animate-spin" strokeWidth={1.8} />
        ) : isImage ? (
          <img
            src={blobUrl}
            alt={attachment.name ?? ''}
            className="max-w-full max-h-full object-contain"
          />
        ) : (
          <div className="flex flex-col items-center gap-3 text-white max-w-[280px] text-center">
            <div className="w-16 h-16 rounded-2xl bg-white/15 flex items-center justify-center">
              <FileText className="w-7 h-7" strokeWidth={1.6} />
            </div>
            <p className="text-[14px] font-semibold break-all">{attachment.name ?? attachment.mime}</p>
            <p className="text-[12px] text-white/65">{formatBytes(attachment.data.length)}</p>
            <a
              href={blobUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-2 inline-flex items-center gap-1.5 text-[12px] text-white/80"
            >
              <ExternalLink className="w-3.5 h-3.5" strokeWidth={1.7} />
              {t('support.openInNewTab')}
            </a>
          </div>
        )}
      </div>
    </div>
  )
}

function useObjectUrl(attachment: CSAttachmentPreviewData | null): string | null {
  const blob = useMemo(() => {
    if (!attachment) return null
    const arrayBuffer = attachment.data.buffer.slice(
      attachment.data.byteOffset,
      attachment.data.byteOffset + attachment.data.byteLength,
    ) as ArrayBuffer
    return new Blob([arrayBuffer], { type: attachment.mime })
  }, [attachment])

  const [url, setUrl] = useState<string | null>(null)

  useEffect(() => {
    if (!blob) {
      setUrl(null)
      return
    }
    const next = URL.createObjectURL(blob)
    setUrl(next)
    return () => {
      URL.revokeObjectURL(next)
    }
  }, [blob])

  return url
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}
