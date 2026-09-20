import { useState } from 'react'
import { MessageCircle, Pencil, Star, Trash2 } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { BottomSheet } from '@/ui/components/common/BottomSheet'
import type { Contact } from '@/core/types/contact'

export function ContactActionsSheet({
  contact,
  onClose,
  onChat,
  onSend,
  onEdit,
  onToggleFavorite,
  onDelete,
}: {
  contact: Contact | null
  onClose: () => void
  onChat?: () => void
  onSend?: () => void
  onEdit: () => void
  onToggleFavorite: () => Promise<void>
  onDelete: () => void
}) {
  const { t } = useTranslation()
  const [saving, setSaving] = useState(false)
  return (
    <BottomSheet
      isOpen={!!contact}
      onClose={onClose}
      title={contact?.name}
      portal
      closeWhenCovered
    >
      {contact && (
        <div className="px-5 pb-6">
          <div className="flex flex-col items-center gap-3 py-4">
            <span
              aria-hidden="true"
              className="size-16 rounded-full flex items-center justify-center bg-brand/10 text-brand text-xl font-semibold"
            >
              {Array.from(contact.name).slice(0, 2).join('')}
            </span>
            {contact.address && (
              <p className="max-w-full break-all text-center text-caption text-foreground-muted">
                {contact.address}
              </p>
            )}
          </div>
          <div className="flex gap-3 mb-4">
            {onSend && (
              <button
                className="flex flex-1 items-center justify-center gap-2 rounded-card bg-brand/10 text-brand py-3 font-semibold"
                onClick={onSend}
              >
                {t('chat.sendMoney')}
              </button>
            )}{' '}
            {onChat && (
              <button
                className="flex flex-1 items-center justify-center gap-2 rounded-card bg-brand text-white py-3 font-semibold"
                onClick={onChat}
              >
                <MessageCircle size={18} />
                {t('chat.title')}
              </button>
            )}
          </div>
          <button
            onClick={onEdit}
            className="flex w-full items-center gap-3 py-4 text-body"
          >
            <Pencil size={19} />
            {t('contacts.editContact')}
          </button>
          <button
            disabled={saving}
            onClick={async () => {
              setSaving(true)
              try {
                await onToggleFavorite()
              } finally {
                setSaving(false)
              }
            }}
            className="flex w-full items-center gap-3 py-4 text-body"
          >
            <Star
              size={19}
              fill={contact.favorite ? 'currentColor' : 'none'}
            />
            {t(contact.favorite ? 'chat.unfavorite' : 'chat.favorite')}
          </button>{' '}
          <button
            onClick={onDelete}
            className="flex w-full items-center gap-3 border-t border-border/40 py-4 text-body text-accent-danger"
          >
            <Trash2 size={19} />
            {t('common.delete')}
          </button>
        </div>
      )}
    </BottomSheet>
  )
}
