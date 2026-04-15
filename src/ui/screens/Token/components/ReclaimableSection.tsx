import { useTranslation } from 'react-i18next'
import { PendingTokenCard } from './PendingTokenCard'
import { FirstCreateHint } from './FirstCreateHint'
import type { MockPendingToken } from '../types'

export interface ReclaimableSectionProps {
  tokens: MockPendingToken[]
  showFirstCreateHint?: boolean
  onDismissHint?: () => void
  onViewAll?: () => void
  onReclaim?: (token: MockPendingToken) => void
  onShare?: (token: MockPendingToken) => void
}

export function ReclaimableSection({
  tokens,
  showFirstCreateHint = false,
  onDismissHint,
  onViewAll,
  onReclaim,
  onShare,
}: ReclaimableSectionProps) {
  const { t } = useTranslation()

  return (
    <section className="flex flex-col gap-3">
      <header className="flex items-baseline justify-between">
        <h3 className="text-subtitle font-semibold text-foreground">
          {t('token.reclaimable.section', { count: tokens.length })}
        </h3>
        <button
          type="button"
          onClick={onViewAll}
          className="text-caption text-foreground-muted hover:text-foreground transition-colors"
        >
          {t('token.reclaimable.viewAll')}
        </button>
      </header>

      {showFirstCreateHint && onDismissHint && (
        <FirstCreateHint onDismiss={onDismissHint} />
      )}

      {tokens.map((token) => (
        <PendingTokenCard
          key={token.id}
          token={token}
          onReclaim={onReclaim ? () => onReclaim(token) : undefined}
          onShare={onShare ? () => onShare(token) : undefined}
        />
      ))}
    </section>
  )
}
