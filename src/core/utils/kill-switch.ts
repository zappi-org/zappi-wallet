/**
 * Kill-switch 레지스트리 — 신경로 비활성화 스위치 (설계 §11.1)
 *
 * localStorage `zappi.ks.<name>` = '1' 이면 해당 신경로를 끄고 구동작으로 복귀.
 * 개별 기기 지원 대응·개발 검증용이며 fleet 롤백 수단이 아니다(그건 revert+재배포).
 * bootstrap에서 1회 읽어(readKillSwitches) 조립을 분기한다 — 런타임 토글이 아니라
 * 다음 실행부터 적용되는 스위치다.
 *
 * 각 스위치는 해당 마이그레이션 단계가 안정화된 다음 릴리스에서 제거한다.
 */

export const KILL_SWITCH_NAMES = [
  'cursor', // 2단계: gift wrap since/cursor 미적용(구동작: 전체 replay)
  'tls-sweep', // 5단계: 120s stuck-sweep 대신 30s 폴링 복귀
  'mint-info-facade', // 3단계: MintInfoService 대신 구 health/metadata 경로
  'recovery-split', // 4단계: recoverAll 구 구현 복귀
  'nostr-controller', // 6단계: NostrSessionController 대신 구 gateway 경로
] as const

export type KillSwitchName = (typeof KILL_SWITCH_NAMES)[number]

const STORAGE_PREFIX = 'zappi.ks.'

export function isKillSwitchOn(name: KillSwitchName): boolean {
  try {
    return globalThis.localStorage?.getItem(STORAGE_PREFIX + name) === '1'
  } catch {
    // localStorage 접근 불가(프라이빗 모드 등) — 스위치 없음으로 간주
    return false
  }
}

/** bootstrap 1회 읽기용 스냅샷. */
export function readKillSwitches(): Readonly<Record<KillSwitchName, boolean>> {
  const snapshot = {} as Record<KillSwitchName, boolean>
  for (const name of KILL_SWITCH_NAMES) {
    snapshot[name] = isKillSwitchOn(name)
  }
  return snapshot
}
