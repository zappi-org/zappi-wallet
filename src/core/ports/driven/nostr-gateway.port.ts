import type { NostrEvent, NostrFilter, UnsignedNostrEvent } from '@/core/domain/nostr'

export interface RelayStatus {
  url: string
  connected: boolean
}

export interface NostrGateway {
  connect(relays: string[]): Promise<void>
  disconnect(): Promise<void>
  getRelayStatus(): RelayStatus[]

  publish(event: UnsignedNostrEvent): Promise<NostrEvent>
  queryEvents(filters: NostrFilter[]): Promise<NostrEvent[]>

  subscribe(
    filters: NostrFilter[],
    handler: (event: NostrEvent) => void,
  ): () => void

  sendPrivateDirectMessage(params: DirectMessageParams): Promise<void>

  /** Send NIP-17 gift wrap and return the wrapped event */
  sendGiftWrap(params: GiftWrapParams): Promise<NostrEvent>

  /** Query and unwrap NIP-17 gift wrap events */
  fetchGiftWraps(params: FetchGiftWrapsParams): Promise<UnwrappedMessage[]>

  /**
   * Subscribe to gift wraps and deliver unwrapped messages to handler.
   * handler가 Promise를 반환하면 cursor full-sync 마크는 해당 처리들이 settle된
   * 뒤로 미뤄진다 — 처리 중 크래시 시 다음 세션 창에서 재수신되도록 (리뷰 #4).
   */
  subscribeGiftWraps(
    params: SubscribeGiftWrapsParams,
    handler: (msg: UnwrappedMessage) => void | Promise<void>,
  ): () => void
}

export interface DirectMessageParams {
  recipientPubkey: string
  content: string
  relays: string[]
}

export interface GiftWrapParams {
  recipientPubkey: string
  content: string
  relays: string[]
}

/**
 * Gift wrap cursor 스펙 (설계 §10 B5 — 2단계).
 * 구현이 cursor store와 함께 since 계산·EOSE 마크를 수행한다.
 * store가 주입되지 않았으면(kill-switch `ks.cursor`) 스펙은 무시된다 — 구동작(전체 replay).
 */
export interface GiftwrapCursorSpec {
  /** 계정 스코프 키 — giftwrapCursorKey(pubkey) */
  key: string
  /** 기본 GIFTWRAP_OVERLAP_SEC (NIP-59 2일 + 시계오차 6h) */
  overlapSec?: number
  /** 재설치(isRecoveryMode)·수동 전체 재동기화 — since 미적용 */
  fullReplay?: boolean
  /**
   * 全EOSE(full-sync) 판정 기준 — **설정된 persistent relay 집합** (설계 §10 B5).
   * 연결 스냅샷을 쓰면 다운/미연결 relay가 조용히 제외되어 사실상 quorum 제외가
   * 되고(2단계 금지), 그 relay 단독 이벤트가 창 밖으로 밀려 유실된다(리뷰 #2).
   * 미지정이면 full-sync 마크는 비활성(과소 전진 = 안전) — EOSE 이력만 쌓인다.
   */
  fullSyncTargets?: string[]
}

export interface FetchGiftWrapsParams {
  recipientPubkey: string
  relays: string[]
  cursor?: GiftwrapCursorSpec
  /** deep-resync 등 명시 창(초). cursor 계산보다 우선한다. */
  sinceSecOverride?: number
  /**
   * querySync 대기 상한(ms). full/deep 창은 기본 5초로는 드레인이 안 되므로
   * 호출자가 크게 지정한다 (리뷰 #3).
   */
  maxWaitMs?: number
}

export interface SubscribeGiftWrapsParams {
  recipientPubkey: string
  since?: number
  cursor?: GiftwrapCursorSpec
}

export interface UnwrappedMessage {
  eventId: string
  content: string
  sender: string
}
