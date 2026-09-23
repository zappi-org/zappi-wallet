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
      <div className="flex gap-3 overflow-x-auto p-1 -m-1">
        {favorites.map((contact) => (
          <button
            key={contact.id}
            type="button"
            onClick={() => onSelect(contact.id)}
            className="flex h-36 w-28 shrink-0 flex-col items-center gap-3 rounded-2xl border border-border bg-background-card px-3 py-4 transition-colors hover:border-brand/40 hover:bg-brand/5 active:bg-brand/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2"
          >
            <span
              aria-hidden="true"
              className="size-14 shrink-0 rounded-full bg-brand/10 text-brand font-semibold text-lg flex items-center justify-center"
            >
              {Array.from(contact.name).slice(0, 2).join('')}
            </span>
            <span className="text-caption w-full line-clamp-2 break-keep leading-5 [overflow-wrap:anywhere]">{contact.name}</span>
          </button>
        ))}
      </div>
    </section>
  )
}
