import { useEffect, useRef } from 'react'

/**
 * 자동잠금 (감사 §6 — "설정은 있는데 소비자가 없던" 결함의 실구현).
 *
 * 정책(소유자 결정, 전자): 잠금 = UI 차단 + 메모리 비밀 소거(onLock 콜백이
 * security.lock 수행). serviceRegistry(소켓·구독·sweep)는 유지한다 — PWA는
 * OS 푸시가 없어 "앱이 살아있는 동안의 실시간 수신"이 수신 경험의 전부이고,
 * 잠금이 세션을 죽이면 잠금 해제마다 전체 재연결 버스트가 부활한다.
 *
 * 판정: 마지막 사용자 입력으로부터 timeoutMinutes 경과.
 * - 백그라운드 freeze 중에는 타이머가 멈추므로, 화면 복귀 순간 즉시 재판정해
 *   오래 자리 비운 화면이 잠금 없이 노출되지 않게 한다.
 * - onWake(3s 디바운스 + online 조건)를 쓰지 않는 이유: 잠금 판정은 오프라인
 *   에서도, 디바운스 없이 복귀 즉시 일어나야 한다.
 */

const CHECK_INTERVAL_MS = 15_000
const ACTIVITY_EVENTS = ['pointerdown', 'keydown', 'touchstart'] as const

export function useAutoLock(params: {
  enabled: boolean
  timeoutMinutes: number
  isLocked: boolean
  onLock: () => void
}): void {
  const { enabled, timeoutMinutes, isLocked, onLock } = params
  // 초기값 0은 미사용 — 활성 effect가 시작 시점을 항상 재설정한다 (render 순수성)
  const lastActivityAtRef = useRef(0)
  const onLockRef = useRef(onLock)

  // 최신 콜백 유지 — 감시 effect가 onLock 변경마다 재구독하지 않게 ref로 분리
  useEffect(() => {
    onLockRef.current = onLock
  }, [onLock])

  useEffect(() => {
    if (!enabled || isLocked || timeoutMinutes <= 0) return

    // 잠금 해제(또는 설정 변경) 시점부터 새로 계산 — 이전 세션의 잔여
    // 유휴 시간이 즉시 재잠금을 일으키지 않게 한다
    lastActivityAtRef.current = Date.now()
    const timeoutMs = timeoutMinutes * 60_000

    const markActivity = () => {
      lastActivityAtRef.current = Date.now()
    }
    const check = () => {
      if (Date.now() - lastActivityAtRef.current >= timeoutMs) {
        onLockRef.current()
      }
    }
    const onVisibility = () => {
      if (document.visibilityState === 'visible') check()
    }

    for (const ev of ACTIVITY_EVENTS) {
      window.addEventListener(ev, markActivity, { passive: true })
    }
    document.addEventListener('visibilitychange', onVisibility)
    const timer = setInterval(check, CHECK_INTERVAL_MS)

    return () => {
      for (const ev of ACTIVITY_EVENTS) {
        window.removeEventListener(ev, markActivity)
      }
      document.removeEventListener('visibilitychange', onVisibility)
      clearInterval(timer)
    }
  }, [enabled, isLocked, timeoutMinutes])
}
