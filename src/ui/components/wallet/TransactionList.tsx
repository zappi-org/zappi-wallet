import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import type { Transaction } from '@/core/types'
import { useMintMetadata } from '@/hooks'
import { cn } from '@/lib/utils'
import { TransactionRow } from './TransactionRow'

interface TransactionListProps {
  transactions: Transaction[]
  onSeeAll?: () => void
  onTransactionClick?: (tx: Transaction) => void
  maxItems?: number
  showHeader?: boolean
  showDate?: boolean
  className?: string
}

export function TransactionList({
  transactions,
  onSeeAll,
  onTransactionClick,
  maxItems = 5,
  showHeader = true,
  showDate = false,
  className,
}: TransactionListProps) {
  const { t } = useTranslation()
  const displayTransactions = transactions.slice(0, maxItems)

  // Collect all mint URLs for metadata lookup
  const mintUrls = useMemo(() => {
    const urls = new Set<string>()
    displayTransactions.forEach((tx) => {
      urls.add(tx.mintUrl)
      if (tx.type === 'swap' && tx.metadata?.toMintUrl) urls.add(tx.metadata.toMintUrl as string)
      if (tx.type === 'swap' && tx.metadata?.fromMintUrl) urls.add(tx.metadata.fromMintUrl as string)
    })
    return Array.from(urls)
  }, [displayTransactions])

  const { getDisplayName } = useMintMetadata(mintUrls)

  return (
    <div className={cn('flex flex-col w-full px-6 py-1', className)}>
      {showHeader && (
        <div className="flex items-center justify-between pt-[4px] mb-2">
          <div />
          {onSeeAll && (
            <button
              onClick={onSeeAll}
              className={`text-label text-foreground-muted hover:text-foreground transition-colors ${transactions.length === 0 ? 'invisible' : ''}`}
            >
              {t('home.seeAll')}
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
                <div className="h-px bg-border/30 mx-4" />
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
