import { lazy, Suspense, useCallback, useMemo, useRef, useState } from 'react'
import { ArrowLeft, Search, Banknote, Calendar, CreditCard, Download, FileSpreadsheet, ListFilter } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { useVirtualizer } from '@tanstack/react-virtual'
import { motion, AnimatePresence } from 'motion/react'
import type { Transaction } from '@/core/domain/transaction'
import { getTransactionType, getTxMeta } from '@/core/domain/transaction'
import { toNumber } from '@/core/domain/amount'
import type { MintInfo } from '@/core/types'
import { useAppStore } from '@/store'
import { useWallet, useMintMetadata } from '@/ui/hooks'
import { getMintBalance, stripTrailingSlash } from '@/utils/url'
import { EmptyState } from '@/ui/components/common/EmptyState'
import { TransactionListSkeleton } from '@/ui/components/common/Skeleton'
import { DateFilterSheet } from '@/ui/components/common/DateFilterSheet'
import { MintFilterSheet } from '@/ui/components/common/MintFilterSheet'
import { BottomSheet, BottomSheetItem } from '@/ui/components/common/BottomSheet'
import { type DateFilterValue, computeDateCutoff, getDateFilterLabel, isDateFilterActive, formatDateGroupLabel } from '@/ui/utils/dateFilter'
import { TransactionRow } from '@/ui/components/wallet/TransactionRow'
import { getTitle } from '@/ui/components/wallet/transactionHelpers'
import { getMintFilterLabel } from '@/ui/hooks/useAvailableMints'
import { exportTransactionsCsv } from '@/ui/utils/exportTransactions'
import { FilterChip } from '@/ui/components/common/FilterChip'
import { Spinner } from '@/ui/components/common/Spinner'

const TransactionDetailScreen = lazy(() => import('@/ui/screens/TransactionDetail/TransactionDetailScreen'))

// ─── Types ───

export type FilterType = 'all' | 'income' | 'expense'

type OpenSheet = 'type' | 'date' | 'mint' | 'export' | null

