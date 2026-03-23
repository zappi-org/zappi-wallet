import { useMemo, useRef, useState } from 'react'
import { ArrowLeft, Search, Banknote, Calendar, CreditCard } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { useVirtualizer } from '@tanstack/react-virtual'
import { motion, AnimatePresence } from 'motion/react'
import type { Transaction, MintInfo } from '@/core/types'
import { useAppStore } from '@/store'
import { useWallet, useMintMetadata } from '@/hooks'
import { getMintBalance, stripTrailingSlash } from '@/utils/url'
import { EmptyState } from '@/ui/components/common/EmptyState'
import { TransactionListSkeleton } from '@/ui/components/common/Skeleton'
import { DateFilterSheet } from '@/ui/components/common/DateFilterSheet'
import { MintFilterSheet } from '@/ui/components/common/MintFilterSheet'
import { type DateFilterValue, computeDateCutoff, getDateFilterLabel, isDateFilterActive, formatDateGroupLabel } from '@/utils/dateFilter'
import { TransactionRow } from '@/ui/components/wallet/TransactionRow'
import { getTitle } from '@/ui/components/wallet/transactionHelpers'
import { getMintFilterLabel } from '@/hooks/useAvailableMints'
import { cn } from '@/lib/utils'

// ─── Types ───

export type FilterType = 'all' | 'income' | 'expense'

export interface HistoryScreenProps {
  onBack: () => void
  transactions: Transaction[]
  isLoading?: boolean
  onSelectTransaction?: (tx: Transaction) => void
  initialFilter?: FilterType
  initialMintUrls?: string[]
}

type FlatItem =
  | { type: 'header'; label: string }
  | { type: 'transaction'; tx: Transaction }

// ─── Main Screen ───

