import { useState, useMemo, useCallback } from 'react'
import { ArrowLeft, EllipsisVertical, ChevronRight } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { MintCard, resolveMintColor } from '@/ui/components/wallet/MintCard'
import { TransactionList } from '@/ui/components/wallet/TransactionList'
import { PendingItemsList } from '@/ui/components/wallet/PendingItemsList'
import { usePendingItems } from '@/ui/hooks/usePendingItems'
import { hapticTap } from '@/ui/utils/haptic'
import { useAppStore } from '@/store'
import { useMintMetadata } from '@/ui/hooks/use-mint-metadata'
import { useWallet } from '@/ui/hooks'
import { getMintBalance } from '@/utils/url'
import type { MintInfo } from '@/core/types'
import type { Transaction } from '@/core/domain/transaction'
import { MintInfoSheet } from './MintInfoSheet'
import { PendingItemsScreen } from './PendingItemsScreen'
import { PendingItemDetailScreen } from './PendingItemDetailScreen'
import type { PendingItem } from '@/ui/hooks/usePendingItems'

export interface MintDetailScreenProps {
  mint: MintInfo
  mintIndex: number
  onBack: () => void
  onCreateToken: (mintUrl: string) => void
  onDeleteMint: (url: string) => Promise<void>
  onRenameMint?: (url: string, newName: string) => void
  onChangeMintColor?: (url: string, color: string) => void
  onSelectTransaction: (tx: Transaction) => void
  onTransactions?: () => void
  transactions: Transaction[]
  onFindTransaction?: (id: string) => Promise<Transaction | null>
  pendingItemCallbacks?: import('./PendingItemDetailScreen').PendingItemDetailCallbacks
}

