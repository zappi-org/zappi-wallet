/**
 * RequestGate — single-flight + cooldown 유틸
 *
 * 같은 key의 작업이 진행 중이면 그 Promise를 공유하고(single-flight),
 * 최근 성공 결과가 cooldown 내면 재실행 없이 직전 값을 stale로 반환한다.
 * 실패도 별도 cooldown으로 감쇠해, 오프라인/민트 다운 상황에서
 * unlock·resume·pull-refresh가 겹칠 때의 재시도 폭주를 막는다.
 *
 * 수명: bootstrap 인스턴스 스코프로 생성할 것 (계정 전환 = 새 bootstrap = gate 초기화).
 * 모듈 싱글턴 금지 — 계정 간 결과 누출 방지. (설계 §6.4)
 */

export interface RequestGateOptions {
  /** 성공 후 이 시간 내 재호출은 직전 값을 stale로 반환. 0이면 성공 캐시 없음(in-flight 공유만). */
  cooldownMs: number
  /** 실패 후 이 시간 내 재호출은 같은 rejection을 재-throw. 기본 30초. 0이면 실패 캐시 없음. */
  failureCooldownMs?: number
}

export interface GateResult<T> {
  value: T
  /** true면 cooldown 내 재호출로 직전 성공값을 돌려준 것 — 방금 실행된 결과가 아님. */
  stale: boolean
}

const DEFAULT_FAILURE_COOLDOWN_MS = 30_000

export class RequestGate {
  private readonly cooldownMs: number
  private readonly failureCooldownMs: number
  private readonly inflight = new Map<string, Promise<GateResult<unknown>>>()
  private readonly lastSuccess = new Map<string, { at: number; value: unknown }>()
  private readonly lastFailure = new Map<string, { at: number; reason: unknown }>()

  constructor(options: RequestGateOptions) {
    this.cooldownMs = options.cooldownMs
    this.failureCooldownMs = options.failureCooldownMs ?? DEFAULT_FAILURE_COOLDOWN_MS
  }

  run<T>(key: string, task: () => Promise<T>): Promise<GateResult<T>> {
    const inflight = this.inflight.get(key)
    if (inflight) {
      return inflight as Promise<GateResult<T>>
    }

    const now = Date.now()

    const success = this.lastSuccess.get(key)
    if (success && this.cooldownMs > 0 && now - success.at < this.cooldownMs) {
      return Promise.resolve({ value: success.value as T, stale: true })
    }

    const failure = this.lastFailure.get(key)
    if (failure && this.failureCooldownMs > 0 && now - failure.at < this.failureCooldownMs) {
      return Promise.reject(failure.reason)
    }

    const run = (async (): Promise<GateResult<T>> => {
      try {
        const value = await task()
        // cooldown 0이면 결과를 보관하지 않는다 — 서빙될 일 없는 값의 무기한 보관은
        // 키가 증가하는 소비자(예: generation 키)에서 메모리 누수가 된다(코드리뷰 #2).
        if (this.cooldownMs > 0) {
          this.lastSuccess.set(key, { at: Date.now(), value })
        }
        this.lastFailure.delete(key)
        return { value, stale: false }
      } catch (reason) {
        if (this.failureCooldownMs > 0) {
          this.lastFailure.set(key, { at: Date.now(), reason })
        }
        throw reason
      } finally {
        this.inflight.delete(key)
      }
    })()

    this.inflight.set(key, run as Promise<GateResult<unknown>>)
    return run
  }

  /** 특정 key의 캐시·실패 기록 제거 (in-flight는 유지 — 진행 중 작업은 완주). */
  invalidate(key: string): void {
    this.lastSuccess.delete(key)
    this.lastFailure.delete(key)
  }
}
