import { useState, useMemo, useCallback } from 'react'
import { ArrowLeft, Search, Calendar, CreditCard, ListFilter } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { useAppStore } from '@/store'
import { stripTrailingSlash } from '@/utils/url'
import { PendingItemsList } from '@/ui/components/wallet/PendingItemsList'
import { PendingItemDetailScreen } from './PendingItemDetailScreen'
import { DateFilterSheet } from '@/ui/components/common/DateFilterSheet'
import { MintFilterSheet } from '@/ui/components/common/MintFilterSheet'
import { BottomSheet, BottomSheetItem } from '@/ui/components/common/BottomSheet'
import { FilterChip } from '@/ui/components/common/FilterChip'
import { type DateFilterValue, computeDateCutoff, getDateFilterLabel, isDateFilterActive, formatDateGroupLabel } from '@/utils/dateFilter'
import { hapticTap } from '@/utils/haptic'
import { useAllPendingItems } from '@/hooks/usePendingItems'
import type { PendingItem } from '@/hooks/usePendingItems'
import { useAvailableMints, getMintFilterLabel } from '@/hooks/useAvailableMints'

type Tab = 'all' | 'request' | 'token'

type OpenSheet = 'type' | 'date' | 'mint' | null

interface PendingItemsScreenProps {
  onBack: () => void
  onItemClick?: (item: PendingItem) => void
  initialMintUrls?: string[]
}

function groupByDate(items: PendingItem[], t: (key: string, opts?: Record<string, string>) => string): Array<{ label: string; items: PendingItem[] }> {
  const groups: Record<string, PendingItem[]> = {}
  for (const item of items) {
    const label = formatDateGroupLabel(item.createdAt, t)
    if (!groups[label]) groups[label] = []
    groups[label].push(item)
  }
  return Object.entries(groups).map(([label, items]) => ({ label, items }))
}

