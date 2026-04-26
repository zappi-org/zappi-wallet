import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import type { Transaction } from '@/core/domain/transaction'
import { getTransactionType, getTxMeta } from '@/core/domain/transaction'
import { useMintMetadata } from '@/ui/hooks'
import { cn } from '@/ui/lib/utils'
import { TransactionRow } from './TransactionRow'

interface TransactionListProps {
  transactions: Transaction[]
  allTransactions?: Transaction[]
  onSeeAll?: () => void
  onTransactionClick?: (tx: Transaction) => void
  maxItems?: number
  showHeader?: boolean
  showDate?: boolean
  title?: string
  className?: string
}

export function TransactionList({
  transactions,
  allTransactions,
  onSeeAll,
  onTransactionClick,
  maxItems = 5,
  showHeader = true,
  showDate = false,
  title,
  className,
}: TransactionListProps) {
  const { t } = useTranslation()
  const displayTransactions = transactions.slice(0, maxItems)
  const routeTransactions = allTransactions ?? transactions
  const transactionById = useMemo(() => new Map(routeTransactions.map((tx) => [tx.id, tx])), [routeTransactions])

  // Collect all mint URLs for metadata lookup
  const mintUrls = useMemo(() => {
    const urls = new Set<string>()
    displayTransactions.forEach((tx) => {
      urls.add(tx.accountId)
      const meta = getTxMeta(tx)
      const linkedMeta = tx.linkedTxId ? getTxMeta(transactionById.get(tx.linkedTxId) ?? tx) : null
      if (getTransactionType(tx) === 'swap') {
        const fromMintUrl = meta.fromMintUrl ?? linkedMeta?.fromMintUrl
        const toMintUrl = meta.toMintUrl ?? linkedMeta?.toMintUrl
        if (toMintUrl) urls.add(toMintUrl)
        if (fromMintUrl) urls.add(fromMintUrl)
      }
    })
    return Array.from(urls)
  }, [displayTransactions, transactionById])

  const { getDisplayName } = useMintMetadata(mintUrls)

  return (
    <div className={cn('flex flex-col w-full px-6 py-1', className)}>
      {showHeader && (
        <div className="flex items-center justify-between pt-[4px] mb-2 px-4">
          {title ? (
            <h2 className="text-caption font-semibold text-foreground-muted">{title}</h2>
          ) : (
            <div />
          )}
          {onSeeAll && (
            <button
              onClick={onSeeAll}
              className={`flex items-center gap-0.5 text-caption font-medium text-brand hover:text-brand-700 active:scale-95 transition-all ${transactions.length === 0 ? 'invisible' : ''}`}
            >
              {t('home.seeAll')}
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none" className="mt-px">
                <path d="M6 4l4 4-4 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
            </button>
          )}
        </div>
      )}

      {transactions.length === 0 ? (
        <div className="flex items-center justify-center h-[75px] text-foreground-muted">
          <p className="text-caption opacity-60">{t('home.noTransactions')}</p>
        </div>
      ) : (
        <div className="flex flex-col">
          {displayTransactions.map((tx, index) => (
            <div key={tx.id}>
              <TransactionRow
                transaction={tx}
                linkedTransaction={tx.linkedTxId ? transactionById.get(tx.linkedTxId) : null}
                onClick={() => onTransactionClick?.(tx)}
                getMintName={getDisplayName}
                showDate={showDate}
              />
              {index < displayTransactions.length - 1 && (
                <div className="h-px bg-border/30" />
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
