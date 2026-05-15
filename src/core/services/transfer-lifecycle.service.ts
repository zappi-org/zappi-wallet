/**
 * TransferLifecycleService — 프로토콜 중립적인 전송 상태 관리 서비스
 *
 * 보내기/받기, Bolt11/Ecash/미래 프로토콜 모두 동일한 상태 머신으로 추적.
 * Adapter에게 실행을 위임하고, 상태만 관리한다.
 */

import type { PendingTransfer } from '@/core/domain/pending-transfer'
import { isTerminal, canReclaim, transitionPhase } from '@/core/domain/pending-transfer'
import type { EventBus } from '@/core/events/event-bus'
import type { PendingTransferStore } from '@/core/ports/driven/pending-transfer-store.port'
import type { TransferIntent, TransferOperator } from '@/core/ports/driven/transfer-operator.port'

export class TransferLifecycleService {
  constructor(
    private readonly transferStore: PendingTransferStore,
    private readonly operators: Map<string, TransferOperator>,
    private readonly eventBus: EventBus,
  ) {}

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

  async processIncomingTransfer(transferId: string): Promise<void> {
    const transfer = await this.transferStore.get(transferId)
    if (!transfer || transfer.direction !== 'incoming') return

    const operator = this.findOperator(transfer)
    if (!operator?.processIncoming) return

    const processed = await operator.processIncoming(transfer)
    await this.transferStore.update(processed.id, processed)

    this.eventBus.emit({
      type: 'incoming:processed',
      payload: { transfer: processed },
    })
  }

  /** 사용자가 "받기" 클릭 */
  async claimIncomingTransfer(transferId: string): Promise<void> {
    const transfer = await this.transferStore.get(transferId)
    if (!transfer || transfer.direction !== 'incoming') {
      throw new Error('Not an incoming transfer')
    }

    const operator = this.findOperator(transfer)
    if (!operator?.execute) {
      throw new Error('Cannot claim this transfer')
    }

    // execute = redeem (mint에서 proofs 교환)
    const settled = await operator.execute(transfer)
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
