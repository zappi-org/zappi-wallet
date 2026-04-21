import { useTranslation } from 'react-i18next'
import { useFormatSats, useFormatFiat } from '@/utils/format'
import { toNumber } from '@/core/domain/amount'
import type { Transaction } from '@/core/domain/transaction'
import { transactionToDetailStatus, formatRelativeTime } from '../mockData'
import type { TokenDetailStatus } from '../types'

export interface TimelineRowProps {
  tx: Transaction
  onSelect?: () => void
}

const STATUS_KEY: Record<TokenDetailStatus, string> = {
  pending: 'token.history.status.registered', // not shown in timeline
  registered: 'token.history.status.registered',
  consumed: 'token.history.status.consumed',
  reclaimed: 'token.history.status.reclaimed',
}

export function TimelineRow({ tx, onSelect }: TimelineRowProps) {
  const { t } = useTranslation()
  const formatSats = useFormatSats()
  const formatFiat = useFormatFiat()

  const status = transactionToDetailStatus(tx) ?? 'registered'
  const amountSats = toNumber(tx.amount)
  const isOutgoing = tx.direction === 'send'
  // Ecash send settled: token consumed by recipient → display as outgoing
  // Reclaim restores balance → also outgoing-origin but net zero; keep sign for consistency
  const signedAmount = isOutgoing ? `- ${formatSats(amountSats)}` : formatSats(amountSats)
  const fiat = formatFiat(amountSats)

  return (
    <div
      role={onSelect ? 'button' : undefined}
      tabIndex={onSelect ? 0 : undefined}
      onClick={onSelect}
      onKeyDown={onSelect ? (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          onSelect()
        }
      } : undefined}
      className={`flex items-start justify-between rounded-card bg-background-card border border-border px-4 py-3 ${onSelect ? 'cursor-pointer hover:bg-background-hover/40 transition-colors' : ''}`}
    >
      <div className="flex flex-col gap-1 min-w-0">
        <span className="text-body-bold font-semibold text-foreground">
          {t(STATUS_KEY[status])}
        </span>
        <span className="text-caption text-foreground-muted truncate">
          {tx.memo && tx.memo.trim().length > 0
            ? t('token.history.metaLine', {
                time: formatRelativeTime(t, tx.createdAt),
                memo: tx.memo,
              })
            : formatRelativeTime(t, tx.createdAt)}
        </span>
      </div>
      <div className="flex flex-col gap-1 items-end text-right shrink-0">
        <span className="text-body-bold font-semibold text-foreground">
          {signedAmount}
        </span>
        {fiat && (
          <span className="text-caption text-foreground-muted">
            {fiat}
          </span>
        )}
      </div>
    </div>
  )
}
