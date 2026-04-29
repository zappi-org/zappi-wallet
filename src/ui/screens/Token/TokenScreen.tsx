import type { Transaction } from '@/core/domain/transaction'
import type { PendingItem } from '@/core/ports/driving/pending-items.usecase'
import { useAppStore } from '@/store'
import { useMintMetadata } from '@/ui/hooks/use-mint-metadata'
import { useServiceRegistry } from '@/ui/hooks/use-service-registry'
import { useTransactionHistory } from '@/ui/hooks/use-transaction-history'
import { useAllPendingItems } from '@/ui/hooks/usePendingItems'
import { useReclaimFees } from '@/ui/hooks/useReclaimFees'
import { isSendToken, type TokenDetails } from '@/ui/types/pending-item-details'
import { satsToFiat, useFormatSats } from '@/utils/format'
import { Coins } from 'lucide-react'
import { AnimatePresence } from 'motion/react'
import { useCallback, useEffect, useMemo, useState, type RefObject } from 'react'
import { useTranslation } from 'react-i18next'
import { PendingEmptyWidget } from './components/PendingEmptyWidget'
import { PendingWidget } from './components/PendingWidget'
import { ReclaimableSection } from './components/ReclaimableSection'
import { ReclaimSheet } from './components/ReclaimSheet'
import { TimelineSection } from './components/TimelineSection'
import { TokenEmptyState } from './components/TokenEmptyState'
import {
  isTokenTimelineTx,
  pendingToDetail,
  transactionToDetail,
} from './mockData'
import type {
  MockPendingToken,
  TokenDetailData,
} from './types'

const RECOVER_THROTTLE_MS = 30_000
let lastRecoverAllRun = 0

export interface TokenScreenProps {
  scrollRef: RefObject<HTMLDivElement | null>
  /** Open detail screen for a token (pending card or timeline row click). */
  onSelectToken?: (detail: TokenDetailData) => void
  /** Execute the reclaim operation for the given tokens (awaits real service). */
  onReclaimTokens?: (tokens: MockPendingToken[]) => Promise<void> | void
  /** Persist a partial settings update (zustand + Dexie). Provided by MainApp. */
  onSaveSettings?: (updates: Record<string, unknown>) => Promise<void>
}

