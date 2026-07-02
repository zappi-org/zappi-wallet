import type { Transaction } from '@/core/domain/transaction'
import type { PendingItem } from '@/core/ports/driving/pending-items.usecase'
import { useAppStore } from '@/store'
import { useMintMetadata } from '@/ui/hooks/use-mint-metadata'
import { useTokenReclaim } from '@/ui/hooks/use-token-reclaim'
import { useServiceRegistry } from '@/ui/hooks/use-service-registry'
import { useTransactionHistory } from '@/ui/hooks/use-transaction-history'
import { useAllPendingItems } from '@/ui/hooks/usePendingItems'
import { useReclaimFees } from '@/ui/hooks/useReclaimFees'
import { isSendToken, type TokenDetails } from '@/ui/types/pending-item-details'
import { satsToFiat, useFormatSats } from '@/utils/format'
import { cn } from '@/ui/primitives/utils'
import { BanknotesIcon } from '@heroicons/react/24/outline'
import { AnimatePresence } from 'motion/react'
import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from 'react'
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
  /** Persist a partial settings update (zustand + Dexie). Provided by MainApp. */
  onSaveSettings?: (updates: Record<string, unknown>) => Promise<void>
}

export function TokenScreen({
  scrollRef,
  onSelectToken,
  onSaveSettings,
}: TokenScreenProps) {
  const { t } = useTranslation()
  const formatSats = useFormatSats()
  const addToast = useAppStore((state) => state.addToast)
  const { reclaimMultiple } = useTokenReclaim()

  const [hintDismissed, setHintDismissed] = useState(false)

  // Sticky header morphs to compact form once timeline section scrolls past h1.
  // Uses a ref callback so the observer attaches whenever the sentinel mounts —
  // necessary because TimelineSection is not rendered while isEmpty is true.
  const [isHeaderMerged, setIsHeaderMerged] = useState(false)
  const observerRef = useRef<IntersectionObserver | null>(null)
  const setHeaderSentinel = useCallback(
    (node: HTMLDivElement | null) => {
      observerRef.current?.disconnect()
      observerRef.current = null
      const root = scrollRef.current
      if (!node || !root) return
      const observer = new IntersectionObserver(
        ([entry]) => {
          if (entry.isIntersecting) {
            setIsHeaderMerged(false)
            return
          }
          // Non-intersecting can mean either scrolled past (above viewport) or
          // not yet reached (below viewport on short screens). Only merge when above.
          const sentinelTop = entry.boundingClientRect.top
          const rootTop = entry.rootBounds?.top ?? 0
          setIsHeaderMerged(sentinelTop < rootTop)
        },
        { root, rootMargin: '-56px 0px 0px 0px', threshold: 0 },
      )
      observer.observe(node)
      observerRef.current = observer
    },
    [scrollRef],
  )
  useEffect(() => () => observerRef.current?.disconnect(), [])

  const registry = useServiceRegistry()
  const triggerTxRefresh = useAppStore((s) => s.triggerTxRefresh)

  // Proactively reconcile SDK state when the tab is viewed: catches pending
  // sends that were claimed while observer events were missed (app backgrounded,
  // subscription paused, etc.). Throttled at module level to avoid spam on
  // rapid tab switching.
  // 설계 §6.3 Token 탭: reconcile()만 — 로컬 정합(네트워크 0)으로 충분하다.
  // 원격 정산 감지는 watcher/브리지 push의 소관이라 recoverAll(네트워크 구제
  // 포함)은 과했다.
  useEffect(() => {
    if (!registry?.recoveryScheduler) return
    const now = Date.now()
    if (now - lastRecoverAllRun < RECOVER_THROTTLE_MS) return
    lastRecoverAllRun = now
    registry.recoveryScheduler.reconcile()
      .then(() => {
        triggerTxRefresh()
      })
      .catch((err) => {
        console.warn('[TokenScreen] reconcile failed:', err)
      })
  }, [registry, triggerTxRefresh])

  const mintUrls = useAppStore((s) => s.settings.mints)
  const { items: pendingItemsRaw } = useAllPendingItems(mintUrls)
  const { getDisplayName, getMetadata, getIconUrl } = useMintMetadata(mintUrls)
  const fiatCurrency = useAppStore((s) => s.settings.fiatCurrency ?? 'USD')
  const fiatRate = useAppStore((s) => s.allRates?.[fiatCurrency] ?? null)

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
      console.log('[TokenScreen] handleSelectPending called', token)
      if (!onSelectToken) {
        console.log('[TokenScreen] onSelectToken is undefined')
        return
      }
      const url = token.mintUrl ?? ''
      const metadata = url ? getMetadata(url) : undefined
      const fiat =
        fiatRate !== null
          ? { amount: satsToFiat(token.amount, fiatRate), currency: fiatCurrency }
          : undefined
      const detail = pendingToDetail(token, {
        mintAlias: url ? getDisplayName(url) : undefined,
        mintName: metadata?.name,
        mintIconUrl: url ? getIconUrl(url) : undefined,
        fiat,
      })
      console.log('[TokenScreen] Created detail:', detail)
      onSelectToken(detail)
    },
    [onSelectToken, getDisplayName, getMetadata, getIconUrl, fiatRate, fiatCurrency],
  )

  const handleSelectTimeline = useCallback(
    (tx: Transaction) => {
      console.log('[TokenScreen] handleSelectTimeline called', tx)
      if (!onSelectToken) {
        console.log('[TokenScreen] onSelectToken is undefined')
        return
      }
      const url = tx.accountId
      const metadata = url ? getMetadata(url) : undefined
      const amountSats = Number(tx.amount.value)
      const fiat =
        fiatRate !== null
          ? { amount: satsToFiat(amountSats, fiatRate), currency: fiatCurrency }
          : undefined
      const detail = transactionToDetail(tx, {
        mintAlias: url ? getDisplayName(url) : undefined,
        mintName: metadata?.name,
        mintIconUrl: url ? getIconUrl(url) : undefined,
        fiat,
      })
      console.log('[TokenScreen] Created detail from tx:', detail)
      if (detail) onSelectToken(detail)
    },
    [onSelectToken, getDisplayName, getMetadata, getIconUrl, fiatRate, fiatCurrency],
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
      await reclaimMultiple(
        tokens.map((t) => t.id),
        {
          onSuccess: () => {
            setReclaimTargets(null)
          },
          onError: () => {
            // 토스트는 훅에서 처리. 여기서는 UI 상태 정리만
            setReclaimTargets(null)
          },
        }
      )
    },
    [reclaimMultiple]
  )

  return (
    <div ref={scrollRef} className="flex-1 h-full overflow-y-auto pt-safe pb-app-nav">
      <div className="min-h-full flex flex-col p-4 gap-4">
        <h1
          className={cn(
            'sticky top-0 z-[5] -mx-4 -mt-4 px-4 flex items-center text-foreground transition-[height,gap] duration-200',
            isHeaderMerged ? 'h-12 gap-1.5' : 'h-14 gap-2',
          )}
          style={{
            // Pre-merge: fully opaque so nothing scrolls under the page title.
            // Post-merge: opaque only over the date-anchor track (16px parent p-4 + 56px w-14 + 12px gap-3 = 84px);
            // right side stays transparent so timeline rows scroll past visibly behind the header.
            background: isHeaderMerged
              ? 'linear-gradient(to right, var(--color-background) 84px, transparent 84px)'
              : 'var(--color-background)',
          }}
        >
          <BanknotesIcon
            className={cn(
              'text-foreground transition-[width,height] duration-200',
              isHeaderMerged ? 'w-[18px] h-[18px]' : 'w-[22px] h-[22px]',
            )}
          />
          {isHeaderMerged ? (
            <span className="text-title-sm font-bold">
              {t('token.history.section')}
            </span>
          ) : (
            <span className="text-heading font-bold">
              {t('nav.token')}
            </span>
          )}
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
              <div ref={setHeaderSentinel} aria-hidden className="h-px" />
              <TimelineSection
                groups={timelineGroups}
                onSelect={onSelectToken ? handleSelectTimeline : undefined}
                hideTitle={isHeaderMerged}
                anchorTopClass={isHeaderMerged ? 'top-12' : 'top-14'}
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
