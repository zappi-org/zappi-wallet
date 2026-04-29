/**
 * TransactionRow — Toss-style transaction row component
 * Shared between TransactionList (mini) and HistoryScreen (full).
 *
 * Layout:
 *   Title (body, semibold)                 1,000 sats (amount, display, green)
 *   10:35 · 수신 (라이트닝) (label, muted)    ≈ $0.50 (label, muted)
 */

import { memo } from 'react'
import { useTranslation } from 'react-i18next'
import type { Transaction } from '@/core/domain/transaction'
import { getTransactionType, getTxMeta, getTotalCost } from '@/core/domain/transaction'
import { toNumber } from '@/core/domain/amount'
import { useFormatSats, useFormatFiat, formatTransactionFiat, getLocaleCode } from '@/utils/format'
import { formatMintHost } from '@/utils/url'
import { formatMD } from '@/ui/utils/dateFilter'
import { cn } from '@/ui/lib/utils'
import { getTitle, getTypeLabel } from './transactionHelpers'

// ─── Component ───

export interface TransactionRowProps {
  transaction: Transaction
  linkedTransaction?: Transaction | null
  onClick?: () => void
  getMintName?: (url: string) => string
  /** Show M.DD date prefix in subtitle (for mini lists without date group headers) */
  showDate?: boolean
}

export const TransactionRow = memo(function TransactionRow({
  transaction: tx,
  linkedTransaction,
  onClick,
  getMintName,
  showDate = false,
}: TransactionRowProps) {
  const { t, i18n } = useTranslation()
  const formatSats = useFormatSats()
  const formatFiat = useFormatFiat()

  const txType = getTransactionType(tx)
  const meta = getTxMeta(tx)
  const linkedMeta = linkedTransaction ? getTxMeta(linkedTransaction) : null
  const isSwap = txType === 'swap'
  const isReceive = tx.direction === 'receive'
  const locale = getLocaleCode(i18n.language)
  const date = new Date(tx.createdAt)
  const timeOnly = date.toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' })
  const timeStr = showDate ? `${formatMD(date)} ${timeOnly}` : timeOnly
  const typeLabel = getTypeLabel(tx, t)
  const resolveName = (url: string) => getMintName ? getMintName(url) : formatMintHost(url)
  const swapFromUrl = meta.fromMintUrl ?? linkedMeta?.fromMintUrl ?? (tx.direction === 'send' ? tx.accountId : undefined)
  const swapToUrl = meta.toMintUrl ?? linkedMeta?.toMintUrl ?? (tx.direction === 'receive' ? tx.accountId : undefined)
  const swapRoute = isSwap && swapFromUrl && swapToUrl
    ? `${resolveName(swapFromUrl)} → ${resolveName(swapToUrl)}`
    : null
  const title = swapRoute ?? getTitle(tx, t)
  const defaultSubtitle = title === typeLabel ? timeStr : `${timeStr} · ${typeLabel}`

  // Subtitle: "10:35 · 수신 (라이트닝)" or swap flow
  let subtitle: string
  if (isSwap && swapRoute) {
    subtitle = `${timeStr} · ${typeLabel}`
  } else if (txType === 'lightning' && tx.direction === 'send' && meta.destination) {
    const destStr = meta.destination.includes('@') ? meta.destination : `${meta.destination.slice(0, 20)}...`
    subtitle = `${timeStr} · ${destStr}`
  } else if (meta.source && meta.source !== 'unknown' && meta.source !== 'wallet') {
    subtitle = `${timeStr} · ${t(`txDetail.source.${meta.source}`)}`
  } else {
    subtitle = defaultSubtitle
  }

  // Amount styling — Toss pattern: receive = green (no sign), send = black with "-"
  const isPending = tx.status === 'pending'
  const isFailed = tx.status === 'failed'

  const amountPrefix = isReceive ? '' : '-'
  const amountColor = isFailed ? 'line-through text-foreground-muted'
    : isPending ? cn(isReceive ? 'text-primary' : 'text-foreground', 'opacity-60')
    : isReceive ? 'text-primary' : 'text-foreground'
  const amountSats = toNumber(getTotalCost(tx))
  const fiatStr = formatTransactionFiat(tx.displaySnapshot, amountSats, formatFiat)

  return (
    <button
      onClick={onClick}
      className="w-full flex items-center justify-between py-3.5 px-0.5 min-h-[44px] cursor-pointer active:bg-foreground/[0.02] transition-colors"
    >
      {/* Left: title + subtitle */}
      <div className="flex flex-col gap-0.5 text-left min-w-0 flex-1 mr-4">
        <span className="text-body font-semibold text-foreground leading-normal truncate">{title}</span>
        <span className="text-label font-medium text-foreground-muted leading-normal truncate">{subtitle}</span>
      </div>

      {/* Right: amount + fiat */}
      <div className="flex flex-col items-end gap-0.5 shrink-0">
        <div className="flex items-center gap-1.5">
          {isPending && <span className="w-1.5 h-1.5 rounded-full bg-status-pending animate-pulse" />}
          {isFailed && <span className="w-1.5 h-1.5 rounded-full bg-accent-danger" />}
          <span className={cn('text-amount font-semibold font-display leading-normal', amountColor)}>
            {amountPrefix}{formatSats(amountSats)}
          </span>
        </div>
        {fiatStr && <span className="text-label font-medium text-foreground-muted/70 leading-normal">{fiatStr}</span>}
      </div>
    </button>
  )
})
