import { useCallback, useState, type RefObject } from 'react'
import { useTranslation } from 'react-i18next'
import { useAppStore } from '@/store'
import { useFormatSats } from '@/utils/format'
import { TokenEmptyState } from './components/TokenEmptyState'
import { PendingWidget } from './components/PendingWidget'
import { ReclaimableSection } from './components/ReclaimableSection'
import { TimelineSection } from './components/TimelineSection'
import { MockStateSwitcher } from './components/MockStateSwitcher'
import {
  pickMockData,
  pendingTotalAmount,
  pendingToDetail,
  timelineToDetail,
} from './mockData'
import type {
  MockPendingToken,
  MockTimelineEntry,
  TokenDetailData,
  TokenViewState,
} from './types'

export interface TokenScreenProps {
  scrollRef: RefObject<HTMLDivElement | null>
  initialMockState?: TokenViewState
  /** Open detail screen for a token (pending card or timeline row click). */
  onSelectToken?: (detail: TokenDetailData) => void
}

export function TokenScreen({
  scrollRef,
  initialMockState = 'active',
  onSelectToken,
}: TokenScreenProps) {
  const { t } = useTranslation()
  const formatSats = useFormatSats()
  const addToast = useAppStore((state) => state.addToast)

  const [mockState, setMockState] = useState<TokenViewState>(initialMockState)
  const [hintDismissed, setHintDismissed] = useState(false)

  const data = pickMockData(mockState)
  const hasPending = data.pendingTokens.length > 0
  const hasTimeline = data.timelineGroups.length > 0
  const showFirstCreateHint = mockState === 'first-create' && !hintDismissed

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
      onSelectToken?.(pendingToDetail(token))
    },
    [onSelectToken],
  )

  const handleSelectTimeline = useCallback(
    (entry: MockTimelineEntry) => {
      onSelectToken?.(timelineToDetail(entry))
    },
    [onSelectToken],
  )

  return (
    <div ref={scrollRef} className="flex-1 h-full overflow-y-auto pb-28">
      <div className="min-h-full flex flex-col p-4 gap-4">
        <MockStateSwitcher value={mockState} onChange={setMockState} />

        <h1 className="text-heading font-bold text-foreground pt-2">
          {t('nav.token')}
        </h1>

        {isEmpty ? (
          <TokenEmptyState />
        ) : (
          <>
            {hasPending && (
              <PendingWidget
                count={data.pendingTokens.length}
                totalAmount={pendingTotalAmount(data)}
              />
            )}
            {hasPending && (
              <ReclaimableSection
                tokens={data.pendingTokens}
                showFirstCreateHint={showFirstCreateHint}
                onDismissHint={() => setHintDismissed(true)}
                onShare={handleShare}
                onSelect={onSelectToken ? handleSelectPending : undefined}
              />
            )}
            <TimelineSection
              groups={data.timelineGroups}
              onSelect={onSelectToken ? handleSelectTimeline : undefined}
            />
          </>
        )}
      </div>
    </div>
  )
}

export default TokenScreen
