import { useCallback, useMemo, useState, type RefObject } from 'react'
import { useTranslation } from 'react-i18next'
import { useAppStore } from '@/store'
import { useFormatSats, satsToFiat } from '@/utils/format'
import { useAllPendingItems } from '@/ui/hooks/usePendingItems'
import { useMintMetadata } from '@/ui/hooks/use-mint-metadata'
import { useReclaimFees } from '@/ui/hooks/useReclaimFees'
import { useTransactionHistory } from '@/ui/hooks/use-transaction-history'
import { isSendToken, type TokenDetails } from '@/ui/types/pending-item-details'
import type { PendingItem } from '@/core/ports/driving/pending-items.usecase'
import type { Transaction } from '@/core/domain/transaction'
import { TokenEmptyState } from './components/TokenEmptyState'
import { PendingWidget } from './components/PendingWidget'
import { ReclaimableSection } from './components/ReclaimableSection'
import { TimelineSection } from './components/TimelineSection'
import { ReclaimSheet } from './components/ReclaimSheet'
import {
  isTokenTimelineTx,
  pendingToDetail,
  transactionToDetail,
} from './mockData'
import type {
  MockPendingToken,
  TokenDetailData,
} from './types'

export interface TokenScreenProps {
  scrollRef: RefObject<HTMLDivElement | null>
  /** Open detail screen for a token (pending card or timeline row click). */
  onSelectToken?: (detail: TokenDetailData) => void
  /** Execute the reclaim operation for the given tokens (awaits real service). */
  onReclaimTokens?: (tokens: MockPendingToken[]) => Promise<void> | void
}

export function TokenScreen({
  scrollRef,
  onSelectToken,
  onReclaimTokens,
}: TokenScreenProps) {
  const { t } = useTranslation()
  const formatSats = useFormatSats()
  const addToast = useAppStore((state) => state.addToast)

  const [hintDismissed, setHintDismissed] = useState(false)

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

  const handleShare = useCallback(
    async (token: MockPendingToken) => {
      const shareText = t('token.reclaimable.shareText', {
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
    <div ref={scrollRef} className="flex-1 h-full overflow-y-auto pb-28">
      <div className="min-h-full flex flex-col p-4 gap-4">
        <h1 className="text-heading font-bold text-foreground pt-2">
          {t('nav.token')}
        </h1>

        {isEmpty ? (
          <TokenEmptyState />
        ) : (
          <>
            {hasPending && (
              <PendingWidget
                count={pendingTokens.length}
                totalAmount={pendingTokens.reduce((sum, p) => sum + p.amount, 0)}
                onViewAll={openReclaimAll}
              />
            )}
            {hasPending && (
              <ReclaimableSection
                tokens={pendingTokens}
                showFirstCreateHint={showFirstCreateHint}
                onDismissHint={() => setHintDismissed(true)}
                onShare={handleShare}
                onReclaim={openReclaimOne}
                onSelect={onSelectToken ? handleSelectPending : undefined}
              />
            )}
            <TimelineSection
              groups={timelineGroups}
              onSelect={onSelectToken ? handleSelectTimeline : undefined}
            />
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