export function MintDetailScreen({
  mint,
  mintIndex,
  onBack,
  onCreateToken: _onCreateToken,
  onDeleteMint,
  onRenameMint,
  onChangeMintColor,
  onSelectTransaction,
  onTransactions,
  transactions,
  onFindTransaction,
  pendingItemCallbacks,
}: MintDetailScreenProps) {
  const { t } = useTranslation()
  const settings = useAppStore((s) => s.settings)
  const { getDisplayName } = useMintMetadata(settings.mints)
  const [showMintInfo, setShowMintInfo] = useState(false)
  const [showPendingItems, setShowPendingItems] = useState(false)
  const [selectedPendingItem, setSelectedPendingItem] = useState<PendingItem | null>(null)

  const handlePendingItemClick = useCallback(async (item: PendingItem) => {
    hapticTap()
    if (item.direction === 'send' && item.kind === 'token') {
      // sent-token has a matching transaction — navigate to TransactionDetailScreen
      try {
        if (onFindTransaction) {
          const tx = await onFindTransaction(item.id)
          if (tx) {
            onSelectTransaction(tx)
            return
          }
        }
      } catch { /* fallthrough to detail sheet */ }
    }
    // receive-request, unclaimed-token → show detail screen
    setSelectedPendingItem(item)
  }, [onSelectTransaction, onFindTransaction])

  const { variant, customColor } = resolveMintColor(mint.url, mintIndex, settings.mintColors)
  const { items: pendingItems, refresh: refreshPendingItems } = usePendingItems(mint.url)

  // Live balance from wallet (prop snapshot may be stale after reclaim/receive)
  const { balance } = useWallet()
  const liveMint = useMemo<MintInfo>(
    () => ({ ...mint, balance: getMintBalance(mint.url, balance.byMint) }),
    [mint, balance.byMint],
  )

  // Filter transactions by this mint
  const filteredTransactions = useMemo(() => {
    const url = mint.url
    const normalized = url.endsWith('/') ? url.slice(0, -1) : url
    return transactions.filter((tx) => {
      const txUrl = tx.accountId?.endsWith('/') ? tx.accountId.slice(0, -1) : tx.accountId
      return txUrl === normalized || txUrl === url
    })
  }, [transactions, mint.url])

  if (selectedPendingItem) {
    return (
      <PendingItemDetailScreen
        item={selectedPendingItem}
        onBack={() => setSelectedPendingItem(null)}
        callbacks={pendingItemCallbacks}
        onItemRemoved={() => refreshPendingItems()}
      />
    )
  }

  if (showPendingItems) {
    return (
      <PendingItemsScreen
        onBack={() => setShowPendingItems(false)}
        onItemClick={handlePendingItemClick}
        initialMintUrls={[mint.url]}
      />
    )
  }

  return (
    <div className="h-dvh bg-background flex flex-col pt-safe">
      {/* Header */}
      <header className="relative flex items-center justify-between px-5 h-14 shrink-0">
        <button
          onClick={() => { hapticTap(); onBack() }}
          className="w-10 h-10 -ml-1.5 rounded-lg flex items-center justify-center hover:bg-foreground/[0.04] active:bg-foreground/[0.06] transition-colors z-10"
          aria-label={t('common.back')}
        >
          <ArrowLeft className="w-[22px] h-[22px] text-foreground" strokeWidth={1.8} />
        </button>
        <h1 className="absolute inset-0 flex items-center justify-center text-subtitle font-semibold text-foreground pointer-events-none">
          {t('mintDetail.title')}
        </h1>
        <button
          onClick={() => { hapticTap(); setShowMintInfo(true) }}
          className="w-10 h-10 rounded-lg flex items-center justify-center hover:bg-foreground/[0.04] active:bg-foreground/[0.06] transition-colors z-10"
          aria-label={t('mintDetail.mintInfo')}
        >
          <EllipsisVertical className="w-[22px] h-[22px] text-foreground" strokeWidth={1.8} />
        </button>
      </header>

      {/* Scrollable Content */}
      <main className="flex-1 overflow-y-auto pb-app">
        {/* Mint Card — with inline rename */}
        <div className="flex justify-center pt-2">
          <MintCard
            mint={liveMint}
            variant={variant}
            customColor={customColor}
            hideBalance={settings.balanceHidden}
          />
        </div>

        {/* Content aligned to card width */}
        <div className="w-[var(--card-w)] mx-auto space-y-6 mt-6">
          {/* Pending Items */}
          {pendingItems.length > 0 && (
            <section>
              <div className="flex items-center justify-between mb-3">
                <h2 className="text-caption font-semibold text-foreground-muted">
                  {t('mintDetail.pendingItems')}
                </h2>
                <button
                  onClick={() => { hapticTap(); setShowPendingItems(true) }}
                  className="flex items-center gap-0.5 text-caption font-medium text-brand hover:text-brand-700 active:scale-95 transition-all"
                >
                  {t('mintDetail.seeMore')}
                  <ChevronRight className="w-4 h-4" strokeWidth={2} />
                </button>
              </div>
              <PendingItemsList items={pendingItems} maxItems={5} showDate onItemClick={handlePendingItemClick} />
            </section>
          )}

          {/* Transactions */}
          <section>
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-caption font-semibold text-foreground-muted">
                {t('mintDetail.transactions')}
              </h2>
              {onTransactions && (
                <button
                  onClick={onTransactions}
                  className="flex items-center gap-0.5 text-caption font-medium text-brand hover:text-brand-700 active:scale-95 transition-all"
                >
                  {t('mintDetail.seeDetails')}
                  <ChevronRight className="w-4 h-4" strokeWidth={2} />
                </button>
              )}
            </div>
            {filteredTransactions.length > 0 ? (
              <TransactionList
                transactions={filteredTransactions}
                allTransactions={transactions}
                onTransactionClick={onSelectTransaction}
                showHeader={false}
                showDate
                className="px-0 py-0"
              />
            ) : (
              <p className="text-caption text-foreground-muted text-center py-4">
                {t('mintDetail.noTransactions')}
              </p>
            )}
          </section>
        </div>
      </main>

      {/* Mint Info Sheet */}
      <MintInfoSheet
        isOpen={showMintInfo}
        mint={mint}
        onClose={() => setShowMintInfo(false)}
        onDelete={onDeleteMint}
        onRename={onRenameMint}
        onChangeColor={onChangeMintColor}
        getDisplayName={getDisplayName}
      />

    </div>
  )
}
