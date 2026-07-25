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
}

export function ReclaimableSection({
  tokens,
  onReclaim,
  onShare,
  sharedId,
  onSelect,
}: ReclaimableSectionProps) {
  const { t } = useTranslation()

  return (
    <section className="flex flex-col gap-3">
      <header>
        <h3 className="text-subtitle font-semibold text-foreground">
          {t('token.reclaimable.section', { count: tokens.length })}
        </h3>
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
