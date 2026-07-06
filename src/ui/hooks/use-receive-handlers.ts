import { useCallback } from 'react'
import { sat } from '@/core/domain/amount'
import type { NostrGateway } from '@/core/ports/driven/nostr-gateway.port'
import type { ProcessedStore } from '@/core/ports/driven/processed-store.port'
import type { ReceiveRequestUseCase } from '@/core/ports/driving/receive-request.usecase'
import type { ServiceRegistry } from '@/core/ports/driving/service-registry'
import type { PendingIncomingReview } from '@/core/types'
import type { POSDevice } from '@/core/types/wallet'
import { useRedeemToken } from '@/ui/hooks/use-redeem-token'
import { useAppStore } from '@/store'
import { broadcastSync } from '@/utils/cross-tab-sync'
import { normalizeMintUrl, isSameMintUrl } from '@/utils/url'

/**
 * composition/incoming-review.resolveIncomingReview 의 함수 표면 — 훅이 composition 을
 * 직접 import 하지 않도록(런타임·타입 모두 core 포트만) MainApp 이 함수를 주입한다.
 * 구조 불일치(필드 추가 등)는 주입 지점의 할당성 검사로 컴파일 타임에 드러난다.
 */
export type ResolveIncomingReviewFn = (
  deps: {
    processedStore: Pick<ProcessedStore, 'save'>
    receiveRequest: Pick<ReceiveRequestUseCase, 'findByRequestId' | 'complete'>
    removeIncomingReview: (externalId: string) => void | Promise<void>
    nostrGateway?: Pick<NostrGateway, 'getRelayStatus' | 'sendPrivateDirectMessage'>
    posDevices?: POSDevice[] | undefined
  },
  params: {
    review: PendingIncomingReview
    transactionId?: string
  },
) => Promise<void>

export interface UseReceiveHandlersDeps {
  serviceRegistry: ServiceRegistry | null
  /** useTransactions().refreshAll — 잔액+거래 **원자** 갱신 (MAJOR-14 공유 계약, 분리 금지) */
  refreshAll: () => Promise<void>
  /** composition/incoming-review.resolveIncomingReview 주입 */
  resolveReview: ResolveIncomingReviewFn
  /** 거절 확정 후 UI 리셋(리뷰/스캔 파라미터 소거 + 이전 화면 복귀) —
   *  화면 파라미터·네비 상태는 MainApp 소유라 콜백으로 주입받는다 */
  onRejected: () => void
}

export interface ReceiveHandlers {
  handleCreateInvoice: (
    amount: number,
    mintUrl: string,
  ) => Promise<{ invoice: string; quoteId: string; expiry: number } | null>
  handleReceiveToken: ReturnType<typeof useRedeemToken>
  handleReceiveRequestFulfillment: (
    token: string,
    paymentRef: string,
  ) => Promise<{ success: boolean; amount?: number; requestFulfilled?: boolean; error?: { code?: string; message?: string } }>
  handleResolveIncomingReview: (params: {
    review: PendingIncomingReview
    transactionId?: string
  }) => Promise<void>
  handleRejectIncomingReview: (review: PendingIncomingReview) => Promise<void>
  handlePaymentReceived: (receivedAmount: number, type: 'lightning' | 'ecash') => Promise<void>
}

/**
 * 수신 핸들러 묶음 (MainApp Phase 4c 순수 이동): 인보이스 생성, 토큰 상환,
 * ReceiveRequest 이행, 미신뢰 민트 review 승인/거절, 수신 완료 브로드캐스트.
 *
 * 성공 경로의 refreshAll은 주입된 원자 갱신 함수를 그대로 사용한다 —
 * tx만/balance만 갱신되는 창을 만들지 않는다 (MAJOR-14).
 */
