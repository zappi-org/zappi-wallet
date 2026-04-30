import { useRef } from 'react'
import { Paperclip, Send } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { cn } from '@/ui/primitives/utils'
import type { SupportSnapshot } from '@/core/domain/support'

type AttachmentCapabilities = SupportSnapshot['capabilities']['attachments']

interface CSChatInputProps {
  value: string
  onChange: (value: string) => void
  onSend: () => void
  files: File[]
  onFilesChange: (files: File[]) => void
  capabilities: AttachmentCapabilities
  disabled?: boolean
  placeholder?: string
  onAttachmentError: (message: string) => void
}

export function CSChatInput({
  value,
  onChange,
  onSend,
  files,
  onFilesChange,
  capabilities,
  disabled,
  placeholder,
  onAttachmentError,
}: CSChatInputProps) {
  const { t } = useTranslation()
  const inputRef = useRef<HTMLInputElement>(null)
  const sendable = (value.trim().length > 0 || files.length > 0) && !disabled

  const addFiles = (selected: FileList | null) => {
    if (!selected || selected.length === 0) return
    if (!capabilities.available) return
    const next = [...files]
    for (const file of Array.from(selected)) {
      if (next.length >= capabilities.maxCount) {
        onAttachmentError(t('support.attachmentLimit', { count: capabilities.maxCount }))
        break
      }
      if (file.size > capabilities.maxSizeBytes) {
        onAttachmentError(
          t('support.attachmentTooLarge', { size: formatBytes(capabilities.maxSizeBytes) }),
        )
        continue
      }
      next.push(file)
    }
    onFilesChange(next)
  }

  return (
    <div className="px-3.5 pt-2.5 pb-3">
      {files.length > 0 && (
        <div className="flex flex-wrap gap-1.5 mb-2">
          {files.map((file, index) => (
            <span
              key={`${file.name}:${file.size}:${index}`}
              className="inline-flex items-center gap-1.5 rounded-[8px] bg-background-card border border-border px-2 py-1 text-[11.5px] tracking-[-0.005em] text-brand-900"
            >
              <Paperclip className="w-3 h-3 text-foreground-muted" strokeWidth={1.7} />
              <span className="max-w-[140px] truncate">{file.name}</span>
              <button
                type="button"
                aria-label={t('support.removeAttachment')}
                onClick={() => onFilesChange(files.filter((_, i) => i !== index))}
                className="text-foreground-subtle"
              >
                ×
              </button>
            </span>
          ))}
        </div>
      )}
      <div className="flex items-end gap-2 bg-background border border-border rounded-[22px] pl-3.5 pr-1.5 py-1.5">
        {capabilities.available && (
          <button
            type="button"
            disabled={disabled || files.length >= capabilities.maxCount}
            onClick={() => inputRef.current?.click()}
            aria-label={t('support.attachFile')}
            className="w-8 h-8 flex items-center justify-center shrink-0 disabled:opacity-50"
          >
            <Paperclip className="w-[18px] h-[18px] text-foreground-muted" strokeWidth={1.7} />
          </button>
        )}
        <textarea
          value={value}
          onChange={(event) => onChange(event.target.value)}
          rows={1}
          placeholder={placeholder ?? t('support.replyPlaceholder')}
          disabled={disabled}
          className="flex-1 bg-transparent border-none outline-none resize-none py-2 text-[13.5px] leading-[1.5] text-foreground placeholder:text-foreground-subtle tracking-[-0.005em]"
          style={{ maxHeight: 80 }}
        />
        <button
          type="button"
          onClick={onSend}
          disabled={!sendable}
          aria-label={t('support.sendMessage')}
          className={cn(
            'w-9 h-9 rounded-full flex items-center justify-center shrink-0 transition-colors',
            sendable ? 'bg-brand text-white' : 'bg-[#D7D9E5] text-white cursor-not-allowed',
          )}
        >
          <Send className="w-[14px] h-[14px]" strokeWidth={1.8} />
        </button>
      </div>
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
