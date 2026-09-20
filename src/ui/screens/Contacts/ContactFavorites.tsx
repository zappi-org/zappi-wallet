import { useTranslation } from 'react-i18next'
import type { Contact } from '@/core/types/contact'

export function ContactFavorites({
  contacts,
  hidden,
  onSelect,
}: {
  contacts: Contact[]
  hidden: boolean
  onSelect: (id: string) => void
}) {
  const { t } = useTranslation()
  const favorites = contacts.filter((contact) => contact.favorite)
  if (hidden || favorites.length === 0) return null
  return (
    <section className="px-4 pt-2 pb-5" aria-label={t('chat.favorites')}>
      <h2 className="text-caption font-semibold text-foreground-muted mb-3">
        {t('chat.favorites')}
      </h2>
      <div className="flex gap-4 overflow-x-auto">
        {favorites.map((contact) => (
          <button
            key={contact.id}
            onClick={() => onSelect(contact.id)}
            className="flex w-16 shrink-0 flex-col items-center gap-2"
          >
            <span
              aria-hidden="true"
              className="size-14 rounded-full bg-brand/10 text-brand font-semibold text-lg flex items-center justify-center"
            >
              {Array.from(contact.name).slice(0, 2).join('')}
            </span>
            <span className="text-caption w-full truncate">{contact.name}</span>
          </button>
        ))}
      </div>
    </section>
  )
}
