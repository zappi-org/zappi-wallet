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

  prepare(intent: TransferIntent): Promise<PendingTransfer>
  execute(transfer: PendingTransfer): Promise<PendingTransfer>
  poll(transfer: PendingTransfer): Promise<TransferPhase>

  reclaim?(transfer: PendingTransfer): Promise<void>

  processIncoming?(transfer: PendingTransfer): Promise<PendingTransfer>
}

