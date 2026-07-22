import { txSourceKey } from '@/ui/utils/tx-source'
import { shareOrCopyText } from '@/ui/utils/share'
import type { TFunction } from 'i18next'
import { lazy, Suspense, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
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
import { getMintBalance, isSameMintUrl, stripTrailingSlash } from '@/utils/url'
import { getLocaleCode, satsToFiat, useFormatSats } from '@/utils/format'
import type { PendingItem } from '@/core/ports/driving/pending-items.usecase'
import { isSendToken, type TokenDetails } from '@/ui/types/pending-item-details'
import { useAllPendingItems } from '@/ui/hooks/usePendingItems'
import { useReclaimFees } from '@/ui/hooks/useReclaimFees'
import { useTokenReclaim } from '@/ui/hooks/use-token-reclaim'
import { ServiceContext } from '@/ui/hooks/service-context-value'
import { PendingWidget } from '@/ui/screens/Token/components/PendingWidget'
import { ReclaimableSection } from '@/ui/screens/Token/components/ReclaimableSection'
import { ReclaimSheet } from '@/ui/screens/Token/components/ReclaimSheet'
import { pendingToDetail } from '@/ui/screens/Token/token-view-model'
import type { PendingTokenView, TokenDetailData } from '@/ui/screens/Token/types'
import { EmptyState } from '@/ui/components/common/EmptyState'
import { TransactionListSkeleton } from '@/ui/components/common/Skeleton'
import { DateFilterSheet } from '@/ui/components/common/DateFilterSheet'
import { MintFilterSheet } from '@/ui/components/common/MintFilterSheet'
import { BottomSheet, BottomSheetItem } from '@/ui/components/common/BottomSheet'
import { type DateFilterValue, computeDateCutoff, getDateFilterLabel, isDateFilterActive } from '@/ui/utils/dateFilter'
import { getTitle } from '@/ui/components/wallet/transactionHelpers'
import { getMintFilterLabel } from '@/ui/hooks/useAvailableMints'
import { exportTransactionsCsv } from '@/ui/utils/exportTransactions'
import { FilterChip } from '@/ui/components/common/FilterChip'
import { Spinner } from '@/ui/components/common/Spinner'
import { groupTransactionsForTimeline, type TimelineGroup, type TimelineKind } from '@/ui/hooks/use-transaction-history'
import { HistoryTimelineRow } from './components/HistoryTimelineRow'

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
  /** Open the token detail (QR/raw/reclaim) for a pending ecash card. */
  onSelectPendingToken?: (detail: TokenDetailData) => void
}

interface AnchorText {
  major: string
  minor?: string
}

function zeroPad2(n: number): string {
  return n < 10 ? `0${n}` : String(n)
}

function shortWeekday(date: Date, locale: string): string {
  try {
    return new Intl.DateTimeFormat(locale, { weekday: 'short' }).format(date)
  } catch {
    return ''
  }
}

function buildAnchor(
  t: TFunction,
  group: TimelineGroup,
  locale: string,
): AnchorText {
  switch (group.kind) {
    case 'today':
    case 'yesterday': {
      const date = new Date(group.refDate)
      const weekday = shortWeekday(date, locale)
      const major = `${group.month}.${group.day}`
      const minorKey =
        group.kind === 'today'
          ? 'history.anchor.today'
          : 'history.anchor.yesterday'
      return { major, minor: t(minorKey, { weekday }) }
    }
    case 'dayThisMonth': {
      const date = new Date(group.refDate)
      const weekday = shortWeekday(date, locale)
      const major = `${group.month}.${group.day}`
      return { major, minor: weekday }
    }
    case 'monthThisYear': {
      const lang = locale.toLowerCase().slice(0, 2)
      if (lang === 'ko' || lang === 'ja' || lang === 'zh') {
        return {
          major: String(group.month),
          minor: t('history.anchor.monthSameYear'),
        }
      }
      let monthName = String(group.month)
      try {
        monthName = new Intl.DateTimeFormat(locale, { month: 'short' }).format(
          new Date(group.year, group.month - 1, 1),
        )
      } catch { /* ignore */ }
      return { major: monthName }
    }
    case 'monthPastYear':
      return {
        major: t('history.anchor.monthOtherYear', {
          year: group.year,
          month02: zeroPad2(group.month),
        }),
      }
  }
}

