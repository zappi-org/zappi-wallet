import { useTranslation } from 'react-i18next'
import { PendingTokenCard } from './PendingTokenCard'
import { FirstCreateHint } from './FirstCreateHint'
import type { MockPendingToken } from '../types'

export interface ReclaimableSectionProps {
  tokens: MockPendingToken[]
  showFirstCreateHint?: boolean
  onDismissHint?: () => void
  onReclaim?: (token: MockPendingToken) => void
  onShare?: (token: MockPendingToken) => void
  onSelect?: (token: MockPendingToken) => void
}

export function ReclaimableSection({
  tokens,
  showFirstCreateHint = false,
  onDismissHint,
  onReclaim,
  onShare,
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

      {showFirstCreateHint && onDismissHint && (
        <FirstCreateHint onDismiss={onDismissHint} />
      )}

      {tokens.map((token) => (
        <PendingTokenCard
          key={token.id}
          token={token}
          onReclaim={onReclaim ? () => onReclaim(token) : undefined}
          onShare={onShare ? () => onShare(token) : undefined}
          onSelect={onSelect ? () => onSelect(token) : undefined}
        />
      ))}
    </section>
  )
}
