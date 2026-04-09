/**
 * ThrottledAsync — lock + trailing debounce for async functions
 *
 * 빈번한 이벤트에 의해 비싼 async 작업이 반복 호출되는 것을 방지.
 * - 첫 호출: 즉시 실행 (lock 획득)
 * - lock 중 호출: 무시 + trailing flag ON
 * - lock 해제 시 trailing이면: trailingDelay 후 1회 더 실행
 * - trailing 대기 중 호출: 타이머 리셋
 *
 * 결과: 이벤트 N개 → fn 최대 2회 실행
 */

export interface ThrottledAsync {
  trigger(): void
  dispose(): void
}

export function createThrottledAsync(
  fn: () => Promise<void>,
  trailingDelay: number = 150,
): ThrottledAsync {
  let running = false
  let trailing = false
  let trailingTimer: ReturnType<typeof setTimeout> | null = null

  function execute(): void {
    running = true
    fn()
      .catch((e) => console.error('[ThrottledAsync]', e))
      .finally(() => {
        running = false
        if (trailing) {
          scheduleTrailing()
        }
      })
  }

  function scheduleTrailing(): void {
    if (trailingTimer) clearTimeout(trailingTimer)
    trailingTimer = setTimeout(() => {
      trailingTimer = null
      trailing = false
      execute()
    }, trailingDelay)
  }

  function trigger(): void {
    if (running) {
      trailing = true
      if (trailingTimer) clearTimeout(trailingTimer)
      return
    }
    // trailing 대기 중 trigger → 타이머 취소 후 즉시 실행
    if (trailingTimer) {
      clearTimeout(trailingTimer)
      trailingTimer = null
      trailing = false
    }
    execute()
  }

  function dispose(): void {
    if (trailingTimer) clearTimeout(trailingTimer)
    trailingTimer = null
    trailing = false
  }

  return { trigger, dispose }
}
