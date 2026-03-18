import { memo, useCallback, useMemo, useRef, useState } from 'react'
import { ArrowLeft, ArrowDownLeft, ArrowUpRight, ArrowRightLeft, Search, Zap, Banknote } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { useVirtualizer } from '@tanstack/react-virtual'
import type { Transaction } from '@/core/types'
import { useFormatSats } from '@/utils/format'
import { useMintMetadata } from '@/hooks'

export interface HistoryScreenProps {
  onBack: () => void
  transactions: Transaction[]
  isLoading?: boolean
  onSelectTransaction?: (tx: Transaction) => void
}

type FilterType = 'all' | 'income' | 'expense' | 'swap'

interface GroupedTransactions {
  label: string
  transactions: Transaction[]
}

type FlatItem =
  | { type: 'header'; label: string }
  | { type: 'transaction'; tx: Transaction }

function getLocaleCode(lang: string): string {
  const localeMap: Record<string, string> = { ko: 'ko-KR', ja: 'ja-JP', es: 'es-ES', id: 'id-ID', en: 'en-US' }
  return localeMap[lang] || 'en-US'
}

function formatMintUrl(url: string): string {
  try {
    const parsed = new URL(url)
    return parsed.hostname
  } catch {
    return url
  }
}

const TransactionItem = memo(function TransactionItem({
  transaction,
  onClick,
  getMintName,
}: {
  transaction: Transaction
  onClick?: () => void
  getMintName?: (url: string) => string
}) {
  const { t, i18n } = useTranslation()
  const formatSats = useFormatSats()
  const isReceive = transaction.direction === 'receive'
  const statusColors = {
    pending: 'text-accent-warning-bright',
    completed: 'text-accent-primary',
    failed: 'text-accent-danger',
  }
  const statusLabels = {
    pending: t('history.pendingStatus'),
    completed: t('history.completed'),
    failed: t('history.failedStatus'),
  }

  // Check if this is a swap transaction
  const isSwap = transaction.type === 'swap'
  const fromMintUrl = isSwap ? (transaction.metadata?.fromMintUrl as string) || transaction.mintUrl : transaction.mintUrl
  const toMintUrl = isSwap ? (transaction.metadata?.toMintUrl as string) : null

  // Determine icon based on transaction type
  const getIcon = () => {
    if (isSwap) {
      return <ArrowRightLeft className="w-4 h-4" />
    }
    if (transaction.type === 'lightning') {
      return <Zap className="w-4 h-4" />
    }
    if (isReceive) {
      return <ArrowDownLeft className="w-4 h-4" />
    }
    return <ArrowUpRight className="w-4 h-4" />
  }

  // Generate title
  const getTitle = () => {
    if (transaction.memo) {
      return transaction.memo
    }
    if (isSwap) {
      return t('history.swap')
    }
    if (transaction.type === 'lightning') {
      return isReceive ? t('history.lightningReceive') : t('history.lightningSend')
    }
    return isReceive ? t('history.ecashReceive') : t('history.ecashSend')
  }

  return (
    <button
      onClick={onClick}
      className="w-full flex items-center justify-between p-3 rounded-2xl bg-white hover:shadow-md border border-primary/5 transition-shadow cursor-pointer group animate-fadeIn"
    >
      <div className="flex items-center gap-3">
        <div className={`w-10 h-10 rounded-xl flex items-center justify-center transition-colors ${
          isSwap
            ? 'bg-badge-lightning-bg text-accent-primary group-hover:bg-badge-lightning-hover'
            : 'bg-background-card text-foreground group-hover:bg-background'
        }`}>
          {getIcon()}
        </div>
        <div className="flex flex-col gap-0.5 text-left">
          <span className="text-xs font-bold text-foreground">{getTitle()}</span>
          {isSwap ? (
            <div className="flex flex-col text-[10px] text-foreground-muted font-medium">
              <span className="truncate max-w-[140px]">
                {getMintName ? getMintName(fromMintUrl) : formatMintUrl(fromMintUrl)}
              </span>
              <span className="truncate max-w-[140px]">
                → {toMintUrl ? (getMintName ? getMintName(toMintUrl) : formatMintUrl(toMintUrl)) : ''}
              </span>
            </div>
          ) : (
            <span className="text-[10px] text-foreground-muted font-medium truncate max-w-[150px]">
              {/* For Lightning sends, show destination if available */}
              {transaction.type === 'lightning' && transaction.direction === 'send' && transaction.metadata?.destination
                ? (transaction.metadata.destination as string).includes('@')
                  ? (transaction.metadata.destination as string)
                  : `${(transaction.metadata.destination as string).slice(0, 20)}...`
                : (getMintName ? getMintName(transaction.mintUrl) : formatMintUrl(transaction.mintUrl))}
            </span>
          )}
        </div>
      </div>
      <div className="flex flex-col items-end gap-0.5">
        <span className={`text-xs font-bold ${isSwap ? 'text-accent-primary' : isReceive ? 'text-card-green-dark' : 'text-foreground'}`}>
          {isSwap ? (
            <>{formatSats(transaction.amount)}</>
          ) : (
            <>{isReceive ? '+' : '-'}{formatSats(transaction.amount)}</>
          )}
        </span>
        <div className="flex items-center gap-2">
          <span className={`text-[10px] font-medium ${statusColors[transaction.status]}`}>
            {statusLabels[transaction.status]}
          </span>
          <span className="text-[10px] text-foreground-timestamp font-medium">{new Date(transaction.createdAt).toLocaleTimeString(getLocaleCode(i18n.language), { hour: '2-digit', minute: '2-digit' })}</span>
        </div>
      </div>
    </button>
  )
})

