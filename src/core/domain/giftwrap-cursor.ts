/**
 * Gift wrap cursor — since 창 계산의 단일 진실 (설계 §10 B5)
 *
 * 규칙은 하나다:
 *   since(relay) = floor((relayEoseAtMs[relay] ?? lastFullSyncAtMs) / 1000) − OVERLAP
 *
 * - "그 relay가 마지막으로 나에게 전부 줬던 시점(EOSE)"만이 그 relay에 대한 안전한
 *   하한이다. 다른 relay들의 진행(전역 커서류)은 절대 since에 넣지 않는다 — 리뷰 N1의
 *   D0/D10 반례(장기 다운 relay의 단독 이벤트 유실)가 근거이며 테스트로 고정된다.
 * - timeout은 어떤 since 원천도 전진시키지 않는다. lastAttemptAtMs는 진단/UI 전용.
 * - 단위: Nostr since는 초, 저장은 전부 ms(*AtMs). 변환은 toSinceSec 한 곳.
 *
 * 2단계 소비 범위: 라이브 구독·캐치업 모두 lastFullSyncAtMs 기반 단일 since
 * (sinceForCatchUp). per-relay since 소비(sinceForRelay)는 6단계 컨트롤러 몫이지만,
 * per-relay EOSE 마크는 지금부터 영속되어 6단계가 이력을 갖고 시작한다.
 */

/** NIP-59 created_at 랜덤화 상한 — nostr-tools nip59 randomNow()와 동일한 2일 */
export const NIP59_RANDOMIZATION_SEC = 2 * 24 * 60 * 60

/** 송신자 시계 오차 마진 (설계 [F5] — 상한과 정확히 같으면 마진 0) */
export const CLOCK_SKEW_MARGIN_SEC = 6 * 60 * 60

/**
 * gift wrap since 오버랩 창. ANCHOR_VALIDITY_SECONDS(anchor 재발행 주기, 2일)와
 * 수치가 다르며 의미도 다르다 — 혼용 금지 (설계 [F5]).
 */
export const GIFTWRAP_OVERLAP_SEC = NIP59_RANDOMIZATION_SEC + CLOCK_SKEW_MARGIN_SEC

/** deep-resync 나이 검사 주기 — unlock 시 검사 (설계 [F3]: PWA엔 백그라운드 스케줄러가 없다) */
export const DEEP_RESYNC_INTERVAL_MS = 30 * 24 * 60 * 60 * 1000

export const GIFTWRAP_CURSOR_VERSION = 2 as const

export interface GiftwrapCursorRecord {
  /** PK — giftwrapCursorKey(pubkey) */
  key: string
  v: typeof GIFTWRAP_CURSOR_VERSION
  /** 마지막 catch-up 시도 시각 — 진단·UI 전용, since 계산 사용 금지 [N1] */
  lastAttemptAtMs: number
  /** 모든 대상 relay가 EOSE한 마지막 시각. 0 = 아직 없음(최초 1회 전체 replay) */
  lastFullSyncAtMs: number
  /** relay별 마지막 EOSE — per-relay since(6단계)와 backfill의 원천, 영속 [F4] */
  relayEoseAtMs: Record<string, number>
  /** 마지막 deep-resync 완료 시각. 초기값 = 레코드 생성 시각 */
  deepResyncAtMs: number
  createdAtMs: number
}

/** 계정 스코프 키 (설계 [F18] — id/키는 반드시 pubkey 스코프) */
export function giftwrapCursorKey(pubkeyHex: string): string {
  return `giftwrap:${pubkeyHex.slice(0, 8)}`
}

/** ms → Nostr since(초). 변환은 이 함수 한 곳으로 강제한다. */
export function toSinceSec(ms: number): number {
  return Math.floor(ms / 1000)
}

function windowStartSec(baseMs: number, overlapSec: number): number {
  return Math.max(0, toSinceSec(baseMs) - overlapSec)
}

/**
 * 단일 since — 라이브 구독·캐치업(querySync) 공용 (2단계).
 * lastFullSyncAtMs만 사용: 전(全) relay EOSE로만 전진하는 원천이라
 * relay 하나가 죽어 있으면 창이 커질 뿐 유실이 없다 (설계 §10 B5).
 */
export function sinceForCatchUp(
  record: GiftwrapCursorRecord | null,
  overlapSec: number = GIFTWRAP_OVERLAP_SEC,
): number | undefined {
  if (!record || record.lastFullSyncAtMs <= 0) return undefined
  return windowStartSec(record.lastFullSyncAtMs, overlapSec)
}

/**
 * per-relay since (6단계 소비 예정 — 규칙의 정본).
 * 그 relay 자신의 EOSE 기록이 없으면 lastFullSyncAtMs로 폴백한다.
 */
export function sinceForRelay(
  record: GiftwrapCursorRecord | null,
  relayUrl: string,
  overlapSec: number = GIFTWRAP_OVERLAP_SEC,
): number | undefined {
  if (!record) return undefined
  const baseMs = record.relayEoseAtMs[relayUrl] ?? record.lastFullSyncAtMs
  if (!baseMs || baseMs <= 0) return undefined
  return windowStartSec(baseMs, overlapSec)
}

/** deep-resync 창 — 마지막 deep-resync 이후로 바운디드 (설계 [F3]) */
export function sinceForDeepResync(
  record: GiftwrapCursorRecord | null,
  overlapSec: number = GIFTWRAP_OVERLAP_SEC,
): number | undefined {
  if (!record || record.deepResyncAtMs <= 0) return undefined
  return windowStartSec(record.deepResyncAtMs, overlapSec)
}

/** unlock 시 나이 검사. 레코드 없음 = 최초 full replay가 전체를 커버하므로 불필요 */
export function shouldDeepResync(
  record: GiftwrapCursorRecord | null,
  nowMs: number,
  intervalMs: number = DEEP_RESYNC_INTERVAL_MS,
): boolean {
  if (!record) return false
  return nowMs - record.deepResyncAtMs > intervalMs
}

/**
 * 신규 레코드는 항상 lastFullSyncAtMs=0 — seed 파라미터는 의도적으로 없다
 * (리뷰 #5: 全EOSE 불변식이 없는 값을 since 하한으로 승격하는 것을 원천 차단).
 */
export function createGiftwrapCursorRecord(key: string, nowMs: number): GiftwrapCursorRecord {
  return {
    key,
    v: GIFTWRAP_CURSOR_VERSION,
    lastAttemptAtMs: 0,
    lastFullSyncAtMs: 0,
    relayEoseAtMs: {},
    deepResyncAtMs: nowMs,
    createdAtMs: nowMs,
  }
}