export function useReceiveHandlers(deps: UseReceiveHandlersDeps): ReceiveHandlers {
  const { serviceRegistry, refreshAll, resolveReview, onRejected } = deps

  const settings = useAppStore((state) => state.settings)
  const removeIncomingReview = useAppStore((state) => state.removeIncomingReview)

  // Payment modal handlers
  const handleCreateInvoice = useCallback(async (amount: number, mintUrl: string) => {
    if (!mintUrl) return null

    if (!serviceRegistry?.payment) {
      console.warn('[useReceiveHandlers] ServiceRegistry not ready — cannot create invoice')
      return null
    }
    const transfer = await serviceRegistry.transferLifecycle.initiateIncomingTransfer(
      { txId: crypto.randomUUID(), accountId: mintUrl, amount: sat(amount) }, 'bolt11'
    )

    const ref = transfer.transportRef as { request?: string, quoteId?: string }

    return {
      invoice: ref?.request ?? '',
      quoteId: ref?.quoteId ?? '',
      expiry: transfer.expiresAt ? Math.floor(transfer.expiresAt / 1000) : Math.floor(Date.now() / 1000) + 600,
    }
  }, [serviceRegistry])

  const handleReceiveToken = useRedeemToken(serviceRegistry, () => {
    refreshAll().catch((e) => console.error('[useReceiveHandlers] refreshAll after receive failed:', e))
  })

  /**
   * Handle an incoming token that fulfills one of MY ReceiveRequests.
   * Routes through the domain use case so settlement → my-id verification →
   * intent='request-fulfill' tagging happens in one place. Transport-agnostic
   * (HTTP polling, future transports). Uses paymentRef as both externalId
   * (idempotency / deterministic txId) and the receive-request match key.
   */
  const handleReceiveRequestFulfillment = useCallback(async (
    token: string,
    paymentRef: string,
  ): Promise<{ success: boolean; amount?: number; requestFulfilled?: boolean; error?: { code?: string; message?: string } }> => {
    if (!serviceRegistry?.incomingPayment) {
      return { success: false, error: { code: 'NOT_READY', message: 'ServiceRegistry not ready' } }
    }

    const result = await serviceRegistry.incomingPayment.processIncoming({
      payload: token,
      externalId: paymentRef,
      receiveRequestPaymentRef: paymentRef,
      receiveRequestMethod: 'ecash',
    })

    if (result.status === 'success') {
      refreshAll().catch((e) => console.error('[useReceiveHandlers] refreshAll after fulfillment failed:', e))
      return { success: true, amount: result.amount, requestFulfilled: result.requestFulfilled }
    }
    if (result.status === 'already_processed') {
      return { success: true, amount: 0 }
    }
    return { success: false, error: { code: 'FULFILLMENT_FAILED', message: result.error ?? 'Failed to process incoming payment' } }
  }, [serviceRegistry, refreshAll])

  const handleResolveIncomingReview = useCallback(async (params: {
    review: PendingIncomingReview
    transactionId?: string
  }) => {
    if (!serviceRegistry) return

    await resolveReview({
      processedStore: serviceRegistry.processedStore,
      receiveRequest: serviceRegistry.receiveRequest,
      // durable 큐에서 제거 (설계 §6.2) — Zustand 미러는 큐 어댑터가 동기화
      removeIncomingReview: (externalId) =>
        serviceRegistry.incomingReviewQueue.remove(externalId),
      nostrGateway: serviceRegistry.nostrGateway,
      posDevices: settings.posDevices,
    }, params)

    // 신뢰 추가 경유 승인(설계 §6.3 [N3]): 같은 민트의 나머지 대기 review를
    // 자동 상환한다 — 민트 신뢰가 곧 승인. 모달의 자체 redeem이 끝난 뒤라
    // 활성 review와 race하지 않는다. 미신뢰 민트면 건너뜀(자동 폐기 방지).
    // mints는 store에서 최신을 읽는다 — "신뢰하고 받기" 흐름은 신뢰 추가와 이
    // 콜백이 같은 렌더 클로저 안에서 이어지므로 prop 캡처본은 신뢰 추가 이전
    // 값이다 (4단계 리뷰 #3).
    const reviewMint = normalizeMintUrl(params.review.token.mintUrl)
    const currentMints = useAppStore.getState().settings.mints
    if (currentMints.some((m) => isSameMintUrl(m, reviewMint))) {
      serviceRegistry.recoveryScheduler
        .drainReviewQueue(reviewMint)
        .catch((e) => console.warn('[useReceiveHandlers] review drain failed:', e))
    }
  }, [serviceRegistry, resolveReview, settings.posDevices])

  const handleRejectIncomingReview = useCallback(async (review: PendingIncomingReview) => {
    if (serviceRegistry) {
      await serviceRegistry.processedStore.save({
        externalId: review.externalId,
        processedAt: Date.now(),
        result: 'skipped',
        error: 'Rejected by user',
      })
      // durable 큐에서 제거 — 미제거 시 다음 부팅 hydrate에 부활한다 (설계 §6.2)
      await serviceRegistry.incomingReviewQueue.remove(review.externalId)
    } else {
      removeIncomingReview(review.externalId)
    }

    onRejected()
  }, [serviceRegistry, removeIncomingReview, onRejected])

  // Payment received callback
  // Lightning toast는 bridge.ts (mint-quote:redeemed)가 전역으로 담당
  const handlePaymentReceived = useCallback(async (
    _receivedAmount: number,
    _type: 'lightning' | 'ecash',
  ) => {
    refreshAll().catch((e) => console.error('[useReceiveHandlers] refreshAll after payment received:', e))
    broadcastSync('balance_changed')
  }, [refreshAll])

  return {
    handleCreateInvoice,
    handleReceiveToken,
    handleReceiveRequestFulfillment,
    handleResolveIncomingReview,
    handleRejectIncomingReview,
    handlePaymentReceived,
  }
}