export function HistoryScreen({
  onBack,
  transactions,
  isLoading = false,
  onSelectTransaction,
}: HistoryScreenProps) {
  'use no memo' // useVirtualizer returns mutable functions incompatible with React Compiler
  const { t, i18n } = useTranslation()
  const [filter, setFilter] = useState<FilterType>('all')
  const [searchQuery, setSearchQuery] = useState('')
  const [showSearch, setShowSearch] = useState(false)

  // Date formatting helper with i18n support
  const formatDateLabel = useCallback((timestamp: number): string => {
    const date = new Date(timestamp)
    const now = new Date()
    const yesterday = new Date(now)
    yesterday.setDate(yesterday.getDate() - 1)
    const locale = getLocaleCode(i18n.language)

    if (date.toDateString() === now.toDateString()) {
      return t('history.today', { defaultValue: 'Today' })
    } else if (date.toDateString() === yesterday.toDateString()) {
      return t('history.yesterday', { defaultValue: 'Yesterday' })
    } else {
      return date.toLocaleDateString(locale, {
        month: 'long',
        day: 'numeric',
      })
    }
  }, [t, i18n.language])

  // Extract unique mint URLs for metadata lookup (including swap from/to mints)
  const mintUrls = useMemo(() => {
    const urls = new Set<string>()
    transactions.forEach((tx) => {
      urls.add(tx.mintUrl)
      if (tx.type === 'swap') {
        if (tx.metadata?.fromMintUrl) urls.add(tx.metadata.fromMintUrl as string)
        if (tx.metadata?.toMintUrl) urls.add(tx.metadata.toMintUrl as string)
      }
    })
    return Array.from(urls)
  }, [transactions])

  const { getDisplayName } = useMintMetadata(mintUrls)

  // Filter and group transactions by date
  const groupedTransactions = useMemo(() => {
    const groups: Map<string, Transaction[]> = new Map()

    // Filter transactions - only show completed
    let filtered = [...transactions]
      .filter((tx) => tx.status === 'completed')
      .sort((a, b) => b.createdAt - a.createdAt)

    // Apply type filter
    if (filter === 'income') {
      filtered = filtered.filter((tx) => tx.direction === 'receive' && tx.type !== 'swap')
    } else if (filter === 'expense') {
      filtered = filtered.filter((tx) => tx.direction === 'send' && tx.type !== 'swap')
    } else if (filter === 'swap') {
      filtered = filtered.filter((tx) => tx.type === 'swap')
    }

    // Apply search filter
    if (searchQuery) {
      const query = searchQuery.toLowerCase()
      filtered = filtered.filter((tx) => {
        const memo = tx.memo?.toLowerCase() || ''
        const mint = tx.mintUrl.toLowerCase()
        return memo.includes(query) || mint.includes(query)
      })
    }

    for (const tx of filtered) {
      const dateLabel = formatDateLabel(tx.createdAt)
      const existing = groups.get(dateLabel) || []
      groups.set(dateLabel, [...existing, tx])
    }

    const result: GroupedTransactions[] = []
    groups.forEach((txs, label) => {
      result.push({ label, transactions: txs })
    })

    return result
  }, [transactions, filter, searchQuery, formatDateLabel])

  // Flatten grouped transactions for virtualization
  const flatItems = useMemo(() => {
    const items: FlatItem[] = []
    for (const group of groupedTransactions) {
      items.push({ type: 'header', label: group.label })
      for (const tx of group.transactions) {
        items.push({ type: 'transaction', tx })
      }
    }
    return items
  }, [groupedTransactions])

  // Virtual list setup
  const scrollContainerRef = useRef<HTMLDivElement>(null)
  // eslint-disable-next-line react-hooks/incompatible-library -- useVirtualizer is known-incompatible with React Compiler; 'use no memo' above opts out
  const virtualizer = useVirtualizer({
    count: flatItems.length,
    getScrollElement: () => scrollContainerRef.current,
    estimateSize: (index) => flatItems[index].type === 'header' ? 40 : 76,
    overscan: 10,
  })

  const filterLabels: Record<FilterType, string> = {
    all: t('history.all'),
    income: t('history.received'),
    expense: t('history.sent'),
    swap: t('history.swap'),
  }

  return (
    <div
      className="h-dvh bg-background text-foreground flex flex-col font-sans relative overflow-hidden z-[60] pt-safe"
    >
      {/* Header */}
      <header className="flex items-center justify-between px-3 pt-4 relative z-50">
        <div className="flex items-center">
          <button
            onClick={onBack}
            aria-label={t('common.back')}
            className="p-2 rounded-full bg-white/80 shadow-sm hover:shadow-md transition-all hover:bg-background-card"
          >
            <ArrowLeft className="w-4 h-4" />
          </button>
          <h2 className="text-base font-bold tracking-tight ml-3">{t('history.title')}</h2>
        </div>
        <button
          onClick={() => setShowSearch(!showSearch)}
          className={`p-2 rounded-full transition-all shadow-sm ${
            showSearch ? 'bg-primary text-primary-foreground' : 'bg-white/80 hover:shadow-md hover:bg-background-card'
          }`}
        >
          <Search className="w-4 h-4" />
        </button>
      </header>

      {/* Search Bar */}
      <div
        className={`overflow-hidden transition-all duration-200 ease-out bg-background ${showSearch ? 'max-h-20 opacity-100 px-4 pb-3' : 'max-h-0 opacity-0'}`}
      >
        <input
          type="text"
          placeholder={t('scanner.inputPlaceholder')}
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="w-full bg-white/60 p-3 rounded-xl border border-white/50 focus:border-primary/30 outline-none text-foreground placeholder:text-foreground-muted/50"
        />
      </div>

      {/* Filter Bar */}
      <div className="px-4 py-3 flex gap-2 overflow-x-auto scrollbar-hide">
        {(['all', 'income', 'expense', 'swap'] as FilterType[]).map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={`px-4 py-1.5 rounded-full text-xs font-bold transition-all ${
              filter === f
                ? 'bg-primary text-primary-foreground'
                : 'bg-white/50 text-foreground-muted hover:bg-white'
            }`}
          >
            {filterLabels[f]}
          </button>
        ))}
      </div>

      {/* List */}
      <div ref={scrollContainerRef} className="flex-1 overflow-y-auto px-4 pb-32">
        {isLoading ? (
          <div className="space-y-2">
            {[...Array(5)].map((_, i) => (
              <div key={i} className="h-16 bg-white/40 rounded-2xl animate-pulse" />
            ))}
          </div>
        ) : flatItems.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 text-center">
            <div className="w-12 h-12 bg-white/60 rounded-full flex items-center justify-center mb-3">
              <Banknote className="w-6 h-6 text-foreground-muted" />
            </div>
            <p className="text-xs text-foreground-muted font-medium">
              {t('history.noTransactions')}
            </p>
          </div>
        ) : (
          <div
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
                    <h3 className="text-xs font-bold text-foreground-muted pt-4 pb-2 px-2">
                      {item.label}
                    </h3>
                  ) : (
                    <div className="pb-2">
                      <TransactionItem
                        transaction={item.tx}
                        onClick={() => onSelectTransaction?.(item.tx)}
                        getMintName={getDisplayName}
                      />
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}

export default HistoryScreen
