/**
 * Cross-tab synchronization via BroadcastChannel.
 *
 * This is a cross-cutting browser primitive used by UI and composition.
 * It intentionally lives outside composition so UI hooks do not depend on
 * the wiring layer.
 */

const CHANNEL_NAME = 'zappi-sync'

export type SyncMessage =
  | { type: 'balance_changed' }
  | { type: 'tx_changed' }
  | { type: 'settings_changed' }
  // pending-0으로 정지한 타 탭의 stuck-sweep 타이머 재개 신호 (설계 §7.2 [F20-잔여])
  | { type: 'transfer_created' }
  // 로그아웃한 탭이 계정 데이터를 소거함 — 타 탭은 즉시 reload 해 소거된 상태로
  // 재시작해야 한다 (감사 Phase 1: 남은 탭이 메모리 잔상으로 계속 동작하는 것 방지)
  | { type: 'logout' }

let broadcastChannel: BroadcastChannel | null = null

export function getBroadcastChannel(): BroadcastChannel | null {
  if (typeof BroadcastChannel === 'undefined') return null
  if (!broadcastChannel) {
    try {
      broadcastChannel = new BroadcastChannel(CHANNEL_NAME)
    } catch {
      return null
    }
  }
  return broadcastChannel
}

export function broadcastSync(type: SyncMessage['type']): void {
  try {
    const channel = getBroadcastChannel()
    if (channel) {
      channel.postMessage({ type } satisfies SyncMessage)
    }
  } catch {
    broadcastChannel = null
  }
}

/**
 * KDF 재암호화 마이그레이션 직후의 타 탭 하드닝 (docs/design/kdf-upgrade.md §6.4 R1).
 *
 * 이 브라우저-프리미티브 side-effect 는 성공한 unlock 이 `migrated: true` 를 반환할 때만 실행한다:
 * 1. `settings_changed` broadcast → 배포된 구 번들 탭을 reload 시켜 새 번들(=v2 인지)로 재기동.
 * 2. `localStorage['lockout']` 제거 → 구 번들이 정답 PIN 을 오답 계수해 남겼을 수 있는 거짓 15분
 *    잠금을 소거한다. 방금 성공한 unlock 이 이미 PIN 지식을 증명했으므로 그 lockout 은 무의미하다.
 *
 * core 서비스가 아닌 UI/utils 층이 쏘는 이유: cross-tab-sync 는 브라우저 프리미티브이고
 * core 는 이 층을 import 하지 않는다 (헥사고날 계약 유지).
 */
export function notifyKdfMigrated(): void {
  broadcastSync('settings_changed')
  try {
    localStorage.removeItem('lockout')
  } catch {
    // localStorage 접근 불가 환경(사생활 모드 등)에서도 broadcast 는 이미 나갔다 — 무시.
  }
}
