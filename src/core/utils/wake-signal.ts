/**
 * onWake — 포그라운드 복귀/네트워크 회복 신호의 단일 디바운스 지점 (설계 §10 B7)
 *
 * `online`과 `visibilitychange(visible)`을 하나의 trailing-debounce(기본 3초)로 합친다.
 * 모바일에서 포그라운드 전환·네트워크 플래핑이 두 이벤트를 연달아 쏘는데,
 * 디바운스 없이 각자 헬스체크/refresh를 돌리면 relay·mint에 이중 churn이 생긴다.
 *
 * 1단계에서는 NostrGateway의 무디바운스 리스너를 대체하고,
 * 6단계에서 NostrSessionController의 유일한 lifecycle 소유 지점이 된다.
 */

export interface WakeSignalOptions {
  /** trailing debounce — 마지막 트리거 후 이 시간이 지나면 1회 실행. 기본 3초. */
  debounceMs?: number
}

const DEFAULT_DEBOUNCE_MS = 3_000

export function onWake(callback: () => void, options: WakeSignalOptions = {}): () => void {
  const debounceMs = options.debounceMs ?? DEFAULT_DEBOUNCE_MS
  let timer: ReturnType<typeof setTimeout> | null = null

  const trigger = () => {
    if (timer) clearTimeout(timer)
    timer = setTimeout(() => {
      timer = null
      callback()
    }, debounceMs)
  }

  const handleOnline = () => trigger()
  const handleVisibility = () => {
    if (document.visibilityState === 'visible') trigger()
  }

  if (typeof window !== 'undefined') {
    window.addEventListener('online', handleOnline)
  }
  if (typeof document !== 'undefined') {
    document.addEventListener('visibilitychange', handleVisibility)
  }

  return () => {
    if (timer) {
      clearTimeout(timer)
      timer = null
    }
    if (typeof window !== 'undefined') {
      window.removeEventListener('online', handleOnline)
    }
    if (typeof document !== 'undefined') {
      document.removeEventListener('visibilitychange', handleVisibility)
    }
  }
}
