import { useTranslation } from 'react-i18next'
import { Clock, Banknote } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useFormatSats } from '@/utils/format'
import { useMintMetadata } from '@/hooks'
import type { PendingItem } from '@/hooks/usePendingItems'

interface PendingItemsListProps {
  items: PendingItem[]
  mintUrl: string
  maxItems?: number
}

function formatRelativeDate(timestamp: number, t: (key: string) => string): string {
  const now = new Date()
  const date = new Date(timestamp)
  const isToday = now.toDateString() === date.toDateString()
  const yesterday = new Date(now)
  yesterday.setDate(yesterday.getDate() - 1)
  const isYesterday = yesterday.toDateString() === date.toDateString()

  const time = date.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })

  if (isToday) return `${t('mintDetail.created').replace('{{date}}', '')}${time}`
  if (isYesterday) return `${date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}, ${time}`
  return `${date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}, ${time}`
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

function MintLogo({ mintUrl }: { mintUrl: string }) {
  const { getIconUrl } = useMintMetadata([mintUrl])
  const iconUrl = getIconUrl(mintUrl)

  if (iconUrl) {
    return (
      <img
        src={iconUrl}
        alt=""
        className="w-5 h-5 rounded-full object-cover"
        onError={(e) => { e.currentTarget.style.display = 'none' }}
      />
    )
  }

  return <Banknote className="w-5 h-5 text-white" />
}

export function PendingItemsList({ items, mintUrl, maxItems = 5 }: PendingItemsListProps) {
  const { t } = useTranslation()
  const formatSats = useFormatSats()

  const displayed = items.slice(0, maxItems)

  if (displayed.length === 0) {
    return (
      <p className="text-sm text-[#86868b] text-center py-4">
        {t('mintDetail.noPendingItems')}
      </p>
    )
  }

  return (
    <div className="flex flex-col gap-2">
      {displayed.map((item) => {
        const isToken = item.type === 'unclaimed-token'
        const title = item.memo
          || (item.type === 'unclaimed-token' ? t('mintDetail.ecashToken')
            : item.type === 'lightning-request' ? t('mintDetail.lightningRequest')
            : t('mintDetail.ecashRequest'))

        const dateStr = formatRelativeDate(item.createdAt, t)
        const expiryStr = item.expiresAt ? formatExpiry(item.expiresAt, t) : null

        return (
          <div
            key={item.id}
            className="bg-white flex items-center justify-between px-4 py-3 rounded-xl"
          >
            <div className="flex gap-3 items-center min-w-0">
              <div className={cn(
                'w-9 h-9 rounded-full flex items-center justify-center shrink-0',
                isToken ? 'bg-[#1d1d1f]' : 'bg-[#86868b]'
              )}>
                {isToken ? (
                  <MintLogo mintUrl={mintUrl} />
                ) : (
                  <Clock className="w-5 h-5 text-white" />
                )}
              </div>
              <div className="min-w-0">
                <p className="font-['Outfit'] font-medium text-sm text-[#1d1d1f] truncate">
                  {title}
                </p>
                <p className="font-['Outfit'] text-xs text-[#86868b]">
                  {dateStr}
                  {expiryStr && (
                    <span className="text-[#e85d3a] ml-2">{expiryStr}</span>
                  )}
                </p>
              </div>
            </div>
            <p className={cn(
              "font-['Inter'] font-semibold text-sm shrink-0 ml-3",
              isToken ? 'text-[#e85d3a]' : 'text-[#1d1d1f]'
            )}>
              {formatSats(item.amount)}
            </p>
          </div>
        )
      })}
    </div>
  )
}
