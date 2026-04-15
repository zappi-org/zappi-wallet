import { useTranslation } from 'react-i18next'
import { useFormatSats, useFormatFiat } from '@/utils/format'
import { formatRelativeTime } from '../mockData'
import type { MockTimelineEntry } from '../types'

export interface TimelineRowProps {
  entry: MockTimelineEntry
}

const STATUS_KEY: Record<MockTimelineEntry['status'], string> = {
  created: 'token.history.status.created',
  registered: 'token.history.status.registered',
  consumed: 'token.history.status.consumed',
  reclaimed: 'token.history.status.reclaimed',
}

const OUTGOING_STATUSES: ReadonlySet<MockTimelineEntry['status']> = new Set([
  'created',
  'consumed',
])

export function TimelineRow({ entry }: TimelineRowProps) {
  const { t } = useTranslation()
  const formatSats = useFormatSats()
  const formatFiat = useFormatFiat()

  const isOutgoing = OUTGOING_STATUSES.has(entry.status)
  const signedAmount = isOutgoing ? `- ${formatSats(entry.amount)}` : formatSats(entry.amount)
  const fiat = formatFiat(entry.amount)

  return (
    <div className="flex items-start justify-between rounded-card bg-background-card border border-border px-4 py-3">
      <div className="flex flex-col gap-1 min-w-0">
        <span className="text-body-bold font-semibold text-foreground">
          {t(STATUS_KEY[entry.status])}
        </span>
        <span className="text-caption text-foreground-muted truncate">
          {t('token.history.metaLine', {
            time: formatRelativeTime(t, entry.at),
            memo: entry.memo,
          })}
        </span>
      </div>
      <div className="flex flex-col gap-1 items-end text-right shrink-0">
        <span className="text-body-bold font-semibold text-foreground">
          {signedAmount}
        </span>
        <span className="text-caption text-foreground-muted">
          {fiat ? `${entry.counterparty} · ${fiat}` : entry.counterparty}
        </span>
      </div>
    </div>
  )
}
