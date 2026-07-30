import { useTranslation } from 'react-i18next'
import { PendingTokenCard } from './PendingTokenCard'
import type { PendingTokenView } from '../types'

export interface ReclaimableSectionProps {
  tokens: PendingTokenView[]
  onReclaim?: (token: PendingTokenView) => void
  onShare?: (token: PendingTokenView) => void
  /** Which token's share just landed — the row's own confirmation. */
  sharedId?: (token: PendingTokenView) => boolean
  onSelect?: (token: PendingTokenView) => void
  /** Bulk reclaim of every token in the section. */
  onReclaimAll?: () => void
}

export function ReclaimableSection({
  tokens,
  onReclaim,
  onShare,
  sharedId,
  onSelect,
  onReclaimAll,
}: ReclaimableSectionProps) {
  const { t } = useTranslation()

  return (
    <section className="flex flex-col gap-3">
      {/* Bulk action sits with the heading it acts on — same text-button
          affordance as the "see all" rows elsewhere. */}
      <header className="flex items-center justify-between gap-3">
        <h3 className="text-subtitle font-semibold text-foreground">
          {t('token.reclaimable.section', { count: tokens.length })}
        </h3>
        {onReclaimAll && tokens.length > 0 && (
          <button
            type="button"
            onClick={onReclaimAll}
            className="shrink-0 text-caption font-medium text-brand hover:text-brand-700 active:scale-95 transition-all"
          >
            {t('token.reclaimable.reclaimAll')}
          </button>
        )}
      </header>

      {tokens.map((token) => (
        <PendingTokenCard
          key={token.id}
          token={token}
          onReclaim={onReclaim ? () => onReclaim(token) : undefined}
          onShare={onShare ? () => onShare(token) : undefined}
          shared={sharedId?.(token) ?? false}
          onSelect={onSelect ? () => onSelect(token) : undefined}
        />
      ))}
    </section>
  )
}
