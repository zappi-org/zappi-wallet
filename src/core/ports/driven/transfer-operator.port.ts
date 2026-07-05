import type { PendingTransfer, TransferPhase } from "@/core/domain/pending-transfer";

import type { Amount } from '@/core/domain/amount'


export interface TransferIntent {
  txId: string
  accountId: string
  amount: Amount
  recipient?: string
  memo?: string
}

export interface MessageTransport {
  publish(params: {
    recipient: string
    content: string
    memo?: string
  }): Promise<{ deliveryId: string }>
  subscribe?(handler: (event: unknown) => Promise<void>): () => void
}

export interface TransferOperator {
  readonly protocol: string

  // ─── Outgoing ───
  prepare(intent: TransferIntent): Promise<PendingTransfer>
  execute(transfer: PendingTransfer): Promise<PendingTransfer>

  // ─── Incoming ───
  prepareReceive?(intent: TransferIntent): Promise<PendingTransfer>
  claimReceive?(transfer: PendingTransfer): Promise<PendingTransfer>

  /**
   * 레거시 일괄 폴링용 (ks.tls-sweep ON 구경로) — 전송타입에 따라 원격 왕복을
   * 포함할 수 있다. 신경로(120s stuck-sweep)는 pollLocal/confirmStuck을 쓴다.
   */
  poll(transfer: PendingTransfer): Promise<TransferPhase>

  /**
   * sweep 1차 판정 (설계 §7.2) — **네트워크 0 계약**: 만료·로컬 op 상태만으로
   * 즉시 판정 가능한 전이를 돌려준다. 변화 없으면 현재 phase 그대로.
   */
  pollLocal?(transfer: PendingTransfer): Promise<TransferPhase>

  /**
   * stuck 확정 시 원격 확인 1회 (설계 §7.3 매트릭스). null = 이 전송타입에는
   * 원격 확인 개념이 없음(예: 수동 수령 대기 ecash) — sweep은 stuck으로
   * 계수하지 않는다(§12 게이트 오염 방지).
   */
  confirmStuck?(transfer: PendingTransfer): Promise<TransferPhase | null>

  reclaim?(transfer: PendingTransfer): Promise<void>

  processIncoming?(transfer: PendingTransfer): Promise<PendingTransfer>
}

