import type { PendingTransfer, TransferPhase } from "@/core/domain/pending-transfer";

import type { Amount } from '@/core/domain/amount'


export interface TransferIntent {
  txId: string
  accountId: string
  amount: Amount
  recipient?: string
  memo?: string
  /** Human-readable target for the archived record (recipient may be a raw invoice). */
  displayDestination?: string
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
   * Legacy batch polling (old path with ks.tls-sweep ON) — may include a remote
   * round-trip depending on transfer type. The new path (120s stuck-sweep) uses
   * pollLocal/confirmStuck.
   */
  poll(transfer: PendingTransfer): Promise<TransferPhase>

  /**
   * First-pass sweep decision — **zero-network contract**: returns transitions
   * decidable immediately from expiry / local op state alone. Returns the current
   * phase unchanged if nothing changed.
   */
  pollLocal?(transfer: PendingTransfer): Promise<TransferPhase>

  /**
   * One remote check once stuck is confirmed. null = this transfer type has no
   * remote-check concept (e.g. ecash awaiting manual receipt) — sweep must not count
   * it as stuck (avoids polluting the gate).
   */
  confirmStuck?(transfer: PendingTransfer): Promise<TransferPhase | null>

  reclaim?(transfer: PendingTransfer): Promise<void>

  processIncoming?(transfer: PendingTransfer): Promise<PendingTransfer>
}

