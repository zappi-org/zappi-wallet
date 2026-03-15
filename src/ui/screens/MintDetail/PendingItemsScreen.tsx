import { useState, useMemo } from 'react'
import { ArrowLeft, Search } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { cn } from '@/lib/utils'
import { PendingItemsList } from '@/ui/components/wallet/PendingItemsList'
import { hapticTap } from '@/utils/haptic'
import type { PendingItem } from '@/hooks/usePendingItems'

type Tab = 'all' | 'tokens' | 'requests'
type RequestFilter = 'all' | 'ecash' | 'lightning'

interface PendingItemsScreenProps {
  items: PendingItem[]
  mintUrl: string
  onBack: () => void
}

function groupByDate(items: PendingItem[], t: (key: string) => string): Array<{ label: string; items: PendingItem[] }> {
  const now = new Date()
  const yesterday = new Date(now)
  yesterday.setDate(yesterday.getDate() - 1)

  const groups: Record<string, PendingItem[]> = {}

  for (const item of items) {
    const date = new Date(item.createdAt)
    let label: string

    if (date.toDateString() === now.toDateString()) {
      label = t('mintDetail.today') || '오늘'
    } else if (date.toDateString() === yesterday.toDateString()) {
      label = t('mintDetail.yesterday') || '어제'
    } else {
      label = date.toLocaleDateString(undefined, { year: 'numeric', month: '2-digit', day: '2-digit' })
    }

    if (!groups[label]) groups[label] = []
    groups[label].push(item)
  }

  return Object.entries(groups).map(([label, items]) => ({ label, items }))
}

export function PendingItemsScreen({ items, mintUrl, onBack }: PendingItemsScreenProps) {
  const { t } = useTranslation()
  const [activeTab, setActiveTab] = useState<Tab>('all')
  const [requestFilter, setRequestFilter] = useState<RequestFilter>('all')
  const [searchQuery, setSearchQuery] = useState('')

  const filteredItems = useMemo(() => {
    let result = items

    // Tab filter
    if (activeTab === 'tokens') {
      result = result.filter((i) => i.type === 'unclaimed-token')
    } else if (activeTab === 'requests') {
      result = result.filter((i) => i.type !== 'unclaimed-token')
      // Sub-filter for requests
      if (requestFilter === 'ecash') {
        result = result.filter((i) => i.type === 'ecash-request')
      } else if (requestFilter === 'lightning') {
        result = result.filter((i) => i.type === 'lightning-request')
      }
    }

    // Search filter
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase()
      result = result.filter((i) =>
        i.memo?.toLowerCase().includes(q) || i.amount.toString().includes(q)
      )
    }

    return result
  }, [items, activeTab, requestFilter, searchQuery])

  const groups = groupByDate(filteredItems, t)

  const tabs: Array<{ key: Tab; label: string }> = [
    { key: 'all', label: t('mintDetail.tabAll') },
    { key: 'tokens', label: t('mintDetail.tabTokens') },
    { key: 'requests', label: t('mintDetail.tabRequests') },
  ]

  return (
    <div className="h-dvh bg-[#faf9f6] flex flex-col pt-safe">
      {/* Header */}
      <header className="flex items-center justify-between px-4 h-14 shrink-0">
        <button
          onClick={() => { hapticTap(); onBack() }}
          className="w-10 h-10 flex items-center justify-center rounded-full hover:bg-gray-100 transition-colors"
        >
          <ArrowLeft className="w-5 h-5 text-[#1d1d1f]" />
        </button>
        <h1 className="font-['Outfit'] font-bold text-lg text-[#1d1d1f]">
          {t('mintDetail.pendingAll')}
        </h1>
        <div className="w-10" />
      </header>

      {/* Search */}
      <div className="px-4 pb-3">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[#86868b]" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder={t('mintDetail.search')}
            className="w-full bg-gray-100 rounded-xl pl-10 pr-4 py-2.5 text-sm text-[#1d1d1f] placeholder:text-[#86868b] outline-none focus:ring-2 focus:ring-[#3b7df5]/30"
          />
        </div>
      </div>

      {/* Tabs */}
      <div className="px-4 pb-3 flex gap-2">
        {tabs.map(({ key, label }) => (
          <button
            key={key}
            onClick={() => { setActiveTab(key); setRequestFilter('all') }}
            className={cn(
              'px-4 py-1.5 rounded-full text-sm font-medium transition-colors',
              activeTab === key
                ? 'bg-[#1d1d1f] text-white'
                : 'bg-gray-100 text-[#86868b]'
            )}
          >
            {label}
          </button>
        ))}
      </div>

      {/* Request sub-filter */}
      {activeTab === 'requests' && (
        <div className="px-4 pb-3 flex gap-2">
          <button
            onClick={() => setRequestFilter('ecash')}
            className={cn(
              'px-3 py-1 rounded-full text-xs font-medium transition-colors border',
              requestFilter === 'ecash'
                ? 'bg-[#3b7df5] text-white border-[#3b7df5]'
                : 'bg-white text-[#86868b] border-gray-200'
            )}
          >
            {t('mintDetail.filterEcash')}
          </button>
          <button
            onClick={() => setRequestFilter('lightning')}
            className={cn(
              'px-3 py-1 rounded-full text-xs font-medium transition-colors border',
              requestFilter === 'lightning'
                ? 'bg-[#3b7df5] text-white border-[#3b7df5]'
                : 'bg-white text-[#86868b] border-gray-200'
            )}
          >
            {t('mintDetail.filterLightning')}
          </button>
        </div>
      )}

      {/* Content */}
      <main className="flex-1 overflow-y-auto px-4 pb-8">
        {groups.length === 0 ? (
          <p className="text-sm text-[#86868b] text-center py-8">
            {t('mintDetail.noPendingItems')}
          </p>
        ) : (
          <div className="space-y-4">
            {groups.map(({ label, items: groupItems }) => (
              <div key={label}>
                <p className="text-xs font-medium text-[#86868b] mb-2">{label}</p>
                <PendingItemsList items={groupItems} mintUrl={mintUrl} maxItems={999} />
              </div>
            ))}
          </div>
        )}
      </main>
    </div>
  )
}
