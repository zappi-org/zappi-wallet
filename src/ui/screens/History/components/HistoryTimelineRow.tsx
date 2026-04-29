import { ArrowDown, ArrowUp, RefreshCw, Undo2 } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { Transaction } from '@/core/domain/transaction'
import { getTotalCost, getTransactionType, getTxMeta } from '@/core/domain/transaction'
import { toNumber } from '@/core/domain/amount'
import { useFormatSats, useFormatFiat, formatTransactionFiat } from '@/utils/format'
import { formatMintHost } from '@/utils/url'
import { cn } from '@/ui/lib/utils'
import { getTitle, getTypeLabel } from '@/ui/components/wallet/transactionHelpers'

export interface HistoryTimelineRowProps {
  transaction: Transaction
  linkedTransaction?: Transaction | null
  groupKind: 'today' | 'yesterday' | 'monthThisYear' | 'monthPastYear'
  onClick?: () => void
  getMintName?: (url: string) => string
}

function formatRowTime(
  t: (key: string, opts?: Record<string, unknown>) => string,
  timestamp: number,
  groupKind: HistoryTimelineRowProps['groupKind'],
): string {
  const date = new Date(timestamp)
  const hours = date.getHours() < 10 ? `0${date.getHours()}` : String(date.getHours())
  const minutes = date.getMinutes() < 10 ? `0${date.getMinutes()}` : String(date.getMinutes())
  const time = `${hours}:${minutes}`
  if (groupKind === 'today' || groupKind === 'yesterday') {
    return t('history.timeAt', { time })
  }
  return t('history.dayWithTime', { day: date.getDate(), time })
}

export function HistoryTimelineRow({
  transaction: tx,
  linkedTransaction,
  groupKind,
  onClick,
  getMintName,
}: HistoryTimelineRowProps) {
  const { t } = useTranslation()
  const formatSats = useFormatSats()
  const formatFiat = useFormatFiat()

  const txType = getTransactionType(tx)
  const meta = getTxMeta(tx)
  const linkedMeta = linkedTransaction ? getTxMeta(linkedTransaction) : null
  const isReceive = tx.direction === 'receive'
  const isSwap = txType === 'swap'
  const isPending = tx.status === 'pending'
  const isFailed = tx.status === 'failed'
  const resolveName = (url: string) => getMintName ? getMintName(url) : formatMintHost(url)

  const swapFromUrl = meta.fromMintUrl ?? linkedMeta?.fromMintUrl ?? (tx.direction === 'send' ? tx.accountId : undefined)
  const swapToUrl = meta.toMintUrl ?? linkedMeta?.toMintUrl ?? (tx.direction === 'receive' ? tx.accountId : undefined)
  const swapRoute = isSwap && swapFromUrl && swapToUrl
    ? `${resolveName(swapFromUrl)} → ${resolveName(swapToUrl)}`
    : null

  const title = swapRoute ?? getTitle(tx, t)
  const typeLabel = getTypeLabel(tx, t)
  const time = formatRowTime(t, tx.createdAt, groupKind)
  const defaultSubtitle = title === typeLabel ? time : `${time} · ${typeLabel}`

  let subtitle: string
  if (isSwap && swapRoute) {
    subtitle = `${time} · ${typeLabel}`
  } else if (txType === 'lightning' && tx.direction === 'send' && meta.destination) {
    const destination = meta.destination.includes('@') ? meta.destination : `${meta.destination.slice(0, 20)}...`
    subtitle = `${time} · ${destination}`
  } else if (meta.source && meta.source !== 'unknown' && meta.source !== 'wallet') {
    subtitle = `${time} · ${t(`txDetail.source.${meta.source}`)}`
  } else {
    subtitle = defaultSubtitle
  }

  const amountSats = toNumber(getTotalCost(tx))
  const amountPrefix = isReceive ? '+ ' : '- '
  const amountColor = isFailed
    ? 'line-through text-foreground-muted'
    : isPending
      ? cn(isReceive ? 'text-primary' : 'text-foreground', 'opacity-60')
      : isReceive
        ? 'text-primary'
        : 'text-foreground'
  const fiatStr = formatTransactionFiat(tx.displaySnapshot, amountSats, formatFiat)

  const iconClasses = isFailed
    ? 'bg-accent-danger/10 text-accent-danger'
    : isPending
      ? 'bg-status-pending/10 text-status-pending'
      : isReceive
        ? 'bg-primary/10 text-primary'
        : 'bg-foreground/[0.06] text-foreground'

  const icon = meta.reclaimedFrom ? (
    <Undo2 className="size-4" strokeWidth={2.5} />
  ) : isSwap ? (
    <RefreshCw className="size-4" strokeWidth={2.5} />
  ) : isReceive ? (
    <ArrowDown className="size-4" strokeWidth={2.5} />
  ) : (
    <ArrowUp className="size-4" strokeWidth={2.5} />
  )

  return (
    <button
      type="button"
      onClick={onClick}
      className="flex w-full items-center gap-3 rounded-[20px] bg-background-card border border-border/60 px-3 py-2.5 text-left active:bg-background-hover/40 transition-colors"
    >
      <div className={cn('flex size-9 shrink-0 items-center justify-center rounded-full', iconClasses)}>
        {icon}
      </div>
      <div className="flex flex-1 items-start justify-between gap-2 min-w-0">
        <div className="flex flex-col gap-0.5 min-w-0">
          <span className="text-caption font-bold text-foreground truncate">
            {title}
          </span>
          <span className="text-overline text-foreground-muted truncate">
            {subtitle}
          </span>
        </div>
        <div className="flex flex-col gap-0.5 items-end text-right shrink-0">
          <div className="flex items-center gap-1.5">
            {isPending && <span className="w-1.5 h-1.5 rounded-full bg-status-pending animate-pulse" />}
            {isFailed && <span className="w-1.5 h-1.5 rounded-full bg-accent-danger" />}
            <span className={cn('text-body font-bold text-foreground', amountColor)}>
              {amountPrefix}{formatSats(amountSats)}
            </span>
          </div>
          {fiatStr && (
            <span className="text-overline text-foreground-muted">
              {fiatStr}
            </span>
          )}
        </div>
      </div>
    </button>
  )
}
