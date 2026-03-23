import { useState, useMemo, useRef, useCallback } from 'react'
import { ArrowLeft, ArrowUpRight, ArrowDownLeft, ArrowLeftRight, EllipsisVertical, Pencil } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { MintCard, getVariantByIndex } from '@/ui/components/wallet/MintCard'
import { TransactionList } from '@/ui/components/wallet/TransactionList'
import { PendingItemsList } from '@/ui/components/wallet/PendingItemsList'
import { usePendingItems } from '@/hooks/usePendingItems'
import { hapticTap } from '@/utils/haptic'
import { useAppStore } from '@/store'
import type { MintInfo, Transaction } from '@/core/types'
import { MintInfoSheet } from './MintInfoSheet'
import { PendingItemsScreen } from './PendingItemsScreen'
import { PendingItemDetailScreen } from './PendingItemDetailScreen'
import type { PendingItem } from '@/hooks/usePendingItems'

export interface MintDetailScreenProps {
  mint: MintInfo
  mintIndex: number
  onBack: () => void
  onSend: (mintUrl: string) => void
  onReceive: (mintUrl: string) => void
  onSwap: (mintUrl: string) => void
  onCreateToken: (mintUrl: string) => void
  onDeleteMint: (url: string) => void
  onRenameMint?: (url: string, newName: string) => void
  onSelectTransaction: (tx: Transaction) => void
  onTransactions?: () => void
  transactions: Transaction[]
}

