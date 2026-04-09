import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import type { Transaction } from '@/core/domain/transaction'
import { getTransactionType, getTxMeta } from '@/core/domain/transaction'
import { useMintMetadata } from '@/ui/hooks'
import { cn } from '@/lib/utils'
import { TransactionRow } from './TransactionRow'

interface TransactionListProps {
  transactions: Transaction[]
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

  // Collect all mint URLs for metadata lookup
  const mintUrls = useMemo(() => {
    const urls = new Set<string>()
    displayTransactions.forEach((tx) => {
      urls.add(tx.accountId)
      const meta = getTxMeta(tx)
      if (getTransactionType(tx) === 'swap') {
        if (meta.toMintUrl) urls.add(meta.toMintUrl)
        if (meta.fromMintUrl) urls.add(meta.fromMintUrl)
      }
    })
    return Array.from(urls)
  }, [displayTransactions])

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
