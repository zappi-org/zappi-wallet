import { memo } from 'react'
import { useTranslation } from 'react-i18next'
import { ArrowDownLeft, ArrowUpRight } from 'lucide-react'
import type { Transaction } from '@/core/domain/transaction'
import { getTransactionType, getTxMeta, getTotalCost } from '@/core/domain/transaction'
import { toNumber } from '@/core/domain/amount'
import { useFormatSats } from '@/utils/format'
import { getTypeLabel } from './transactionHelpers'
import { cn } from '@/ui/lib/utils'

const SECOND = 1000
const MINUTE = 60 * SECOND
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR

function getRelativeTime(ts: number, t: (key: string, opts?: Record<string, unknown>) => string): string {
  const diff = Date.now() - ts
  if (diff < MINUTE) return t('notifications.justNow')
  if (diff < HOUR) return t('notifications.minAgo', { count: Math.floor(diff / MINUTE) })
  if (diff < DAY) return t('notifications.hourAgo', { count: Math.floor(diff / HOUR) })
  if (diff < 2 * DAY) return t('notifications.dayAgo', { count: 1 })
  return t('notifications.daysAgo', { count: Math.floor(diff / DAY) })
}

export interface HomeRecentCardProps {
  transaction: Transaction
  dateLabel: string
  onPress?: () => void
  onSeeAll?: () => void
  className?: string
}

export const HomeRecentCard = memo(function HomeRecentCard({
  transaction: tx,
  dateLabel,
  onPress,
  onSeeAll,
  className,
}: HomeRecentCardProps) {
  const { t } = useTranslation()
  const formatSats = useFormatSats()

  const txType = getTransactionType(tx)
  const meta = getTxMeta(tx)
  const isReceive = tx.direction === 'receive'
  const isPending = tx.status === 'pending'
  const isFailed = tx.status === 'failed'
  const typeLabel = getTypeLabel(tx, t)
  const relativeTime = getRelativeTime(tx.createdAt, t)

  const amountSats = toNumber(getTotalCost(tx))

  const amountPrefix = isReceive ? '' : '-'
  const amountColor = isFailed
    ? 'line-through text-foreground-muted'
    : isPending
      ? cn(isReceive ? 'text-[#648B59]' : 'text-foreground', 'opacity-60')
      : isReceive
        ? 'text-[#648B59]'
        : 'text-foreground'

  const isSwap = txType === 'swap'
  const swapFromUrl = meta.fromMintUrl ?? (tx.direction === 'send' ? tx.accountId : undefined)
  const swapToUrl = meta.toMintUrl ?? (tx.direction === 'receive' ? tx.accountId : undefined)
  const swapActive = isSwap && swapFromUrl && swapToUrl

  const displayTitle = swapActive
    ? typeLabel
    : (tx.memo || typeLabel)

  return (
    <div className={cn('shrink-0 pb-app-nav px-4 w-full max-w-sm mx-auto', className)}>
      <div className="flex items-center justify-between mb-2 px-5">
        <span className="text-label text-foreground">{dateLabel}</span>
        {onSeeAll && (
          <button
            onClick={onSeeAll}
            className="text-label text-foreground active:opacity-60 transition-opacity"
          >
            {t('home.seeAll')}
          </button>
        )}
      </div>

      <button
        onClick={onPress}
        className="relative w-full flex items-center gap-3 px-5 py-3.5 rounded-card overflow-hidden active:opacity-80 transition-opacity text-left"
        style={{
          background:
            'linear-gradient(180deg, #FFFFFF 40%, rgba(255,255,255,0) 100%)',
        }}
      >
        <div className="w-[30px] h-[30px] rounded-[12px] flex items-center justify-center shrink-0 bg-background">
          {isReceive ? (
            <ArrowDownLeft className="w-4 h-4 text-[#648B59]" strokeWidth={2.5} />
          ) : (
            <ArrowUpRight className="w-4 h-4 text-foreground" strokeWidth={2.5} />
          )}
        </div>

        <div className="flex flex-col min-w-0 flex-1">
          <span className="text-label text-foreground truncate">
            {displayTitle}
          </span>
          <span className="text-label text-foreground truncate">
            {relativeTime}
          </span>
        </div>

        <div className="flex flex-col items-end shrink-0">
          <div className="flex items-center gap-1">
            {isPending && (
              <span className="w-1.5 h-1.5 rounded-full bg-status-pending animate-pulse" />
            )}
            {isFailed && (
              <span className="w-1.5 h-1.5 rounded-full bg-accent-danger" />
            )}
            <span className={cn('text-body font-semibold', amountColor)}>
              {amountPrefix}{formatSats(amountSats)}
            </span>
          </div>
        </div>
      </button>
    </div>
  )
})
