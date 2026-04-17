import { useTranslation } from 'react-i18next'
import { Share2 } from 'lucide-react'
import { useFormatSats, formatFiatAmount } from '@/utils/format'
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
  const fiatLabel =
    token.fiatUsd !== undefined ? formatFiatAmount(token.fiatUsd, 'USD') : null

  return (
    <div className="relative rounded-card bg-background-card border border-border px-4 py-4">
      <p className="text-caption text-foreground-muted">
        {t('token.pending.timeLabel', {
          time: formatRelativeTime(t, token.createdAt),
        })}
      </p>
      <p className="mt-1 text-amount font-display font-medium text-foreground">
        {formatSats(token.amount)}
        {fiatLabel && (
          <span className="ml-2 text-caption font-normal text-foreground-muted">
            ({fiatLabel})
          </span>
        )}
      </p>
      <p className="mt-1 text-body text-foreground-muted">{token.memo}</p>
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
          aria-label={t('token.reclaimable.actions.share')}
          className="px-2 py-1 rounded-full bg-background border border-border text-foreground hover:bg-background-hover transition-colors"
        >
          <Share2 size={14} />
        </button>
      </div>
    </div>
  )
}
