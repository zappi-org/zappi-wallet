/**
 * TransactionRow — Toss-style transaction row component
 * Shared between TransactionList (mini) and HistoryScreen (full).
 *
 * Layout:
 *   Title (body, semibold)                 1,000 sats (amount, display, green)
 *   10:35 | Lightning 수신 (label, muted)    ≈ $0.50 (label, muted)
 */

import { memo } from 'react'
import { useTranslation } from 'react-i18next'
import type { Transaction } from '@/core/types'
import { useFormatSats, useFormatFiat, formatTransactionFiat, getLocaleCode } from '@/utils/format'
import { formatMintHost } from '@/utils/url'
import { formatMD } from '@/utils/dateFilter'
import { cn } from '@/lib/utils'
import { getTitle, getTypeLabel } from './transactionHelpers'

// ─── Component ───

export interface TransactionRowProps {
  transaction: Transaction
  onClick?: () => void
  getMintName?: (url: string) => string
  /** Show M.DD date prefix in subtitle (for mini lists without date group headers) */
  showDate?: boolean
}

export const TransactionRow = memo(function TransactionRow({
  transaction: tx,
  onClick,
  getMintName,
  showDate = false,
}: TransactionRowProps) {
  const { t, i18n } = useTranslation()
  const formatSats = useFormatSats()
  const formatFiat = useFormatFiat()

  const isSwap = tx.type === 'swap'
  const isReceive = tx.direction === 'receive'
  const title = getTitle(tx, t)
  const locale = getLocaleCode(i18n.language)
  const date = new Date(tx.createdAt)
  const timeOnly = date.toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' })
  const timeStr = showDate ? `${formatMD(date)} ${timeOnly}` : timeOnly
  const typeLabel = getTypeLabel(tx, t)

  // Subtitle: "10:35 | Lightning 수신" or swap flow
  const resolveName = (url: string) => getMintName ? getMintName(url) : formatMintHost(url)

  let subtitle: string
  if (isSwap) {
    const fromUrl = (tx.metadata?.fromMintUrl as string) || tx.mintUrl
    const toUrl = tx.metadata?.toMintUrl as string
    subtitle = `${timeStr} | ${resolveName(fromUrl)} → ${toUrl ? resolveName(toUrl) : ''}`
  } else if (tx.type === 'lightning' && tx.direction === 'send' && tx.metadata?.destination) {
    const dest = tx.metadata.destination as string
    const destStr = dest.includes('@') ? dest : `${dest.slice(0, 20)}...`
    subtitle = `${timeStr} | ${destStr}`
  } else if (tx.source && tx.source !== 'unknown' && tx.source !== 'wallet') {
    subtitle = `${timeStr} | ${t(`txDetail.source.${tx.source}`)}`
  } else {
    subtitle = `${timeStr} | ${typeLabel}`
  }

  // Amount styling — Toss pattern: receive = green (no sign), send = black with "-"
  const isPending = tx.status === 'pending'
  const isFailed = tx.status === 'failed'

  const amountPrefix = isSwap ? '' : isReceive ? '' : '-'
  const amountColor = isFailed ? 'line-through text-foreground-muted'
    : isSwap ? 'text-foreground-muted'
    : isPending ? cn(isReceive ? 'text-primary' : 'text-foreground', 'opacity-60')
    : isReceive ? 'text-primary' : 'text-foreground'
  const fiatStr = formatTransactionFiat(tx, formatFiat)

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
            {amountPrefix}{formatSats(tx.amount)}
          </span>
        </div>
        {fiatStr && <span className="text-label font-medium text-foreground-muted/70 leading-normal">{fiatStr}</span>}
      </div>
    </button>
  )
})