export function HistoryScreen({
  onBack,
  transactions,
  isLoading = false,
  onSelectTransaction,
  initialFilter,
  initialMintUrls,
}: HistoryScreenProps) {
  'use no memo' // useVirtualizer returns mutable functions incompatible with React Compiler
  const { t } = useTranslation()
  const [filter, setFilter] = useState<FilterType>(initialFilter ?? 'all')
  const [dateFilter, setDateFilter] = useState<DateFilterValue>({ preset: 'all', range: undefined })
  const [searchQuery, setSearchQuery] = useState('')
  const [showDateFilter, setShowDateFilter] = useState(false)
  const [showMintFilter, setShowMintFilter] = useState(false)
  const [selectedMintUrls, setSelectedMintUrls] = useState<Set<string>>(
    () => new Set(initialMintUrls ?? []),
  )

  // Build available mints for filter from store
  const settings = useAppStore((state) => state.settings)

  // Mint metadata — include settings.mints so filter sheet gets names & icons
  const mintUrls = useMemo(() => {
    const urls = new Set<string>(settings.mints)
    transactions.forEach((tx) => {
      urls.add(tx.mintUrl)
      if (tx.type === 'swap') {
        if (tx.metadata?.fromMintUrl) urls.add(tx.metadata.fromMintUrl as string)
        if (tx.metadata?.toMintUrl) urls.add(tx.metadata.toMintUrl as string)
      }
    })
    return Array.from(urls)
  }, [transactions, settings.mints])

  const { getDisplayName, getIconUrl } = useMintMetadata(mintUrls)
  const { balance } = useWallet()

  const availableMints: MintInfo[] = useMemo(() => {
    return settings.mints.map((url) => ({
      url,
      name: getDisplayName(url),
      alias: settings.mintAliases?.[url],
      balance: getMintBalance(url, balance.byMint),
      iconUrl: getIconUrl(url),
      isOnline: true,
    }))
  }, [settings.mints, settings.mintAliases, balance.byMint, getDisplayName, getIconUrl])

  // ─── Date filter cutoff ───
  const dateCutoff = useMemo(() => computeDateCutoff(dateFilter), [dateFilter])

  // ─── Filtered transactions ───
  const isMintFiltered = selectedMintUrls.size > 0

  const filteredTransactions = useMemo(() => {
    let filtered = [...transactions]
      .filter((tx) => tx.status === 'completed')
      .sort((a, b) => b.createdAt - a.createdAt)

    // Mint filter
    if (selectedMintUrls.size > 0) {
      const normalizedSet = new Set(Array.from(selectedMintUrls).map(stripTrailingSlash))
      filtered = filtered.filter((tx) => normalizedSet.has(stripTrailingSlash(tx.mintUrl)))
    }

    // Date filter
    if (dateCutoff) {
      filtered = filtered.filter((tx) => tx.createdAt >= dateCutoff.from && tx.createdAt <= dateCutoff.to)
    }

    // Tab filter
    switch (filter) {
      case 'income':
        filtered = filtered.filter((tx) => tx.direction === 'receive' && tx.type !== 'swap')
        break
      case 'expense':
        filtered = filtered.filter((tx) => tx.direction === 'send' && tx.type !== 'swap')
        break
    }

    // Search
    if (searchQuery) {
      const query = searchQuery.toLowerCase()
      filtered = filtered.filter((tx) => {
        const memo = tx.memo?.toLowerCase() || ''
        const mint = tx.mintUrl.toLowerCase()
        const typeLabel = getTitle(tx, t).toLowerCase()
        const source = tx.source ? t(`txDetail.source.${tx.source}`).toLowerCase() : ''
        return memo.includes(query) || mint.includes(query)
          || typeLabel.includes(query) || source.includes(query)
          || String(tx.amount).includes(query)
      })
    }

    return filtered
  }, [transactions, filter, dateCutoff, searchQuery, selectedMintUrls, t])

  // ─── Flat items for virtualizer (grouped by date) ───
  const flatItems = useMemo(() => {
    const items: FlatItem[] = []
    let currentLabel = ''
    for (const tx of filteredTransactions) {
      const label = formatDateGroupLabel(tx.createdAt, t)
      if (label !== currentLabel) {
        currentLabel = label
        items.push({ type: 'header', label })
      }
      items.push({ type: 'transaction', tx })
    }
    return items
  }, [filteredTransactions, t])

  // ─── Virtualizer ───
  const scrollContainerRef = useRef<HTMLDivElement>(null)
  // eslint-disable-next-line react-hooks/incompatible-library -- useVirtualizer is known-incompatible with React Compiler; 'use no memo' above opts out
  const virtualizer = useVirtualizer({
    count: flatItems.length,
    getScrollElement: () => scrollContainerRef.current,
    estimateSize: (index) => {
      const item = flatItems[index]
      if (item.type === 'header') return 44
      return 56
    },
    overscan: 10,
  })

  const filterLabels: Record<FilterType, string> = {
    all: t('history.all'),
    income: t('history.income'),
    expense: t('history.expense'),
  }

  const dateFilterLabel = useMemo(() => getDateFilterLabel(dateFilter, t), [dateFilter, t])
  const isDateFiltered = isDateFilterActive(dateFilter)

  const mintFilterLabel = useMemo(
    () => getMintFilterLabel(selectedMintUrls, getDisplayName, t),
    [selectedMintUrls, getDisplayName, t],
  )

  return (
    <div className="h-dvh bg-background text-foreground flex flex-col font-sans relative overflow-hidden z-[60] pt-safe">
      {/* Header */}
      <header className="flex items-center justify-between px-5 pt-4 relative z-50">
        <div className="flex items-center">
          <button
            onClick={onBack}
            aria-label={t('common.back')}
            className="w-10 h-10 -ml-1.5 rounded-lg flex items-center justify-center hover:bg-black/[0.04] active:bg-black/[0.06] transition-colors"
          >
            <ArrowLeft className="w-[22px] h-[22px] text-foreground" strokeWidth={1.8} />
          </button>
          <h2 className="text-body font-bold tracking-tight ml-2">{t('history.title')}</h2>
        </div>
        <div className="flex items-center gap-1">
          {availableMints.length > 1 && (
            <button
              onClick={() => setShowMintFilter(true)}
              className={cn(
                'h-10 rounded-lg flex items-center gap-1.5 px-2.5 transition-colors',
                isMintFiltered
                  ? 'bg-primary/10 text-primary'
                  : 'hover:bg-black/[0.04] active:bg-black/[0.06] text-foreground'
              )}
            >
              <CreditCard className="w-[18px] h-[18px]" strokeWidth={1.8} />
              <span className="text-label font-medium max-w-[80px] truncate">{mintFilterLabel}</span>
            </button>
          )}
          <button
            onClick={() => setShowDateFilter(true)}
            className={cn(
              'h-10 rounded-lg flex items-center gap-1.5 px-2.5 transition-colors',
              isDateFiltered
                ? 'bg-primary/10 text-primary'
                : 'hover:bg-black/[0.04] active:bg-black/[0.06] text-foreground'
            )}
          >
            <Calendar className="w-[18px] h-[18px]" strokeWidth={1.8} />
            <span className="text-label font-medium">{dateFilterLabel}</span>
          </button>
        </div>
      </header>

      {/* Search Bar */}
      <div className="px-5 pb-3 pt-2">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-foreground-muted" />
          <input
            type="text"
            placeholder={t('history.searchPlaceholder')}
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full bg-background-card pl-10 pr-4 py-2.5 rounded-xl outline-none text-body text-foreground placeholder:text-foreground-muted/50"
          />
        </div>
      </div>

      {/* Filter Tabs */}
      <div className="px-4 py-2 flex gap-2 overflow-x-auto scrollbar-hide">
        {(['all', 'income', 'expense'] as FilterType[]).map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={cn(
              'px-4 py-1.5 rounded-full text-label transition-all whitespace-nowrap',
              filter === f
                ? 'bg-primary text-primary-foreground'
                : 'bg-background-card/50 text-foreground-muted hover:bg-background-card'
            )}
          >
            {filterLabels[f]}
          </button>
        ))}
      </div>

      {/* List */}
      <div ref={scrollContainerRef} className="flex-1 overflow-y-auto px-4 pb-safe">
        {isLoading ? (
          <TransactionListSkeleton count={6} />
        ) : flatItems.length === 0 ? (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.3 }}
          >
            <EmptyState
              icon={<Banknote className="w-6 h-6" />}
              title={t('history.noTransactions')}
              description={t('history.noTransactionsDesc')}
            />
          </motion.div>
        ) : (
          <AnimatePresence mode="wait">
            <motion.div
              key={`${filter}-${dateFilter.preset}-${dateFilter.range?.from?.getTime()}-${searchQuery}-${selectedMintUrls.size}`}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.15 }}
              style={{ height: `${virtualizer.getTotalSize()}px`, position: 'relative', width: '100%' }}
            >
              {virtualizer.getVirtualItems().map((virtualRow) => {
                const item = flatItems[virtualRow.index]
                return (
                  <div
                    key={virtualRow.key}
                    data-index={virtualRow.index}
                    ref={virtualizer.measureElement}
                    style={{
                      position: 'absolute',
                      top: 0,
                      left: 0,
                      width: '100%',
                      transform: `translateY(${virtualRow.start}px)`,
                    }}
                  >
                    {item.type === 'header' ? (
                      <h3 className="text-body font-bold text-foreground pt-5 pb-2 px-1">
                        {item.label}
                      </h3>
                    ) : (
                      <>
                        <TransactionRow
                          transaction={item.tx}
                          onClick={() => onSelectTransaction?.(item.tx)}
                          getMintName={getDisplayName}
                        />
                        <div className="h-px bg-border/30 mx-4" />
                      </>
                    )}
                  </div>
                )
              })}
            </motion.div>
          </AnimatePresence>
        )}
      </div>

      {/* Date Filter Sheet */}
      <DateFilterSheet
        isOpen={showDateFilter}
        onClose={() => setShowDateFilter(false)}
        value={dateFilter}
        onChange={setDateFilter}
      />

      {/* Mint Filter Sheet */}
      <MintFilterSheet
        isOpen={showMintFilter}
        onClose={() => setShowMintFilter(false)}
        mints={availableMints}
        selectedUrls={selectedMintUrls}
        onChange={setSelectedMintUrls}
      />
    </div>
  )
}

export default HistoryScreen