export interface HistoryScreenProps {
  onBack: () => void
  transactions: Transaction[]
  isLoading?: boolean
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
  initialFilter,
  initialMintUrls,
}: HistoryScreenProps) {
  'use no memo' // useVirtualizer returns mutable functions incompatible with React Compiler
  const { t } = useTranslation()
  const [filter, setFilter] = useState<FilterType>(initialFilter ?? 'all')
  const [dateFilter, setDateFilter] = useState<DateFilterValue>({ preset: 'all', range: undefined })
  const [searchQuery, setSearchQuery] = useState('')
  const [openSheet, setOpenSheet] = useState<OpenSheet>(null)
  const [selectedTransaction, setSelectedTransaction] = useState<Transaction | null>(null)
  const [selectedMintUrls, setSelectedMintUrls] = useState<Set<string>>(
    () => new Set(initialMintUrls ?? []),
  )

  const closeSheet = useCallback(() => setOpenSheet(null), [])

  const settings = useAppStore((state) => state.settings)
  const addToast = useAppStore((state) => state.addToast)

  // Mint metadata
  const mintUrls = useMemo(() => {
    const urls = new Set<string>(settings.mints)
    transactions.forEach((tx) => {
      urls.add(tx.accountId)
      if (getTransactionType(tx) === 'swap') {
        const m = getTxMeta(tx)
        if (m.fromMintUrl) urls.add(m.fromMintUrl)
        if (m.toMintUrl) urls.add(m.toMintUrl)
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
  const isTypeFiltered = filter !== 'all'

  const filteredTransactions = useMemo(() => {
    let filtered = transactions
      .filter((tx) => tx.status === 'settled')
      .sort((a, b) => b.createdAt - a.createdAt)

    if (selectedMintUrls.size > 0) {
      const normalizedSet = new Set(Array.from(selectedMintUrls).map(stripTrailingSlash))
      filtered = filtered.filter((tx) => normalizedSet.has(stripTrailingSlash(tx.accountId)))
    }

    if (dateCutoff) {
      filtered = filtered.filter((tx) => tx.createdAt >= dateCutoff.from && tx.createdAt <= dateCutoff.to)
    }

    switch (filter) {
      case 'income':
        filtered = filtered.filter((tx) => tx.direction === 'receive' && getTransactionType(tx) !== 'swap')
        break
      case 'expense':
        filtered = filtered.filter((tx) => tx.direction === 'send' && getTransactionType(tx) !== 'swap')
        break
    }

    if (searchQuery) {
      const query = searchQuery.toLowerCase()
      filtered = filtered.filter((tx) => {
        const memo = tx.memo?.toLowerCase() || ''
        const mint = tx.accountId.toLowerCase()
        const typeLabel = getTitle(tx, t).toLowerCase()
        const txMeta = getTxMeta(tx)
        const source = txMeta.source ? t(`txDetail.source.${txMeta.source}`).toLowerCase() : ''
        return memo.includes(query) || mint.includes(query)
          || typeLabel.includes(query) || source.includes(query)
          || String(toNumber(tx.amount)).includes(query)
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

  // ─── Filter labels ───
  const filterLabels = useMemo<Record<FilterType, string>>(() => ({
    all: t('history.all'),
    income: t('history.income'),
    expense: t('history.expense'),
  }), [t])

  const dateFilterLabel = useMemo(() => getDateFilterLabel(dateFilter, t), [dateFilter, t])
  const isDateFiltered = isDateFilterActive(dateFilter)

  const mintFilterLabel = useMemo(
    () => getMintFilterLabel(selectedMintUrls, getDisplayName, t),
    [selectedMintUrls, getDisplayName, t],
  )

  // ─── Type filter selection ───
  const handleTypeSelect = useCallback((type: FilterType) => {
    setFilter(type)
    setOpenSheet(null)
  }, [])

  // ─── Export ───
  const handleExportPress = useCallback(() => {
    if (filteredTransactions.length === 0) {
      addToast({ message: t('history.exportEmpty'), type: 'error' })
      return
    }
    setOpenSheet('export')
  }, [filteredTransactions.length, addToast, t])

  const handleExportConfirm = useCallback(() => {
    setOpenSheet(null)
    exportTransactionsCsv({ transactions: filteredTransactions, getMintName: getDisplayName })
    addToast({ message: t('history.exportSuccess'), type: 'success' })
  }, [filteredTransactions, getDisplayName, addToast, t])

  if (selectedTransaction) {
    return (
      <Suspense fallback={<div className="h-dvh flex items-center justify-center bg-background"><Spinner /></div>}>
        <TransactionDetailScreen
          transaction={selectedTransaction}
          onBack={() => setSelectedTransaction(null)}
          mintUrls={settings.mints}
        />
      </Suspense>
    )
  }

  return (
    <div className="h-dvh bg-background text-foreground flex flex-col font-primary relative overflow-hidden z-[60] pt-safe">
      {/* Header */}
      <header className="relative flex items-center justify-between px-5 h-14 shrink-0 z-50">
        <button
          onClick={onBack}
          aria-label={t('common.back')}
          className="w-10 h-10 -ml-1.5 rounded-lg flex items-center justify-center hover:bg-foreground/[0.04] active:bg-foreground/[0.06] transition-colors z-10"
        >
          <ArrowLeft className="w-[22px] h-[22px] text-foreground" strokeWidth={1.8} />
        </button>
        <h2 className="absolute inset-0 flex items-center justify-center text-subtitle font-semibold pointer-events-none">{t('history.title')}</h2>
        <button
          onClick={handleExportPress}
          aria-label={t('history.export')}
          className="h-10 rounded-lg flex items-center gap-1.5 px-2.5 hover:bg-foreground/[0.04] active:bg-foreground/[0.06] transition-colors text-foreground z-10"
        >
          <Download className="w-[18px] h-[18px]" strokeWidth={1.8} />
        </button>
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
            className="w-full bg-background-card pl-10 pr-4 py-2.5 rounded-card outline-none text-body text-foreground placeholder:text-foreground-muted"
          />
        </div>
      </div>

      {/* Filter Chips */}
      <div className="px-5 py-2 flex gap-2 overflow-x-auto scrollbar-hide">
        <FilterChip
          icon={<ListFilter className="w-3.5 h-3.5" strokeWidth={1.8} />}
          label={isTypeFiltered ? filterLabels[filter] : t('history.filterType')}
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

      {/* List */}
      <div ref={scrollContainerRef} className="flex-1 overflow-y-auto px-5 pb-safe">
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
                      <h3 className="text-caption font-semibold text-foreground-muted pt-5 pb-2">
                        {item.label}
                      </h3>
                    ) : (
                      <>
                        <TransactionRow
                          transaction={item.tx}
                          onClick={() => setSelectedTransaction(item.tx)}
                          getMintName={getDisplayName}
                        />
                        <div className="h-px bg-border/30" />
                      </>
                    )}
                  </div>
                )
              })}
            </motion.div>
          </AnimatePresence>
        )}
      </div>

      {/* Type Filter Sheet */}
      <BottomSheet isOpen={openSheet === 'type'} onClose={closeSheet} title={t('history.filterType')}>
        {(['all', 'income', 'expense'] as FilterType[]).map((f) => (
          <BottomSheetItem
            key={f}
            title={filterLabels[f]}
            selected={filter === f}
            onClick={() => handleTypeSelect(f)}
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

      {/* Export Confirmation Sheet */}
      <BottomSheet isOpen={openSheet === 'export'} onClose={closeSheet} title={t('history.export')}>
        <div className="px-5 py-4 flex flex-col gap-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center shrink-0">
              <FileSpreadsheet className="w-5 h-5 text-primary" strokeWidth={1.8} />
            </div>
            <div className="min-w-0">
              <p className="text-body font-semibold text-foreground">CSV (.csv)</p>
              <p className="text-caption text-foreground-muted">{t('history.exportCsvDesc')}</p>
            </div>
          </div>
          <p className="text-caption text-foreground-muted">
            {t('history.exportCount', { count: filteredTransactions.length })}
          </p>
          <button
            onClick={handleExportConfirm}
            className="w-full py-3 rounded-xl bg-primary text-primary-foreground text-body font-semibold active:scale-[0.98] transition-transform"
          >
            {t('history.exportDownload')}
          </button>
        </div>
      </BottomSheet>
    </div>
  )
}

export default HistoryScreen
