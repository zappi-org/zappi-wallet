import type { GiftwrapCursorRecord } from '@/core/domain/giftwrap-cursor'

/**
 * Gift wrap cursor 저장소 포트 (설계 §10 B5).
 *
 * 구현 요구사항:
 * - load()는 레코드가 없으면 **lastFullSyncAtMs=0인 신규 레코드**를 생성·영속 후
 *   반환한다. 레거시 syncAnchor에서 seed **금지** (2단계 리뷰 #5) — 그 timestamp는
 *   부분/빈 fetch에도 갱신되던 값이라 since 하한 자격이 없고, seed하면 업그레이드
 *   직전 부분 동기화의 미수신 이벤트가 영구 제외된다. lastFullSyncAtMs의 확립·전진은
 *   오직 진짜 全EOSE(markFullSync)로만 일어난다. 레거시 행은 보존(anchor 표시용).
 * - mark* 계열은 레코드가 없으면 생성(upsert)한다.
 */
export interface GiftwrapCursorStore {
  load(key: string): Promise<GiftwrapCursorRecord | null>
  /** catch-up/구독 시도 기록 — 진단 전용 필드만 갱신. since 원천이 아니다 [N1] */
  markAttempt(key: string, atMs: number): Promise<void>
  markRelayEose(key: string, relayUrl: string, atMs: number): Promise<void>
  /** 전(全) 대상 relay EOSE 시에만 호출 — 단일 since의 유일한 전진 */
  markFullSync(key: string, atMs: number): Promise<void>
  markDeepResync(key: string, atMs: number): Promise<void>
}
