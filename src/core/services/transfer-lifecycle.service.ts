/**
 * TransferLifecycleService — 프로토콜 중립적인 전송 상태 관리 서비스
 *
 * 보내기/받기, Bolt11/Ecash/미래 프로토콜 모두 동일한 상태 머신으로 추적.
 * Adapter에게 실행을 위임하고, 상태만 관리한다.
 */

import type { PendingTransfer } from '@/core/domain/pending-transfer'
import { isTerminal, canReclaim, canComplete, transitionPhase } from '@/core/domain/pending-transfer'
import type { EventBus } from '@/core/events/event-bus'
import type { PendingTransferStore } from '@/core/ports/driven/pending-transfer-store.port'
import type { TransferIntent, TransferOperator } from '@/core/ports/driven/transfer-operator.port'

export class TransferLifecycleService {
  private pollTimer: ReturnType<typeof setInterval> | null = null

  constructor(
    private readonly transferStore: PendingTransferStore,
    private readonly operators: Map<string, TransferOperator>,
    private readonly eventBus: EventBus,
  ) { }

  /** Transfer 조회 */
  async getTransfer(id: string): Promise<PendingTransfer | null> {
    return this.transferStore.get(id)
  }

  /** 주기적 폴링 시작 */
  startPolling(intervalMs = 5000): void {
    if (this.pollTimer) return
    this.pollTimer = setInterval(() => {
      this.pollPendingTransfers().catch((e) => {
        console.error('[TransferLifecycleService] poll error:', e)
      })
    }, intervalMs)
  }

  /** 주기적 폴링 중지 */
  stopPolling(): void {
    if (this.pollTimer) {
      clearInterval(this.pollTimer)
      this.pollTimer = null
    }
  }

  // ─── 보내기 (Outgoing) ───

  async initiateTransfer(
    intent: TransferIntent,
    protocol: string,
  ): Promise<PendingTransfer> {
    const operator = this.operators.get(protocol)
    if (!operator) throw new Error(`Unknown protocol: ${protocol}`)

    // 1. 준비
    let transfer = await operator.prepare(intent)
    await this.transferStore.create(transfer)

    // 2. 실행 (실패해도 store에는 남김)
    try {
      transfer = await operator.execute(transfer)
      await this.transferStore.update(transfer.id, transfer)
    } catch (error) {
      const failed = transitionPhase(
        transfer,
        'failed',
        Date.now(),
      )
      await this.transferStore.update(failed.id, failed)
      this.eventBus.emit({
        type: 'transfer:failed',
        payload: { transfer: failed, reason: String(error) },
      })
      return failed
    }

    // 3. 이벤트 발행
    this.eventBus.emit({
      type: 'transfer:submitted',
      payload: { transfer },
    })

    return transfer
  }

  // ─── 받기 (Incoming) 처리 ───

  async initiateIncomingTransfer(
    intent: TransferIntent,
    protocol: string,
  ): Promise<PendingTransfer> {
    const operator = this.operators.get(protocol)
    if (!operator) throw new Error(`Unknown protocol: ${protocol}`)
    if (!operator.prepareReceive) {
      throw new Error(`Protocol ${protocol} does not support incoming transfers`)
    }

    const prepared = await operator.prepareReceive(intent)
    // Incoming: quote/invoice 생성이 곧 제출(submission)이다
    const transfer = transitionPhase(prepared, 'submitted', Date.now())
    await this.transferStore.create(transfer)

    this.eventBus.emit({
      type: 'transfer:submitted',
      payload: { transfer },
    })

    return transfer
  }

  async processIncomingTransfer(transferId: string): Promise<void> {
    console.log('[TLS] processIncomingTransfer called:', transferId)
    const transfer = await this.transferStore.get(transferId)
    console.log('[TLS] Got transfer:', transfer?.id, 'direction:', transfer?.direction)
    if (!transfer || transfer.direction !== 'incoming') {
      console.log('[TLS] Early return: no transfer or wrong direction')
      return
    }

    const operator = this.findOperator(transfer)
    console.log('[TLS] Found operator:', operator?.protocol)
    if (!operator?.processIncoming) {
      console.log('[TLS] Early return: no operator or processIncoming')
      return
    }

    try {
      console.log('[TLS] Calling operator.processIncoming...')
      const processed = await operator.processIncoming(transfer)
      console.log('[TLS] processIncoming result phase:', processed.phase)
      await this.transferStore.update(processed.id, processed)

      this.eventBus.emit({
        type: 'incoming:processed',
        payload: { transfer: processed },
      })

      if (isTerminal(processed.phase)) {
        await this.finalizeTransfer(processed)
      }
    } catch (error) {
      console.error('[TLS] processIncomingTransfer error:', error)
      // 에러 발생 시 failed 상태로 전환
      const failed = transitionPhase(transfer, 'failed', Date.now())
      await this.transferStore.update(failed.id, failed)

      this.eventBus.emit({
        type: 'transfer:failed',
        payload: { transfer: failed, reason: String(error) },
      })

      throw error // 호출자에게 에러 전파
    }
  }

