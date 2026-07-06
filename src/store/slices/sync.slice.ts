import type { StateCreator } from 'zustand'
import type { SyncState, SyncAnchor } from '@/core/types'
import type { PendingIncomingReview } from '@/core/types'

/**
 * Sync slice state
 */
export interface SyncSliceState {
  // Sync status
  syncState: SyncState
  lastSyncAt: number | null
  anchor: SyncAnchor | null

  // Pending items
  pendingRetries: number
  failedIncomingsCount: number
  pendingIncomingReviews: PendingIncomingReview[]

  // Progress

  // NutZap listener state (from old stores)
  lastEventTimestamp: number
  txRefreshTrigger: number

  // NUT-18 payment received state (for ReceiveFlow)
  lastReceivedRequestId: string | null
  lastReceivedAmount: number
  lastReceivedEventId: string | null

  // Lightning mint-quote:redeemed state (for ReceiveQRStep)
  lastRedeemedQuoteId: string | null
  lastRedeemedQuoteAmount: number

  // NUT-18 pending request ID (set by ReceiveQRStep while waiting for payment)
  pendingEcashRequestId: string | null

  // NUT-18 transport status (for ReceiveQRStep)
  activeTransports: ('nostr' | 'http')[]
  nostrConnectionStatus: 'connected' | 'disconnected' | 'connecting'

  // Actions
  setSyncState: (state: SyncState) => void
  setLastSyncAt: (timestamp: number | null) => void
  setAnchor: (anchor: SyncAnchor | null) => void
  setPendingRetries: (count: number) => void
  setFailedIncomingsCount: (count: number) => void
  enqueueIncomingReview: (review: PendingIncomingReview) => void
  removeIncomingReview: (externalId: string) => void
  setLastEventTimestamp: (timestamp: number) => void
  triggerTxRefresh: () => void
  setLastReceivedPayment: (requestId: string | null, amount: number, eventId?: string | null) => void
  setLastRedeemedQuote: (quoteId: string | null, amount: number) => void
  setPendingEcashRequestId: (requestId: string | null) => void
  setActiveTransports: (transports: ('nostr' | 'http')[]) => void
  setNostrConnectionStatus: (status: 'connected' | 'disconnected' | 'connecting') => void
  /** 슬라이스 고유 reset — resetAll 이 호출 (동명 reset 충돌로 last-spread 만 살아남던 버그 수정, Phase 3) */
  resetSync: () => void
}

/**
 * Initial sync state
 */
const initialState = {
  syncState: 'idle' as SyncState,
  lastSyncAt: null as number | null,
  anchor: null as SyncAnchor | null,
  pendingRetries: 0,
  failedIncomingsCount: 0,
  pendingIncomingReviews: [] as PendingIncomingReview[],
  lastEventTimestamp: 0,
  txRefreshTrigger: 0,
  lastReceivedRequestId: null as string | null,
  lastReceivedAmount: 0,
  lastReceivedEventId: null as string | null,
  lastRedeemedQuoteId: null as string | null,
  lastRedeemedQuoteAmount: 0,
  pendingEcashRequestId: null as string | null,
  activeTransports: [] as ('nostr' | 'http')[],
  nostrConnectionStatus: 'disconnected' as 'connected' | 'disconnected' | 'connecting',
}

/**
 * Sync slice creator
 */
export const createSyncSlice: StateCreator<SyncSliceState> = (set) => ({
  ...initialState,

  setSyncState: (syncState) => set({ syncState }),

  setLastSyncAt: (lastSyncAt) => set({ lastSyncAt }),

  setAnchor: (anchor) => set({ anchor }),

  setPendingRetries: (pendingRetries) => set({ pendingRetries }),

  setFailedIncomingsCount: (failedIncomingsCount) => set({ failedIncomingsCount }),

  enqueueIncomingReview: (review) =>
    set((state) => {
      if (state.pendingIncomingReviews.some((item) => item.externalId === review.externalId)) {
        return { pendingIncomingReviews: state.pendingIncomingReviews }
      }

      return {
        pendingIncomingReviews: [...state.pendingIncomingReviews, review],
      }
    }),

  removeIncomingReview: (externalId) =>
    set((state) => ({
      pendingIncomingReviews: state.pendingIncomingReviews.filter((item) => item.externalId !== externalId),
    })),

  setLastEventTimestamp: (lastEventTimestamp) => set({ lastEventTimestamp }),

  triggerTxRefresh: () =>
    set((state) => ({
      txRefreshTrigger: state.txRefreshTrigger + 1,
    })),

  setLastReceivedPayment: (lastReceivedRequestId, lastReceivedAmount, lastReceivedEventId = null) =>
    set({ lastReceivedRequestId, lastReceivedAmount, lastReceivedEventId }),

  setLastRedeemedQuote: (lastRedeemedQuoteId, lastRedeemedQuoteAmount) =>
    set({ lastRedeemedQuoteId, lastRedeemedQuoteAmount }),

  setPendingEcashRequestId: (pendingEcashRequestId) => set({ pendingEcashRequestId }),

  setActiveTransports: (activeTransports) => set({ activeTransports }),

  setNostrConnectionStatus: (nostrConnectionStatus) => set({ nostrConnectionStatus }),

  resetSync: () => set(initialState),
})
