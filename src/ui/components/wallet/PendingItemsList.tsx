import { useTranslation } from 'react-i18next'
import { useFormatSats, getLocaleCode } from '@/utils/format'
import { cn } from '@/ui/lib/utils'
import { formatMD } from '@/utils/dateFilter'
import type { PendingItem } from '@/ui/hooks/usePendingItems'

interface PendingItemsListProps {
  items: PendingItem[]
  maxItems?: number
  showDate?: boolean
  onItemClick?: (item: PendingItem) => void
}

function getItemTypeLabel(item: PendingItem, t: (key: string) => string): string {
  if (item.direction === 'receive' && item.kind === 'token') return t('mintDetail.ecashToken')
  if (item.direction === 'receive' && item.kind === 'request') return t('mintDetail.receiveRequest')
  return t('mintDetail.sentToken')
}

function getItemTitle(item: PendingItem, t: (key: string) => string): string {
  return item.memo || getItemTypeLabel(item, t)
}

function formatExpiry(expiresAt: number): string | null {
  const remaining = expiresAt - Date.now()
  if (remaining <= 0) return null
  const hours = Math.floor(remaining / (1000 * 60 * 60))
  const minutes = Math.floor((remaining % (1000 * 60 * 60)) / (1000 * 60))
  if (hours > 0) return `${hours}h ${minutes}m`
  return `${minutes}m`
}

export function PendingItemsList({ items, maxItems = 5, showDate = false, onItemClick }: PendingItemsListProps) {
  const { t, i18n } = useTranslation()
  const formatSats = useFormatSats()
  const locale = getLocaleCode(i18n.language)

  const displayed = items.slice(0, maxItems)

  if (displayed.length === 0) {
    return (
      <p className="text-caption text-foreground-muted text-center py-4">
        {t('mintDetail.noPendingItems')}
      </p>
    )
  }

  return (
    <div className="flex flex-col">
      {displayed.map((item, index) => {
        const isSend = item.direction === 'send'
        const title = getItemTitle(item, t)
        const typeLabel = getItemTypeLabel(item, t)
        const date = new Date(item.createdAt)
        const timeOnly = date.toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' })
        const timeStr = showDate ? `${formatMD(date)} ${timeOnly}` : timeOnly
        const expiryStr = item.expiresAt ? formatExpiry(item.expiresAt) : null
        const isLast = index === displayed.length - 1

        // Subtitle: "10:35 | 미수령 토큰" or "10:35 | 미수령 토큰 · 만료 2h 30m"
        const subtitle = expiryStr
          ? `${timeStr} | ${typeLabel} · ${t('mintDetail.pendingExpiry')} ${expiryStr}`
          : `${timeStr} | ${typeLabel}`

        return (
          <div key={item.id}>
            <button
              onClick={() => onItemClick?.(item)}
              className="w-full flex items-center justify-between py-3.5 px-4 min-h-[44px] cursor-pointer active:bg-foreground/[0.02] transition-colors"
            >
              {/* Left: title + subtitle */}
              <div className="flex flex-col gap-0.5 text-left min-w-0 flex-1 mr-4">
                <span className="text-body font-semibold text-foreground leading-normal truncate">{title}</span>
                <span className="text-label font-medium text-foreground-muted leading-normal truncate">{subtitle}</span>
              </div>

              {/* Right: amount + status */}
              <div className="flex flex-col items-end gap-0.5 shrink-0">
                <div className="flex items-center gap-1.5">
                  <span className="w-1.5 h-1.5 rounded-full bg-status-pending animate-pulse" />
                  <span className={cn(
                    'text-amount font-semibold font-display leading-normal opacity-60',
                    isSend ? 'text-foreground' : 'text-primary',
                  )}>
                    {isSend ? `-${formatSats(item.amount)}` : formatSats(item.amount)}
                  </span>
                </div>
                <span className="text-label font-medium text-foreground-muted leading-normal">
                  {t('mintDetail.pending')}
                </span>
              </div>
            </button>
            {!isLast && <div className="h-px bg-border/30 mx-4" />}
          </div>
        )
      })}
    </div>
  )
}