export function TokenScreen({
  scrollRef,
  onSelectToken,
  onReclaimTokens,
  onSaveSettings,
}: TokenScreenProps) {
  const { t } = useTranslation()
  const formatSats = useFormatSats()
  const addToast = useAppStore((state) => state.addToast)

  const [hintDismissed, setHintDismissed] = useState(false)

  const registry = useServiceRegistry()

  // Proactively reconcile SDK state when the tab is viewed: catches pending
  // sends that were claimed while observer events were missed (app backgrounded,
  // subscription paused, etc.). Throttled at module level to avoid spam on
  // rapid tab switching.
  useEffect(() => {
    if (!registry?.payment) return
    const now = Date.now()
    if (now - lastRecoverAllRun < RECOVER_THROTTLE_MS) return
    lastRecoverAllRun = now
    registry.payment.recoverAll().catch((err) => {
      console.warn('[TokenScreen] recoverAll failed:', err)
    })
  }, [registry])

  const mintUrls = useAppStore((s) => s.settings.mints)
  const { items: pendingItemsRaw } = useAllPendingItems(mintUrls)
  const { getDisplayName, getMetadata, getIconUrl } = useMintMetadata(mintUrls)
  const fiatRate = useAppStore((s) => {
    const cur = s.settings.fiatCurrency ?? 'USD'
    return s.allRates?.[cur] ?? null
  })

  const pendingTxIds = useMemo(
    () => pendingItemsRaw.filter(isSendToken).map((i) => i.id),
    [pendingItemsRaw],
  )
  const { fees: reclaimFees } = useReclaimFees(pendingTxIds)

  const pendingTokens: MockPendingToken[] = useMemo(() => {
    return pendingItemsRaw
      .filter(isSendToken)
      .map((item: PendingItem<TokenDetails>) => ({
        id: item.id,
        createdAt: item.createdAt,
        amount: item.amount,
        memo: item.memo ?? '',
        mintUrl: item.accountId,
        tokenString: item.details?.token,
        reclaimFee: reclaimFees.get(item.id),
      }))
  }, [pendingItemsRaw, reclaimFees])

  const { groups: timelineGroups } = useTransactionHistory({ filter: isTokenTimelineTx })

  const hasPending = pendingTokens.length > 0
  const hasTimeline = timelineGroups.length > 0
  // Show first-create hint when the user's first pending token appears with no history yet.
  const showFirstCreateHint =
    !hintDismissed && pendingTokens.length === 1 && timelineGroups.length === 0

  // PendingEmptyWidget visibility: hidden after dismiss until a new send-token gets claimed.
  const pendingEmptyDismissedAt = useAppStore(
    (s) => s.settings.pendingEmptyDismissedAt ?? null,
  )
  const lastSendClaimedAt = useMemo(() => {
    let max = 0
    for (const group of timelineGroups) {
      for (const tx of group.entries) {
        if (tx.direction !== 'send') continue
        if (tx.outcome !== 'claimed') continue
        const ts = tx.completedAt
        if (ts !== undefined && ts > max) max = ts
      }
    }
    return max
  }, [timelineGroups])
  const shouldShowPendingEmpty =
    pendingEmptyDismissedAt == null || lastSendClaimedAt > pendingEmptyDismissedAt
  const handleDismissPendingEmpty = useCallback(() => {
    if (!onSaveSettings) return
    void onSaveSettings({ pendingEmptyDismissedAt: Date.now() })
  }, [onSaveSettings])

  const handleShare = useCallback(
    async (token: MockPendingToken) => {
      const shareText = token.tokenString
        ? token.tokenString
        : t('token.reclaimable.shareText', {
            memo: token.memo,
            amount: formatSats(token.amount),
          })
      try {
        if (typeof navigator !== 'undefined' && typeof navigator.share === 'function') {
          await navigator.share({ text: shareText })
          return
        }
        if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
          await navigator.clipboard.writeText(shareText)
          addToast({ type: 'success', message: t('token.reclaimable.copiedToClipboard') })
        }
      } catch {
        // User cancelled share sheet or clipboard blocked — silent.
      }
    },
    [addToast, formatSats, t],
  )

  const isEmpty = !hasPending && !hasTimeline

  const handleSelectPending = useCallback(
    (token: MockPendingToken) => {
      if (!onSelectToken) return
      const url = token.mintUrl ?? ''
      const metadata = url ? getMetadata(url) : undefined
      const fiatValue =
        fiatRate !== null ? satsToFiat(token.amount, fiatRate) : undefined
      onSelectToken(
        pendingToDetail(token, {
          mintAlias: url ? getDisplayName(url) : undefined,
          mintName: metadata?.name,
          mintIconUrl: url ? getIconUrl(url) : undefined,
          fiatUsd: fiatValue,
        }),
      )
    },
    [onSelectToken, getDisplayName, getMetadata, getIconUrl, fiatRate],
  )

  const handleSelectTimeline = useCallback(
    (tx: Transaction) => {
      if (!onSelectToken) return
      const url = tx.accountId
      const metadata = url ? getMetadata(url) : undefined
      const amountSats = Number(tx.amount.value)
      const fiatValue =
        fiatRate !== null ? satsToFiat(amountSats, fiatRate) : undefined
      const detail = transactionToDetail(tx, {
        mintAlias: url ? getDisplayName(url) : undefined,
        mintName: metadata?.name,
        mintIconUrl: url ? getIconUrl(url) : undefined,
        fiatUsd: fiatValue,
      })
      if (detail) onSelectToken(detail)
    },
    [onSelectToken, getDisplayName, getMetadata, getIconUrl, fiatRate],
  )

  const [reclaimTargets, setReclaimTargets] = useState<MockPendingToken[] | null>(null)
  const openReclaimAll = useCallback(() => {
    if (pendingTokens.length === 0) return
    setReclaimTargets(pendingTokens)
  }, [pendingTokens])
  const openReclaimOne = useCallback((token: MockPendingToken) => {
    setReclaimTargets([token])
  }, [])
  const closeReclaim = useCallback(() => setReclaimTargets(null), [])
  const confirmReclaim = useCallback(
    async (tokens: MockPendingToken[]) => {
      if (onReclaimTokens) await onReclaimTokens(tokens)
      setReclaimTargets(null)
    },
    [onReclaimTokens],
  )

  return (
    <div ref={scrollRef} className="flex-1 h-full overflow-y-auto pt-safe pb-app-nav">
      <div className="min-h-full flex flex-col p-4 gap-4">
        <h1 className="flex items-center gap-2 text-heading font-bold text-foreground pt-2">
          <Coins className="w-[22px] h-[22px] text-foreground" strokeWidth={1.6} />
          {t('nav.token')}
        </h1>

        {isEmpty ? (
          <TokenEmptyState />
        ) : (
          <>
            {hasPending ? (
              <>
                <PendingWidget
                  count={pendingTokens.length}
                  totalAmount={pendingTokens.reduce((sum, p) => sum + p.amount, 0)}
                  onViewAll={openReclaimAll}
                />
                <ReclaimableSection
                  tokens={pendingTokens}
                  showFirstCreateHint={showFirstCreateHint}
                  onDismissHint={() => setHintDismissed(true)}
                  onShare={handleShare}
                  onReclaim={openReclaimOne}
                  onSelect={onSelectToken ? handleSelectPending : undefined}
                />
              </>
            ) : (
              <AnimatePresence>
                {shouldShowPendingEmpty && (
                  <PendingEmptyWidget onDismiss={handleDismissPendingEmpty} />
                )}
              </AnimatePresence>
            )}
            <div className="mt-6">
            <TimelineSection
              groups={timelineGroups}
              onSelect={onSelectToken ? handleSelectTimeline : undefined}
            />
            </div>
          </>
        )}
      </div>

      <ReclaimSheet
        isOpen={reclaimTargets !== null}
        onClose={closeReclaim}
        tokens={reclaimTargets ?? []}
        onConfirm={confirmReclaim}
      />
    </div>
  )
}

export default TokenScreen