  /** 외부에서 생성한 PendingTransfer를 store에 등록 */
  async registerTransfer(transfer: PendingTransfer): Promise<void> {
    await this.transferStore.create(transfer)
  }

  /** 사용자가 "받기" 클릭 */
  async claimIncomingTransfer(transferId: string): Promise<void> {
    const transfer = await this.transferStore.get(transferId)
    if (!transfer || transfer.direction !== 'incoming') {
      throw new Error('Not an incoming transfer')
    }
    if (!canComplete(transfer)) {
      throw new Error('Transfer is not ready to be completed')
    }

    const operator = this.findOperator(transfer)
    if (!operator?.claimReceive) {
      throw new Error('Cannot claim this transfer')
    }

    const settled = await operator.claimReceive(transfer)
    await this.transferStore.update(settled.id, settled)

    this.eventBus.emit({
      type: 'transfer:settled',
      payload: { transfer: settled },
    })
  }

  // ─── 폴링 (주기적 실행) ───

  async pollPendingTransfers(): Promise<void> {
    const pending = await this.transferStore.listActive()

    for (const transfer of pending) {
      const operator = this.findOperator(transfer)
      if (!operator) continue

      const previousPhase = transfer.phase
      const newPhase = await operator.poll(transfer)

      if (newPhase !== transfer.phase) {
        const updated = transitionPhase(transfer, newPhase, Date.now())
        await this.transferStore.update(updated.id, updated)

        this.eventBus.emit({
          type: 'transfer:phase-changed',
          payload: { transfer: updated, previousPhase },
        })

        // 최종 상태면 정리
        if (isTerminal(newPhase)) {
          await this.finalizeTransfer(updated)
        }
      }
    }
  }

  // ─── 회수 ───

  async reclaimTransfer(transferId: string): Promise<void> {
    const transfer = await this.transferStore.get(transferId)
    if (!transfer || !canReclaim(transfer)) {
      throw new Error('Cannot reclaim this transfer')
    }

    const operator = this.findOperator(transfer)
    if (!operator?.reclaim) {
      throw new Error('Reclaim not supported for this protocol')
    }

    await operator.reclaim(transfer)

    const updated = transitionPhase(transfer, 'settled', Date.now())
    await this.transferStore.update(updated.id, updated)

    this.eventBus.emit({
      type: 'transfer:reclaimed',
      payload: { transfer: updated },
    })
  }

  // ─── 복구 (앱 재시작 시) ───

  async recoverTransfers(): Promise<void> {
    // 1. 'preparing'에 갇힌 transfer 정리 (앱 crash 시)
    const stuckPreparing = await this.transferStore.listByPhase(['preparing'])
    for (const transfer of stuckPreparing) {
      if (transfer.direction === 'incoming') {
        // incoming은 quote가 이미 mint에 존재 → submitted로 전이
        const updated = transitionPhase(transfer, 'submitted', Date.now())
        await this.transferStore.update(updated.id, updated)
        this.eventBus.emit({
          type: 'transfer:phase-changed',
          payload: { transfer: updated, previousPhase: 'preparing' },
        })
      } else {
        // outgoing: execute 중 crash → 실행 여부를 알 수 없으므로 failed
        const failed = transitionPhase(transfer, 'failed', Date.now())
        await this.transferStore.update(failed.id, failed)
        this.eventBus.emit({
          type: 'transfer:failed',
          payload: { transfer: failed, reason: 'app-crashed-during-execution' },
        })
      }
    }

    // 2. active transfer들은 needs-polling 이벤트 발행
    const active = await this.transferStore.listActive()
    for (const transfer of active) {
      this.eventBus.emit({
        type: 'transfer:needs-polling',
        payload: { transfer },
      })
    }
  }

  // ─── Private helpers ───

  private findOperator(transfer: PendingTransfer): TransferOperator | undefined {
    const ref = transfer.transportRef as { type?: string; protocol?: string }
    const key = ref.protocol || ref.type?.split('-')[0]
    //console.log('[TLS] findOperator: type=', ref.type, 'protocol=', ref.protocol, 'key=', key)
    //console.log('[TLS] Available operators:', Array.from(this.operators.keys()))
    return key ? this.operators.get(key) : undefined
  }

  private async finalizeTransfer(transfer: PendingTransfer): Promise<void> {
    if (transfer.phase === 'settled') {
      this.eventBus.emit({
        type: 'transfer:settled',
        payload: { transfer },
      })
    } else if (transfer.phase === 'failed') {
      this.eventBus.emit({
        type: 'transfer:failed',
        payload: { transfer, reason: 'terminal-failure' },
      })
    }
  }
}
