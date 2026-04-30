import { useRef } from 'react'
import { Image as ImageIcon, Paperclip, X } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { SupportSnapshot } from '@/core/domain/support'

type AttachmentCapabilities = SupportSnapshot['capabilities']['attachments']

interface CSAttachmentDropzoneProps {
  files: File[]
  capabilities: AttachmentCapabilities
  disabled?: boolean
  onChange: (files: File[]) => void
  onError: (message: string) => void
}

export function CSAttachmentDropzone({
  files,
  capabilities,
  disabled,
  onChange,
  onError,
}: CSAttachmentDropzoneProps) {
  const { t } = useTranslation()
  const inputRef = useRef<HTMLInputElement>(null)

  if (!capabilities.available) return null

  const addFiles = (selected: FileList | null) => {
    if (!selected || selected.length === 0) return
    const next = [...files]
    for (const file of Array.from(selected)) {
      if (next.length >= capabilities.maxCount) {
        onError(t('support.attachmentLimit', { count: capabilities.maxCount }))
        break
      }
      if (file.size > capabilities.maxSizeBytes) {
        onError(
          t('support.attachmentTooLarge', { size: formatBytes(capabilities.maxSizeBytes) }),
        )
        continue
      }
      next.push(file)
    }
    onChange(next)
  }

  return (
    <div className="flex flex-col gap-1.5">
      {files.map((file, index) => (
        <div
          key={`${file.name}:${file.size}:${index}`}
          className="flex items-center gap-2.5 bg-background-card border border-border rounded-[10px] py-2 pl-3 pr-2"
        >
          <div className="w-8 h-8 rounded-[8px] bg-brand-50 flex items-center justify-center shrink-0">
            <ImageIcon className="w-4 h-4 text-brand" strokeWidth={1.6} />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-[13px] text-foreground truncate tracking-[-0.005em]">
              {file.name}
            </p>
            <p className="text-[11px] text-foreground-subtle mt-px">
              {formatBytes(file.size)}
            </p>
          </div>
          <button
            type="button"
            aria-label={t('support.removeAttachment')}
            disabled={disabled}
            onClick={() => onChange(files.filter((_, i) => i !== index))}
            className="w-6 h-6 rounded-full bg-[#F2F4F9] flex items-center justify-center shrink-0 disabled:opacity-50"
          >
            <X className="w-3 h-3 text-foreground-muted" strokeWidth={2} />
          </button>
        </div>
      ))}
      <button
        type="button"
        disabled={disabled || files.length >= capabilities.maxCount}
        onClick={() => inputRef.current?.click()}
        className="flex items-center justify-center gap-2 bg-background-card border border-dashed border-border rounded-[12px] py-3 text-[13px] font-medium text-foreground-muted tracking-[-0.005em] disabled:opacity-50 active:scale-[0.99] transition-transform"
      >
        <Paperclip className="w-4 h-4" strokeWidth={1.7} />
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

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}
