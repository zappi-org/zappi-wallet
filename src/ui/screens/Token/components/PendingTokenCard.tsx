import { useTranslation } from 'react-i18next'
import { useFormatSats } from '@/utils/format'
import { formatRelativeTime } from '../mockData'
import type { MockPendingToken } from '../types'

export interface PendingTokenCardProps {
  token: MockPendingToken
  onReclaim?: () => void
  onShare?: () => void
}

export function PendingTokenCard({ token, onReclaim, onShare }: PendingTokenCardProps) {
  const { t } = useTranslation()
  const formatSats = useFormatSats()

  return (
    <div className="relative rounded-card bg-background-card border border-border px-4 py-4">
      <p className="text-caption text-foreground-muted">
        {t('token.pending.timeLabel', {
          time: formatRelativeTime(t, token.createdAt),
        })}
      </p>
      <p className="mt-1 text-amount font-display font-medium text-foreground">
        {formatSats(token.amount)}
      </p>
      <p className="mt-1 text-body text-foreground-muted">
        {t('token.pending.memoLine', {
          memo: token.memo,
          counterparty: token.counterparty,
        })}
      </p>
      <div className="absolute right-3 bottom-3 flex items-center gap-2">
        <button
          type="button"
          onClick={onReclaim}
          className="px-3 py-1 rounded-full bg-background border border-border text-label text-foreground hover:bg-background-hover transition-colors"
        >
          {t('token.reclaimable.actions.reclaim')}
        </button>
        <button
          type="button"
          onClick={onShare}
          className="px-3 py-1 rounded-full bg-background border border-border text-label text-foreground hover:bg-background-hover transition-colors"
        >
          {t('token.reclaimable.actions.share')}
        </button>
      </div>
    </div>
  )
}
