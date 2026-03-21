import { useMemo } from 'react'
import { cn } from '@/lib/utils'
import { useTranslation } from 'react-i18next'
import { Clock, ArrowDownLeft, ArrowUpRight, Zap } from 'lucide-react'
import { useFormatSats, useFormatFiat, formatDateLocalized } from '@/utils/format'
import { useMintMetadata } from '@/hooks'
import type { PendingItem } from '@/hooks/usePendingItems'

interface PendingItemsListProps {
  items: PendingItem[]
  mintUrl: string
  maxItems?: number
  onItemClick?: (item: PendingItem) => void
}

function formatExpiry(expiresAt: number, t: (key: string, opts?: Record<string, string>) => string): string | null {
  const remaining = expiresAt - Date.now()
  if (remaining <= 0) return null

  const hours = Math.floor(remaining / (1000 * 60 * 60))
  const minutes = Math.floor((remaining % (1000 * 60 * 60)) / (1000 * 60))

  if (hours > 0) {
    return t('mintDetail.expiresIn', { time: `${hours}h ${minutes}m` })
  }
  return t('mintDetail.expiresIn', { time: `${minutes}m` })
}

function getPendingIcon(type: PendingItem['type']) {
  switch (type) {
    case 'unclaimed-token':
      return { Icon: ArrowDownLeft, color: 'text-accent-success' } // green — receive
    case 'lightning-request':
      return { Icon: Zap, color: 'text-accent-success' }           // green — receive
    case 'ecash-request':
      return { Icon: ArrowUpRight, color: 'text-accent-warning' }  // gold — send
  }
}

export function PendingItemsList({ items, mintUrl, maxItems = 5, onItemClick }: PendingItemsListProps) {
  const { t, i18n } = useTranslation()
  const formatSats = useFormatSats()
  const toFiat = useFormatFiat()

  const displayed = items.slice(0, maxItems)

  const mintUrls = useMemo(() => [mintUrl], [mintUrl])
  const { getDisplayName } = useMintMetadata(mintUrls)

  if (displayed.length === 0) {
    return (
      <p className="text-caption text-foreground-muted text-center py-4">
        {t('mintDetail.noPendingItems')}
      </p>
    )
  }

  return (
    <div className="flex flex-col border border-border rounded-[13px] overflow-hidden gap-0">
      {displayed.map((item) => {
        const { Icon, color } = getPendingIcon(item.type)

        const title = item.memo
          || (item.type === 'unclaimed-token' ? t('mintDetail.ecashToken')
            : item.type === 'lightning-request' ? t('mintDetail.lightningRequest')
            : t('mintDetail.ecashRequest'))

        const subtitle = getDisplayName(mintUrl)
        const expiryStr = item.expiresAt ? formatExpiry(item.expiresAt, t) : null

        return (
          <div
            key={item.id}
            onClick={() => onItemClick?.(item)}
            className="flex items-center justify-between bg-background-card rounded-[16px] h-[75px] px-[16px] py-[12px] cursor-pointer"
          >
            <div className="flex items-center gap-[12px]">
              <div className={cn("w-[44px] h-[44px] rounded-full flex items-center justify-center shrink-0", item.type === 'ecash-request' ? "bg-accent-warning/10" : "bg-accent-success/10")}>
                <Icon size={20} strokeWidth={1.5} className={color} />
              </div>
              <div className="flex flex-col gap-[2px]">
                <h3 className="text-caption font-bold text-foreground leading-normal">
                  {title}
                </h3>
                <div className="flex items-center gap-1">
                  <p className="text-label text-foreground-muted truncate max-w-[140px] leading-normal">
                    {subtitle}
                  </p>
                  {expiryStr && (
                    <>
                      <span className="text-foreground-muted text-overline">·</span>
                      <span className="text-overline text-accent-danger leading-normal flex items-center gap-0.5">
                        <Clock size={10} strokeWidth={2} />
                        {expiryStr}
                      </span>
                    </>
                  )}
                </div>
              </div>
            </div>
            <div className="flex flex-col items-end gap-[2px]">
              <span className="font-semibold font-display text-caption text-foreground leading-normal">
                {item.type === 'ecash-request'
                  ? `- ${formatSats(item.amount)}`
                  : `+ ${formatSats(item.amount)}`
                }
              </span>
              {(() => {
                const fiatStr = toFiat(item.amount)
                return fiatStr ? (
                  <span className="text-overline text-foreground-muted/70 leading-normal">
                    {fiatStr}
                  </span>
                ) : null
              })()}
              <span className="text-label text-foreground-muted leading-normal">
                {formatDateLocalized(item.createdAt, i18n.language, t('history.today'), t('history.yesterday'))}
              </span>
            </div>
          </div>
        )
      })}
    </div>
  )
}
