import type { TFunction } from 'i18next'
import { useTranslation } from 'react-i18next'
import type { Transaction } from '@/core/domain/transaction'
import { getTotalCost, getTransactionType, getTxMeta } from '@/core/domain/transaction'
import { toNumber } from '@/core/domain/amount'
import { useFormatSats, useFormatFiat, formatTransactionFiat } from '@/utils/format'
import { formatMintHost } from '@/utils/url'
import { cn } from '@/ui/lib/utils'
import { getTypeLabel } from '@/ui/components/wallet/transactionHelpers'
import type { TimelineKind } from '@/ui/hooks/use-transaction-history'

export interface HistoryTimelineRowProps {
  transaction: Transaction
  linkedTransaction?: Transaction | null
  groupKind: TimelineKind
  onClick?: () => void
  getMintName?: (url: string) => string
}

function formatRowTime(
  t: TFunction,
  timestamp: number,
  groupKind: HistoryTimelineRowProps['groupKind'],
): string {
  const date = new Date(timestamp)
  const hours = date.getHours() < 10 ? `0${date.getHours()}` : String(date.getHours())
  const minutes = date.getMinutes() < 10 ? `0${date.getMinutes()}` : String(date.getMinutes())
  const time = `${hours}:${minutes}`
  if (groupKind === 'today' || groupKind === 'yesterday' || groupKind === 'dayThisMonth') {
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
  const isEcashToken = txType === 'ecash-token'
  const isPending = tx.status === 'pending'
  const isFailed = tx.status === 'failed'
  const resolveName = (url: string) => getMintName ? getMintName(url) : formatMintHost(url)

  const transferFromUrl = meta.fromMintUrl ?? linkedMeta?.fromMintUrl ?? (tx.direction === 'send' ? tx.accountId : undefined)
  const transferToUrl = meta.toMintUrl ?? linkedMeta?.toMintUrl ?? (tx.direction === 'receive' ? tx.accountId : undefined)
  const transferRoute = (isSwap || isEcashToken) && transferFromUrl && transferToUrl
    ? `${resolveName(transferFromUrl)} → ${resolveName(transferToUrl)}`
    : null

  const title = tx.memo || getTypeLabel(tx, t)
  const typeLabel = getTypeLabel(tx, t)
  const time = formatRowTime(t, tx.createdAt, groupKind)

  const subtitle = transferRoute
    ? `${time} · ${transferRoute}`
    : title !== typeLabel
      ? `${time} · ${typeLabel}`
      : time

  const amountSats = toNumber(getTotalCost(tx))
  const amountPrefix = isReceive ? '' : '- '
  const amountColor = isFailed
    ? 'line-through text-foreground-muted'
    : isPending
      ? cn(isReceive ? 'text-[#4B85D3]' : 'text-[#272727]', 'opacity-60')
      : isReceive
        ? 'text-[#4B85D3]'
        : 'text-[#272727]'
  const fiatStr = formatTransactionFiat(tx.displaySnapshot, amountSats, formatFiat)
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex w-full items-start text-left active:opacity-60 transition-opacity"
    >
      <div className="flex-1 flex flex-col min-w-0">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-1.5 min-w-0">
            {isPending && (
              <span className="w-1.5 h-1.5 rounded-full shrink-0 mt-[5px] bg-status-pending animate-pulse" />
            )}
            <span className="text-[16px] leading-[19px] font-normal text-[#272727] truncate">
              {title}
            </span>
          </div>
          <span className={cn('text-[16px] leading-[19px] font-bold text-right shrink-0', amountColor)}>
            {amountPrefix}{formatSats(amountSats)}
          </span>
        </div>
        <div className="flex items-center justify-between gap-3 mt-[9px]">
          <span className="text-[13px] leading-[16px] font-normal text-[#656565] truncate">
            {subtitle}
          </span>
          {fiatStr && (
            <span className="text-[13px] leading-[16px] font-normal text-[#656565] text-right shrink-0">
              {fiatStr}
            </span>
          )}
        </div>
      </div>
    </button>
  )
}
