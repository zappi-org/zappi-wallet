import { memo } from 'react'
import { useTranslation } from 'react-i18next'
import type { TFunction } from 'i18next'
import { ArrowDownLeft, ArrowUpRight, ChevronUp } from 'lucide-react'
import { useFormatSats } from '@/utils/format'
import type { HomeRecentRow } from './homeRecentRow'
import { cn } from '@/ui/lib/utils'

const SECOND = 1000
const MINUTE = 60 * SECOND
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR

function getRelativeTime(ts: number, t: TFunction): string {
  const diff = Date.now() - ts
  if (diff < MINUTE) return t('notifications.justNow')
  if (diff < HOUR) return t('notifications.minAgo', { count: Math.floor(diff / MINUTE) })
  if (diff < DAY) return t('notifications.hourAgo', { count: Math.floor(diff / HOUR) })
  if (diff < 2 * DAY) return t('notifications.dayAgo', { count: 1 })
  return t('notifications.daysAgo', { count: Math.floor(diff / DAY) })
}

export interface HomeRecentCardProps {
  row: HomeRecentRow | null
  onPress?: () => void
  onSeeAll?: () => void
  className?: string
}

export const HomeRecentCard = memo(function HomeRecentCard({
  row,
  onPress,
  onSeeAll,
  className,
}: HomeRecentCardProps) {
  const { t } = useTranslation()
  const formatSats = useFormatSats()

  const isReceive = row?.isReceive ?? false
  const isPending = row?.state === 'pending'
  const isFailed = row?.state === 'failed'
  const relativeTime = row ? getRelativeTime(row.createdAt, t) : ''

  const amountSats = row?.amountSats ?? 0

  const amountPrefix = isReceive ? '' : '-'
  const amountColor = isFailed
    ? 'line-through text-foreground-muted'
    : isPending
      ? cn(isReceive ? 'text-[#648B59]' : 'text-foreground', 'opacity-60')
      : isReceive
        ? 'text-[#648B59]'
        : 'text-foreground'

  return (
    <div className={cn('shrink-0 pb-app-nav px-4 w-full max-w-sm mx-auto', className)}>
      {onSeeAll && (
        <div className="flex items-center justify-center px-5">
          {/* Padding, not glyph size: the chevron+label stay as drawn while the
              tap target reaches the 44px minimum. */}
          <button
            onClick={onSeeAll}
            className="flex min-h-11 min-w-11 flex-col items-center justify-center px-4 pb-1.5 active:opacity-60 transition-opacity"
            aria-label={t('home.seeAll')}
          >
            <ChevronUp className="w-5 h-5 text-foreground-muted" strokeWidth={2.5} />
            <span className="text-[11px] text-foreground-muted -mt-0.5">{t('home.seeAll')}</span>
          </button>
        </div>
      )}

      {row ? (
        <button
          onClick={onPress}
          className="relative w-full flex items-center gap-3 px-5 py-4 rounded-card overflow-hidden active:opacity-80 transition-opacity text-left"
          style={{
            background:
              'linear-gradient(180deg, #FFFFFF 40%, rgba(255,255,255,0) 100%)',
            boxShadow: '0 -1px 3px rgba(0,0,0,0.04)',
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
              {row.title}
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
      ) : (
        <div
          role="status"
          className="flex min-h-16 w-full items-center justify-center text-center"
        >
          <p className="text-caption text-foreground-muted">
            {t('home.noTransactions')}
          </p>
        </div>
      )}
    </div>
  )
})
