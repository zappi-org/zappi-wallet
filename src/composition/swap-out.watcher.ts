import { isPayoutStageTerminal } from '@/core/domain/swap-out'
import type { EventBus } from '@/core/events/event-bus'
import type { SwapOutUseCase } from '@/core/ports/driving/swap-out.usecase'

export interface SwapOutWatcherLogger {
  warn(message: string): void
}

export interface SwapOutWatcherDeps {
  service: SwapOutUseCase
  eventBus: EventBus
  pollIntervalMs: number
  refreshInFlight?: () => Promise<void>
  logger?: SwapOutWatcherLogger
}

export class SwapOutWatcher {
  private readonly service: SwapOutUseCase
  private readonly eventBus: EventBus
  private readonly pollIntervalMs: number
  private readonly refreshInFlight?: () => Promise<void>
  private readonly logger?: SwapOutWatcherLogger
  private timer: ReturnType<typeof setTimeout> | null = null
  private unsubscribe: (() => void) | null = null
  private started = false

  constructor(deps: SwapOutWatcherDeps) {
    this.service = deps.service
    this.eventBus = deps.eventBus
    this.pollIntervalMs = deps.pollIntervalMs
    this.refreshInFlight = deps.refreshInFlight
    this.logger = deps.logger
  }

  start(): void {
    if (this.started) return
    this.started = true
    this.unsubscribe = this.eventBus.on('swap-out:updated', (event) => {
      if (isPayoutStageTerminal(event.payload.stage)) return
      this.arm()
    })
    void this.tick()
  }

  async resume(): Promise<void> {
    if (!this.started) return
    await this.tick()
  }

  stop(): void {
    this.started = false
    this.unsubscribe?.()
    this.unsubscribe = null
    this.clearTimer()
  }

  private clearTimer(): void {
    if (this.timer === null) return
    clearTimeout(this.timer)
    this.timer = null
  }

  private arm(): void {
    if (!this.started || this.timer !== null) return
    this.timer = setTimeout(() => {
      this.timer = null
      void this.tick()
    }, this.pollIntervalMs)
  }

  private async tick(): Promise<void> {
    try {
      await this.service.resumeAll()
    } catch (error) {
      this.warn('resume failed', error)
    }
    try {
      await this.refreshInFlight?.()
    } catch (error) {
      this.warn('in-flight refresh failed', error)
    }
    if (!this.started) return
    try {
      const active = await this.service.listActive()
      if (active.length > 0) this.arm()
    } catch (error) {
      this.warn('active list failed', error)
      this.arm()
    }
  }

  private warn(message: string, error: unknown): void {
    const detail = error instanceof Error ? error.message : ''
    const log = `payout watcher ${message} ${detail}`.trim()
    if (this.logger) {
      this.logger.warn(log)
      return
    }
    console.warn('[SwapOut]', log)
  }
}
