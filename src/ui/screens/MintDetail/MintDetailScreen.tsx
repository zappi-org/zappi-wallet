import { useState, useMemo, useCallback } from 'react'
import { ArrowDown, ArrowLeft, ArrowUp, Info, ReceiptText, Settings } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { MintCard, resolveMintColor } from '@/ui/components/wallet/MintCard'
import { usePendingItems } from '@/ui/hooks/usePendingItems'
import { hapticTap } from '@/ui/utils/haptic'
import { useAppStore } from '@/store'
import { useMintMetadata } from '@/ui/hooks/use-mint-metadata'
import { useWallet } from '@/ui/hooks'
import { getMintBalance } from '@/utils/url'
import type { MintCardDesignPreset, MintInfo } from '@/core/types'
import type { Transaction } from '@/core/domain/transaction'
import { MintInfoSheet } from './MintInfoSheet'
import { PendingItemsScreen } from './PendingItemsScreen'
import { PendingItemDetailScreen } from './PendingItemDetailScreen'
import type { PendingItem } from '@/ui/hooks/usePendingItems'

function MintActionTile({
  icon,
  label,
  onClick,
  className,
}: {
  icon: React.ReactNode
  label: string
  onClick: () => void
  className?: string
}) {
  return (
    <button
      onClick={() => { hapticTap(); onClick() }}
      className={`flex flex-col items-center justify-center gap-1.5 rounded-[20px] bg-background-card border border-border/60 py-4 text-foreground active:scale-[0.98] transition-transform ${className ?? ''}`}
    >
      {icon}
      <span className="text-caption font-semibold">{label}</span>
    </button>
  )
}

export interface MintDetailScreenProps {
  mint: MintInfo
  mintIndex: number
  onBack: () => void
  onSend: (mintUrl: string) => void
  onReceive: (mintUrl: string) => void
  onDeleteMint: (url: string) => Promise<void>
  onRenameMint?: (url: string, newName: string) => void
  onChangeMintColor?: (url: string, color: string) => void
  onChangeMintCardDesign?: (url: string, preset: MintCardDesignPreset) => void
  onSelectTransaction: (tx: Transaction) => void
  onTransactions?: () => void
  onFindTransaction?: (id: string) => Promise<Transaction | null>
  pendingItemCallbacks?: import('./PendingItemDetailScreen').PendingItemDetailCallbacks
}

export function MintDetailScreen({
  mint,
  mintIndex,
  onBack,
  onSend,
  onReceive,
  onDeleteMint,
  onRenameMint,
  onChangeMintColor,
  onChangeMintCardDesign,
  onSelectTransaction,
  onTransactions,
  onFindTransaction,
  pendingItemCallbacks,
}: MintDetailScreenProps) {
  const { t } = useTranslation()
  const settings = useAppStore((s) => s.settings)
  const { getDisplayName } = useMintMetadata(settings.mints)
  const [sheetSection, setSheetSection] = useState<'settings' | 'info' | null>(null)
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
    <div className="h-full bg-background flex flex-col pt-safe">
      {/* Header */}
      <header className="relative flex items-center justify-between px-5 h-14 shrink-0">
        <button
          onClick={() => { hapticTap(); onBack() }}
          className="w-10 h-10 -ml-1.5 rounded-lg flex items-center justify-center hover:bg-foreground/[0.04] active:bg-foreground/[0.06] transition-colors z-10"
          aria-label={t('common.back')}
        >
          <ArrowLeft className="w-[22px] h-[22px] text-foreground" strokeWidth={1.8} />
        </button>
        {/* The screen belongs to one mint — its custom name IS the title. */}
        <h1 className="absolute inset-0 flex items-center justify-center text-subtitle font-semibold text-foreground pointer-events-none">
          {getDisplayName(mint.url)}
        </h1>
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

        {/* Actions aligned to card width */}
        <div className="w-[var(--card-w)] mx-auto mt-6 space-y-3">
          <div className="grid grid-cols-6 gap-3">
            <MintActionTile
              className="col-span-3"
              icon={<ArrowDown className="w-5 h-5" strokeWidth={1.8} />}
              label={t('common.receive')}
              onClick={() => onReceive(mint.url)}
            />
            <MintActionTile
              className="col-span-3"
              icon={<ArrowUp className="w-5 h-5" strokeWidth={1.8} />}
              label={t('common.send')}
              onClick={() => onSend(mint.url)}
            />
            {onTransactions && (
              <MintActionTile
                className="col-span-2"
                icon={<ReceiptText className="w-5 h-5" strokeWidth={1.8} />}
                label={t('mintDetail.transactions')}
                onClick={onTransactions}
              />
            )}
            <MintActionTile
              className={onTransactions ? 'col-span-2' : 'col-span-3'}
              icon={<Info className="w-5 h-5" strokeWidth={1.8} />}
              label={t('mintDetail.mintInfo')}
              onClick={() => setSheetSection('info')}
            />
            <MintActionTile
              className={onTransactions ? 'col-span-2' : 'col-span-3'}
              icon={<Settings className="w-5 h-5" strokeWidth={1.8} />}
              label={t('nav.settings')}
              onClick={() => setSheetSection('settings')}
            />
          </div>

          {/* Receive-side pendings (requests, unclaimed tokens) still surface here */}
          {pendingItems.length > 0 && (
            <button
              onClick={() => { hapticTap(); setShowPendingItems(true) }}
              className="w-full flex items-center gap-3 rounded-[20px] bg-background-card border border-border/60 px-4 py-3 active:scale-[0.98] transition-transform"
            >
              <span className="relative flex w-2 h-2 shrink-0">
                <span className="absolute inline-flex w-full h-full rounded-full bg-status-pending animate-pulse" />
              </span>
              <span className="text-body font-medium text-foreground flex-1 text-left">
                {t('mintDetail.pendingItems')}
              </span>
              <span className="text-caption text-foreground-muted">{pendingItems.length}</span>
            </button>
          )}
        </div>
      </main>

      {/* Mint settings / info sheet — two halves of the same sheet */}
      <MintInfoSheet
        isOpen={sheetSection !== null}
        section={sheetSection ?? 'info'}
        mint={mint}
        onClose={() => setSheetSection(null)}
        onDelete={onDeleteMint}
        onRename={onRenameMint}
        onChangeColor={onChangeMintColor}
        onChangeCardDesign={onChangeMintCardDesign}
        getDisplayName={getDisplayName}
      />

    </div>
  )
}
