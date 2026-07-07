/**
 * RequestGate — single-flight + cooldown utility.
 *
 * If work for the same key is in flight, its Promise is shared (single-flight);
 * if a recent success is within cooldown, the previous value is returned as stale
 * without re-running. Failures decay on their own cooldown too, preventing retry
 * storms when unlock, resume, and pull-refresh overlap while offline or the mint is down.
 *
 * Lifetime: create at bootstrap-instance scope (account switch = new bootstrap = gate reset).
 * Never a module singleton — prevents result leakage across accounts.
 */

export interface RequestGateOptions {
  /** A re-call within this window after success returns the previous value as stale. 0 = no success cache (in-flight sharing only). */
  cooldownMs: number
  /** A re-call within this window after failure re-throws the same rejection. Default 30s. 0 = no failure cache. */
  failureCooldownMs?: number
}

export interface GateResult<T> {
  value: T
  /** If true, a within-cooldown re-call returned the previous success value — not a freshly executed result. */
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
        // With cooldown 0, don't retain the result — indefinitely holding a value that
        // will never be served leaks memory for consumers with growing keys (e.g. generation keys).
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

  /** Clears a key's success/failure cache (in-flight is kept — running work completes). */
  invalidate(key: string): void {
    this.lastSuccess.delete(key)
    this.lastFailure.delete(key)
  }
}
