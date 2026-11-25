import { isPayoutStageTerminal } from '@/core/domain/onchain-payout'
import type { EventBus } from '@/core/events/event-bus'
import type { OnchainPayoutUseCase } from '@/core/ports/driving/onchain-payout.usecase'

export interface OnchainPayoutWatcherLogger {
  warn(message: string): void
}

export interface OnchainPayoutWatcherDeps {
  service: OnchainPayoutUseCase
  eventBus: EventBus
  pollIntervalMs: number
  logger?: OnchainPayoutWatcherLogger
}

export class OnchainPayoutWatcher {
  private readonly service: OnchainPayoutUseCase
  private readonly eventBus: EventBus
  private readonly pollIntervalMs: number
  private readonly logger?: OnchainPayoutWatcherLogger
  private timer: ReturnType<typeof setTimeout> | null = null
  private unsubscribe: (() => void) | null = null
  private started = false

  constructor(deps: OnchainPayoutWatcherDeps) {
    this.service = deps.service
    this.eventBus = deps.eventBus
    this.pollIntervalMs = deps.pollIntervalMs
    this.logger = deps.logger
  }

  start(): void {
    if (this.started) return
    this.started = true
    this.unsubscribe = this.eventBus.on('onchain-payout:updated', (event) => {
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
    console.warn('[OnchainPayout]', log)
  }
}