function anchorSizeClass(kind: TimelineKind): string {
  return kind === 'monthPastYear'
    ? 'text-body font-display font-bold text-foreground leading-none'
    : 'text-heading font-display font-bold text-foreground leading-none'
}

function estimateTimelineGroupSize(group: TimelineGroup): number {
  return Math.max(80, group.entries.length * 66 + 8)
}

// ─── Main Screen ───

export function HistoryScreen({
  onBack,
  transactions,
  isLoading = false,
  initialFilter,
  initialMintUrls,
  onSelectPendingToken,
}: HistoryScreenProps) {
  'use no memo' // useVirtualizer returns mutable functions incompatible with React Compiler
  const { t, i18n } = useTranslation()
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

  const { getDisplayName, getMetadata, getIconUrl } = useMintMetadata(mintUrls)
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

  // ─── Pending ecash (the dismantled ecash tab's reclaimable section) ───
  // Nullable on purpose: the screen renders without a provider (tests, pre-boot)
  // and simply skips reconciliation.
  const registry = useContext(ServiceContext)
  const triggerTxRefresh = useAppStore((s) => s.triggerTxRefresh)
  const formatSats = useFormatSats()

  // Local reconciliation on view — remote settlement is the watcher/bridge's job.
  // Pacing lives in the service (reconcileGate, 10s): view-entry callers don't throttle.
  useEffect(() => {
    if (!registry?.recoveryScheduler) return
    registry.recoveryScheduler.reconcile()
      .then(() => {
        triggerTxRefresh()
      })
      .catch((err) => {
        console.warn('[HistoryScreen] reconcile failed:', err)
      })
  }, [registry, triggerTxRefresh])

  const { items: pendingItemsRaw, isLoading: isPendingLoading } = useAllPendingItems(settings.mints)
  const pendingSendItems = useMemo(
    () => pendingItemsRaw.filter(isSendToken),
    [pendingItemsRaw],
  )
  const pendingTxIds = useMemo(
    () => pendingSendItems.map((i) => i.id),
    [pendingSendItems],
  )
  const { fees: reclaimFees } = useReclaimFees(pendingTxIds)

  const fiatCurrency = settings.fiatCurrency ?? 'USD'
  const fiatRate = useAppStore((s) => s.allRates?.[fiatCurrency] ?? null)

  const pendingTokens: PendingTokenView[] = useMemo(() => {
    return pendingSendItems.map((item: PendingItem<TokenDetails>) => ({
      id: item.id,
      createdAt: item.createdAt,
      amount: item.amount,
      memo: item.memo ?? '',
      mintUrl: item.accountId,
      tokenString: item.details?.token,
      reclaimFee: reclaimFees.get(item.id),
    }))
  }, [pendingSendItems, reclaimFees])

  // Pending is outstanding value, not history: the screen's mint scope applies,
  // but search and type/date filters don't — searching simply hides the block.
  const visiblePendingTokens = useMemo(() => {
    if (selectedMintUrls.size === 0) return pendingTokens
    const selected = Array.from(selectedMintUrls)
    return pendingTokens.filter(
      (tk) => tk.mintUrl && selected.some((url) => isSameMintUrl(url, tk.mintUrl!)),
    )
  }, [pendingTokens, selectedMintUrls])
  const showPending = searchQuery === '' && visiblePendingTokens.length > 0

  const { reclaimMultiple } = useTokenReclaim()
  // Ids, not snapshots: the sheet derives its tokens live so late fee quotes
  // and mid-sheet settlements flow into the totals.
  const [reclaimTargetIds, setReclaimTargetIds] = useState<Set<string> | null>(null)
  const reclaimTargets = useMemo(
    () => (reclaimTargetIds ? pendingTokens.filter((tk) => reclaimTargetIds.has(tk.id)) : null),
    [reclaimTargetIds, pendingTokens],
  )
  const openReclaimAll = useCallback(() => {
    if (visiblePendingTokens.length === 0) return
    setReclaimTargetIds(new Set(visiblePendingTokens.map((tk) => tk.id)))
  }, [visiblePendingTokens])
  const openReclaimOne = useCallback((token: PendingTokenView) => {
    setReclaimTargetIds(new Set([token.id]))
  }, [])
  const closeReclaim = useCallback(() => setReclaimTargetIds(null), [])
  const confirmReclaim = useCallback(
    async (tokens: PendingTokenView[]) => {
      await reclaimMultiple(
        tokens.map((tk) => tk.id),
        {
          onSuccess: () => setReclaimTargetIds(null),
          onError: () => setReclaimTargetIds(null),
        },
      )
    },
    [reclaimMultiple],
  )

  const handleSharePending = useCallback(
    async (token: PendingTokenView) => {
      const shareText = token.tokenString
        ? token.tokenString
        : t('token.reclaimable.shareText', {
            memo: token.memo,
            amount: formatSats(token.amount),
          })
      await shareOrCopyText(shareText, () => {
        addToast({ type: 'success', message: t('token.reclaimable.copiedToClipboard') })
      })
    },
    [addToast, formatSats, t],
  )

  const handleSelectPending = useCallback(
    (token: PendingTokenView) => {
      if (!onSelectPendingToken) return
      const url = token.mintUrl ?? ''
      const metadata = url ? getMetadata(url) : undefined
      const fiat =
        fiatRate !== null
          ? { amount: satsToFiat(token.amount, fiatRate), currency: fiatCurrency }
          : undefined
      onSelectPendingToken(
        pendingToDetail(token, {
          mintAlias: url ? getDisplayName(url) : undefined,
          mintName: metadata?.name,
          mintIconUrl: url ? getIconUrl(url) : undefined,
          fiat,
        }),
      )
    },
    [onSelectPendingToken, getMetadata, getDisplayName, getIconUrl, fiatRate, fiatCurrency],
  )

  // The pending block sits in normal flow above the virtualized timeline inside
  // the same scroll element — its height must feed the virtualizer as
  // scrollMargin or the visible-range math treats it as scrolled-past content.
  // Callback ref, not an effect: the block mounts/unmounts through several
  // branches (loading, detail early-return), and the observer must follow the
  // actual DOM node, not a hand-picked dependency list.
  const [listScrollMargin, setListScrollMargin] = useState(0)
  const marginObserverRef = useRef<ResizeObserver | null>(null)
  const setPendingBlock = useCallback((node: HTMLDivElement | null) => {
    marginObserverRef.current?.disconnect()
    marginObserverRef.current = null
    if (!node) {
      setListScrollMargin(0)
      return
    }
    const measure = () => setListScrollMargin(node.getBoundingClientRect().height)
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(node)
    marginObserverRef.current = observer
  }, [])
  useEffect(() => () => marginObserverRef.current?.disconnect(), [])

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
        const source = txMeta.source ? t(txSourceKey(txMeta.source)).toLowerCase() : ''
        return memo.includes(query) || mint.includes(query)
          || typeLabel.includes(query) || source.includes(query)
          || String(toNumber(tx.amount)).includes(query)
      })
    }

    return filtered
  }, [transactions, filter, dateCutoff, searchQuery, selectedMintUrls, t])
  const transactionById = useMemo(() => new Map(transactions.map((tx) => [tx.id, tx])), [transactions])

  const timelineGroups = useMemo(
    () => groupTransactionsForTimeline(filteredTransactions),
    [filteredTransactions],
  )
  const locale = getLocaleCode(i18n.language)

  // ─── Virtualizer ───
  const scrollContainerRef = useRef<HTMLDivElement>(null)
  // eslint-disable-next-line react-hooks/incompatible-library -- useVirtualizer is known-incompatible with React Compiler; 'use no memo' above opts out
  const virtualizer = useVirtualizer({
    count: timelineGroups.length,
    getScrollElement: () => scrollContainerRef.current,
    getItemKey: (index) => timelineGroups[index]?.key ?? index,
    estimateSize: (index) => {
      const group = timelineGroups[index]
      return group ? estimateTimelineGroupSize(group) : 80
    },
    overscan: 10,
    scrollMargin: listScrollMargin,
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
      <Suspense fallback={<div className="h-full flex items-center justify-center bg-background"><Spinner /></div>}>
        <TransactionDetailScreen
          transaction={selectedTransaction}
          onBack={() => setSelectedTransaction(null)}
          mintUrls={settings.mints}
        />
      </Suspense>
    )
  }

  return (
    <div className="h-full bg-background text-foreground flex flex-col font-primary relative overflow-hidden z-[60] pt-safe">
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
      <div ref={scrollContainerRef} className="mt-2 flex-1 min-h-0 overflow-y-auto px-5 pb-app">
        {isLoading ? (
          <TransactionListSkeleton count={6} />
        ) : (
          <>
        {showPending && (
          <div ref={setPendingBlock} className="flex flex-col gap-3 pb-6">
            <PendingWidget
              count={visiblePendingTokens.length}
              totalAmount={visiblePendingTokens.reduce((sum, tk) => sum + tk.amount, 0)}
              onViewAll={openReclaimAll}
            />
            <ReclaimableSection
              tokens={visiblePendingTokens}
              onShare={handleSharePending}
              onReclaim={openReclaimOne}
              onSelect={onSelectPendingToken ? handleSelectPending : undefined}
            />
          </div>
        )}
        {timelineGroups.length === 0 ? (
          // No flash while pending loads; no empty state under an unfiltered
          // pending block. A zero-result type/date filter still shows it —
          // otherwise the filtered list would look silently blank.
          isPendingLoading || (showPending && !isTypeFiltered && !isDateFiltered) ? null : (
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
          )
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
                const group = timelineGroups[virtualRow.index]
                const anchor = buildAnchor(t, group, locale)
                return (
                  <div
                    key={virtualRow.key}
                    data-index={virtualRow.index}
                    ref={virtualizer.measureElement}
                    style={{
                      position: 'absolute',
                      // start includes scrollMargin (the pending block above);
                      // subtract it to position within this relative container.
                      top: virtualRow.start - listScrollMargin,
                      left: 0,
                      width: '100%',
                    }}
                  >
                    <div className={`flex items-start gap-3 ${virtualRow.index === timelineGroups.length - 1 ? '' : 'pb-6'}`}>
                      <div className="w-14 shrink-0 pt-1 sticky top-0 self-start">
                        <div className={anchorSizeClass(group.kind)}>
                          {anchor.major}
                        </div>
                        {anchor.minor && (
                          <div className="mt-1.5 text-overline text-foreground-muted">
                            {anchor.minor}
                          </div>
                        )}
                      </div>
                      <div className="flex-1 flex flex-col gap-2 min-w-0">
                        {group.entries.map((tx) => (
                          <HistoryTimelineRow
                            key={tx.id}
                            transaction={tx}
                            linkedTransaction={tx.linkedTxId ? transactionById.get(tx.linkedTxId) : null}
                            groupKind={group.kind}
                            onClick={() => setSelectedTransaction(tx)}
                            getMintName={getDisplayName}
                          />
                        ))}
                      </div>
                    </div>
                  </div>
                )
              })}
            </motion.div>
            <p className="text-caption text-foreground-muted text-center pt-5 pb-8">
              {t('history.endOfList')}
            </p>
          </AnimatePresence>
        )}
          </>
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

      {/* Reclaim Confirmation Sheet (pending ecash) */}
      <ReclaimSheet
        isOpen={reclaimTargets !== null}
        onClose={closeReclaim}
        tokens={reclaimTargets ?? []}
        onConfirm={confirmReclaim}
      />
    </div>
  )
}

export default HistoryScreen
