import { useTranslation } from 'react-i18next'
import { ArrowDown, ArrowUp, Undo2 } from 'lucide-react'
import { useFormatSats, useFormatFiat } from '@/utils/format'
import { toNumber } from '@/core/domain/amount'
import type { Transaction } from '@/core/domain/transaction'
import { transactionToDetailStatus } from '../mockData'
import type { TokenDetailStatus } from '../types'
import type { TimelineKind } from '@/ui/hooks/use-transaction-history'

export interface TimelineRowProps {
  tx: Transaction
  groupKind: TimelineKind
  onSelect?: () => void
}

function formatTimelineTime(
  t: (key: string, opts?: Record<string, unknown>) => string,
  timestamp: number,
  kind: TimelineKind,
): string {
  const d = new Date(timestamp)
  const hh = d.getHours() < 10 ? `0${d.getHours()}` : String(d.getHours())
  const mm = d.getMinutes() < 10 ? `0${d.getMinutes()}` : String(d.getMinutes())
  const time = `${hh}:${mm}`
  if (kind === 'today' || kind === 'yesterday') {
    return t('token.time.atTimeOfDay', { time })
  }
  return t('token.time.dayWithTime', { day: d.getDate(), time })
}

type RowKind = 'received' | 'sent' | 'reclaimed'

const STATUS_KEY: Record<RowKind, string> = {
  received: 'token.history.status.registered', // 등록함
  sent: 'token.history.status.consumed', // 사용됨
  reclaimed: 'token.history.status.reclaimed', // 되찾음
}

function rowKind(tx: Transaction, status: TokenDetailStatus): RowKind {
  if (status === 'reclaimed') return 'reclaimed'
  return tx.direction === 'send' ? 'sent' : 'received'
}

export function TimelineRow({ tx, groupKind, onSelect }: TimelineRowProps) {
  const { t } = useTranslation()
  const formatSats = useFormatSats()
  const formatFiat = useFormatFiat()

  const status = transactionToDetailStatus(tx) ?? 'registered'
  const kind = rowKind(tx, status)
  const amountSats = toNumber(tx.amount)
  const isOutflow = kind === 'sent'
  const sign = kind === 'reclaimed' ? '' : isOutflow ? '- ' : '+ '
  const signedAmount = `${sign}${formatSats(amountSats)}`
  const fiat = formatFiat(amountSats)

  const statusLabel = t(STATUS_KEY[kind])
  const time = formatTimelineTime(t, tx.createdAt, groupKind)
  const memo = tx.memo?.trim()
  const hasMemo = !!memo && memo.length > 0
  const title = hasMemo ? memo : statusLabel
  const subLine = hasMemo
    ? t('token.history.subLine', { status: statusLabel, time })
    : time

  const iconClasses =
    kind === 'sent'
      ? 'bg-badge-lightning-bg text-foreground'
      : 'bg-muted text-foreground-muted'

  const icon =
    kind === 'reclaimed' ? (
      <Undo2 className="size-4" strokeWidth={2.5} />
    ) : kind === 'sent' ? (
      <ArrowUp className="size-4" strokeWidth={2.5} />
    ) : (
      <ArrowDown className="size-4" strokeWidth={2.5} />
    )

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
      className={`flex items-center gap-3 rounded-[20px] bg-background-card border border-border/60 px-3 py-2.5 ${onSelect ? 'cursor-pointer hover:bg-background-hover/40 transition-colors' : ''}`}
    >
      <div className={`flex size-9 shrink-0 items-center justify-center rounded-full ${iconClasses}`}>
        {icon}
      </div>
      <div className="flex flex-1 items-start justify-between gap-2 min-w-0">
        <div className="flex flex-col gap-0.5 min-w-0">
          <span className="text-caption font-bold text-foreground truncate">
            {title}
          </span>
          <span className="text-overline text-foreground-muted truncate">
            {subLine}
          </span>
        </div>
        <div className="flex flex-col gap-0.5 items-end text-right shrink-0">
          <span className="text-body font-bold text-foreground">
            {signedAmount}
          </span>
          {fiat && (
            <span className="text-overline text-foreground-muted">
              {fiat}
            </span>
          )}
        </div>
      </div>
    </div>
  )
}