export function MintDetailScreen({
  mint,
  mintIndex,
  onBack,
  onSend,
  onReceive,
  onSwap,
  onCreateToken,
  onDeleteMint,
  onRenameMint,
  onSelectTransaction,
  onTransactions,
  transactions,
}: MintDetailScreenProps) {
  const { t } = useTranslation()
  const settings = useAppStore((s) => s.settings)
  const [showMintInfo, setShowMintInfo] = useState(false)
  const [showPendingItems, setShowPendingItems] = useState(false)
  const [selectedPendingItem, setSelectedPendingItem] = useState<PendingItem | null>(null)
  const [isEditingName, setIsEditingName] = useState(false)
  const [editNameValue, setEditNameValue] = useState('')
  const nameInputRef = useRef<HTMLInputElement>(null)

  const displayAlias = mint.alias || mint.name || ''

  const handleStartEditName = useCallback(() => {
    setEditNameValue(displayAlias)
    setIsEditingName(true)
    setTimeout(() => nameInputRef.current?.focus(), 50)
  }, [displayAlias])

  const handleSaveName = useCallback(() => {
    const trimmed = editNameValue.trim()
    if (trimmed && onRenameMint) {
      onRenameMint(mint.url, trimmed)
    }
    setIsEditingName(false)
  }, [mint.url, editNameValue, onRenameMint])

  const handlePendingItemClick = useCallback(async (item: PendingItem) => {
    hapticTap()
    if (item.type === 'ecash-request') {
      // ecash-request has a matching transaction — navigate to TransactionDetailScreen
      try {
        const { getDatabase } = await import('@/data/database/schema')
        const db = getDatabase()
        const tx = await db.transactions.get(item.id)
        if (tx) {
          onSelectTransaction(tx)
          return
        }
      } catch { /* fallthrough to detail sheet */ }
    }
    // receive-request, unclaimed-token → show detail screen
    setSelectedPendingItem(item)
  }, [onSelectTransaction])

  const variant = getVariantByIndex(mintIndex)
  const { items: pendingItems } = usePendingItems(mint.url)

  // Filter transactions by this mint
  const filteredTransactions = useMemo(() => {
    const url = mint.url
    const normalized = url.endsWith('/') ? url.slice(0, -1) : url
    return transactions.filter((tx) => {
      const txUrl = tx.mintUrl?.endsWith('/') ? tx.mintUrl.slice(0, -1) : tx.mintUrl
      return txUrl === normalized || txUrl === url
    })
  }, [transactions, mint.url])

  const actions = [
    { key: 'send', label: t('mintDetail.send'), icon: ArrowUpRight, colorClass: 'text-accent-warning', bgClass: 'bg-accent-warning/10', onClick: () => onSend(mint.url) },
    { key: 'receive', label: t('mintDetail.receive'), icon: ArrowDownLeft, colorClass: 'text-accent-success', bgClass: 'bg-accent-success/10', onClick: () => onReceive(mint.url) },
    { key: 'swap', label: t('mintDetail.swap'), icon: ArrowLeftRight, colorClass: 'text-foreground-muted', bgClass: 'bg-foreground/[0.06]', onClick: () => onSwap(mint.url) },
  ]

  if (selectedPendingItem) {
    return (
      <PendingItemDetailScreen
        item={selectedPendingItem}
        onBack={() => setSelectedPendingItem(null)}
      />
    )
  }

  if (showPendingItems) {
    return (
      <PendingItemsScreen
        items={pendingItems}
        onBack={() => setShowPendingItems(false)}
        onItemClick={handlePendingItemClick}
      />
    )
  }

  return (
    <div className="h-dvh bg-background flex flex-col pt-safe">
      {/* Header */}
      <header className="flex items-center justify-between px-4 h-14 shrink-0">
        <button
          onClick={() => { hapticTap(); onBack() }}
          className="w-10 h-10 flex items-center justify-center rounded-full hover:bg-background-hover transition-colors"
          aria-label={t('common.back')}
        >
          <ArrowLeft className="w-5 h-5 text-foreground" />
        </button>
        <h1 className="text-subtitle text-foreground">
          {t('mintDetail.title')}
        </h1>
        <button
          onClick={() => { hapticTap(); setShowMintInfo(true) }}
          className="w-10 h-10 flex items-center justify-center rounded-full hover:bg-background-hover transition-colors"
          aria-label={t('mintDetail.mintInfo')}
        >
          <EllipsisVertical className="w-5 h-5 text-foreground" />
        </button>
      </header>

      {/* Scrollable Content */}
      <main className="flex-1 overflow-y-auto px-4 pb-8 space-y-6">
        {/* Mint Card */}
        <div className="flex justify-center">
          <MintCard
            mint={mint}
            variant={variant}
            hideBalance={settings.balanceHidden}
            onCreateToken={() => onCreateToken(mint.url)}
          />
        </div>

        {/* Editable Name */}
        <div className="flex justify-center -mt-2">
          {isEditingName ? (
            <div className="flex flex-col items-center gap-1">
              <input
                ref={nameInputRef}
                type="text"
                value={editNameValue}
                onChange={(e) => setEditNameValue(e.target.value.slice(0, 10))}
                onKeyDown={(e) => { if (e.key === 'Enter') handleSaveName() }}
                onBlur={handleSaveName}
                placeholder={t('mintDetail.namePlaceholder')}
                maxLength={10}
                className="font-semibold text-body text-foreground text-center bg-muted rounded-lg px-3 py-1.5 outline-none focus:ring-2 focus:ring-primary/30 w-48"
              />
              <span className="text-overline text-foreground-muted">{editNameValue.length}/10</span>
            </div>
          ) : (
            <button
              onClick={handleStartEditName}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg hover:bg-background-hover transition-colors group"
            >
              <span className="font-semibold text-body text-foreground">
                {displayAlias}
              </span>
              <Pencil className="w-3.5 h-3.5 text-foreground-muted opacity-60 group-hover:opacity-100 transition-opacity" />
            </button>
          )}
        </div>

        {/* Action Row */}
        <div className="py-3 flex items-start justify-evenly">
          {actions.map(({ key, label, icon: Icon, colorClass, bgClass, onClick }) => (
            <button
              key={key}
              onClick={() => { hapticTap(); onClick() }}
              disabled={key === 'send' && mint.balance === 0}
              className="flex flex-col items-center gap-1.5 w-20 active:scale-95 transition-transform disabled:opacity-40"
            >
              <div className={`w-[52px] h-[52px] ${bgClass} rounded-full flex items-center justify-center shadow-[0px_2px_1px_0px_rgba(0,0,0,0.25)]`}>
                <Icon className={`w-6 h-6 ${colorClass}`} strokeWidth={2} />
              </div>
              <span className="text-label font-bold text-foreground leading-normal">
                {label}
              </span>
            </button>
          ))}
        </div>

        {/* Pending Items */}
        {pendingItems.length > 0 && (
          <section>
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-label font-semibold text-foreground-muted">
                {t('mintDetail.pendingItems')}
              </h2>
              <button
                onClick={() => { hapticTap(); setShowPendingItems(true) }}
                className="font-medium text-caption text-foreground-muted"
              >
                {t('mintDetail.seeMore')}
              </button>
            </div>
            <PendingItemsList items={pendingItems} maxItems={5} showDate onItemClick={handlePendingItemClick} />
          </section>
        )}

        {/* Transactions */}
        <section>
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-label font-semibold text-foreground-muted">
              {t('mintDetail.transactions')}
            </h2>
            {onTransactions && (
              <button
                onClick={onTransactions}
                className="font-medium text-caption text-foreground-muted"
              >
                {t('mintDetail.seeDetails')}
              </button>
            )}
          </div>
          {filteredTransactions.length > 0 ? (
            <TransactionList
              transactions={filteredTransactions}
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
      </main>

      {/* Mint Info Sheet */}
      <MintInfoSheet
        isOpen={showMintInfo}
        mint={mint}
        onClose={() => setShowMintInfo(false)}
        onDelete={onDeleteMint}
        onRename={onRenameMint}
      />

    </div>
  )
}