export function PendingItemsScreen({ onBack, onItemClick, initialMintUrls }: PendingItemsScreenProps) {
  'use no memo' // Date.now() in useMemo is flagged as impure by React Compiler
  const { t } = useTranslation()

  const settings = useAppStore((state) => state.settings)
  const { items } = useAllPendingItems(settings.mints)
  const [activeTab, setActiveTab] = useState<Tab>('all')
  const [searchQuery, setSearchQuery] = useState('')
  const [selectedItem, setSelectedItem] = useState<PendingItem | null>(null)
  const [dateFilter, setDateFilter] = useState<DateFilterValue>({ preset: 'all', range: undefined })
  const [openSheet, setOpenSheet] = useState<OpenSheet>(null)
  const [selectedMintUrls, setSelectedMintUrls] = useState<Set<string>>(
    () => new Set(initialMintUrls ?? []),
  )

  const closeSheet = useCallback(() => setOpenSheet(null), [])

  const { availableMints, getDisplayName } = useAvailableMints()

  const handleItemClick = useCallback((item: PendingItem) => {
    hapticTap()
    if (onItemClick) {
      onItemClick(item)
    } else {
      setSelectedItem(item)
    }
  }, [onItemClick])

  // Date filter cutoff
  const dateCutoff = useMemo(() => computeDateCutoff(dateFilter), [dateFilter])

  const isMintFiltered = selectedMintUrls.size > 0
  const isTypeFiltered = activeTab !== 'all'

  const filteredItems = useMemo(() => {
    let result = items

    if (selectedMintUrls.size > 0) {
      const normalizedSet = new Set(Array.from(selectedMintUrls).map(stripTrailingSlash))
      result = result.filter((i) => normalizedSet.has(stripTrailingSlash(i.mintUrl)))
    }

    if (dateCutoff) {
      result = result.filter(i => i.createdAt >= dateCutoff.from && i.createdAt <= dateCutoff.to)
    }

    if (activeTab === 'request') {
      result = result.filter(i => i.type === 'receive-request')
    } else if (activeTab === 'token') {
      result = result.filter(i => i.type === 'unclaimed-token' || i.type === 'sent-token')
    }

    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase()
      result = result.filter((i) =>
        i.memo?.toLowerCase().includes(q) || i.amount.toString().includes(q)
      )
    }

    return result
  }, [items, activeTab, dateCutoff, searchQuery, selectedMintUrls])

  const groups = useMemo(() => groupByDate(filteredItems, t), [filteredItems, t])

  const tabLabels = useMemo<Record<Tab, string>>(() => ({
    all: t('history.all'),
    request: t('mintDetail.tabRequest'),
    token: t('mintDetail.tabToken'),
  }), [t])

  const dateFilterLabel = useMemo(() => getDateFilterLabel(dateFilter, t), [dateFilter, t])
  const isDateFiltered = isDateFilterActive(dateFilter)

  const mintFilterLabel = useMemo(
    () => getMintFilterLabel(selectedMintUrls, getDisplayName, t),
    [selectedMintUrls, getDisplayName, t],
  )

  const handleTabSelect = useCallback((tab: Tab) => {
    setActiveTab(tab)
    setOpenSheet(null)
  }, [])

  if (selectedItem) {
    return (
      <PendingItemDetailScreen
        item={selectedItem}
        onBack={() => setSelectedItem(null)}
      />
    )
  }

  return (
    <div className="h-dvh bg-background flex flex-col pt-safe">
      {/* Header */}
      <header className="flex items-center px-5 pt-4 shrink-0">
        <button
          onClick={() => { hapticTap(); onBack() }}
          aria-label={t('common.back')}
          className="w-10 h-10 -ml-1.5 rounded-lg flex items-center justify-center hover:bg-black/[0.04] active:bg-black/[0.06] transition-colors"
        >
          <ArrowLeft className="w-[22px] h-[22px] text-foreground" strokeWidth={1.8} />
        </button>
        <h2 className="text-body font-bold tracking-tight ml-2">
          {t('mintDetail.pendingAll')}
        </h2>
      </header>

      {/* Search */}
      <div className="px-5 pb-3 pt-2">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-foreground-muted" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder={t('mintDetail.search')}
            className="w-full bg-background-card rounded-xl pl-10 pr-4 py-2.5 text-body text-foreground placeholder:text-foreground-muted/50 outline-none"
          />
        </div>
      </div>

      {/* Filter Chips */}
      <div className="px-4 py-2 flex gap-2 overflow-x-auto scrollbar-hide">
        <FilterChip
          icon={<ListFilter className="w-3.5 h-3.5" strokeWidth={1.8} />}
          label={isTypeFiltered ? tabLabels[activeTab] : t('mintDetail.filterType')}
          active={isTypeFiltered}
          onClick={() => setOpenSheet('type')}
        />
        <FilterChip
          icon={<Calendar className="w-3.5 h-3.5" strokeWidth={1.8} />}
          label={isDateFiltered ? dateFilterLabel : t('history.dateFilter')}
          active={isDateFiltered}
          onClick={() => setOpenSheet('date')}
        />
        {availableMints.length > 1 && (
          <FilterChip
            icon={<CreditCard className="w-3.5 h-3.5" strokeWidth={1.8} />}
            label={isMintFiltered ? mintFilterLabel : t('history.mintFilter')}
            active={isMintFiltered}
            onClick={() => setOpenSheet('mint')}
            truncate
          />
        )}
      </div>

      {/* Content */}
      <main className="flex-1 overflow-y-auto px-4 pb-safe">
        {groups.length === 0 ? (
          <p className="text-caption text-foreground-muted text-center py-8">
            {t('mintDetail.noPendingItems')}
          </p>
        ) : (
          <div>
            {groups.map(({ label, items: groupItems }) => (
              <div key={label}>
                <h3 className="text-body font-bold text-foreground pt-5 pb-2 px-1">{label}</h3>
                <PendingItemsList items={groupItems} maxItems={999} onItemClick={handleItemClick} />
              </div>
            ))}
          </div>
        )}
      </main>

      {/* Type Filter Sheet */}
      <BottomSheet isOpen={openSheet === 'type'} onClose={closeSheet} title={t('mintDetail.filterType')}>
        {(['all', 'request', 'token'] as Tab[]).map((tab) => (
          <BottomSheetItem
            key={tab}
            title={tabLabels[tab]}
            selected={activeTab === tab}
            onClick={() => handleTabSelect(tab)}
          />
        ))}
      </BottomSheet>

      {/* Date Filter Sheet */}
      <DateFilterSheet
        isOpen={openSheet === 'date'}
        onClose={closeSheet}
        value={dateFilter}
        onChange={setDateFilter}
      />

      {/* Mint Filter Sheet */}
      <MintFilterSheet
        isOpen={openSheet === 'mint'}
        onClose={closeSheet}
        mints={availableMints}
        selectedUrls={selectedMintUrls}
        onChange={setSelectedMintUrls}
      />
    </div>
  )
}
