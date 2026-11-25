import type { JsonValue } from '@/core/domain/json'
import type { OnchainPayoutStage } from '@/core/domain/onchain-payout'
import type { TransferPhase } from '@/core/domain/pending-transfer'
import type { OnchainPayoutDeadline } from './onchain-payout-provider.port'

export type OnchainPayoutPaymentStatus =
  | 'prepared'
  | 'dispatched'
  | 'paid'
  | 'failed'
  | 'rolled_back'

export interface OnchainPayoutPayment {
  request: string
  amount: number
  operationId: string | null
  feeReserve: number
  status: OnchainPayoutPaymentStatus
  feePaid: number | null
  settledAt: number | null
}

export interface OnchainPayoutRecord {
  id: string
  version: number
  providerId: string
  mintUrl: string
  destination: string
  sendAmount: number
  receiveAmount: number
  stage: OnchainPayoutStage
  phase: TransferPhase
  providerRef: JsonValue
  payments: OnchainPayoutPayment[]
  payoutTxId: string | null
  failureReason: string | null
  publishedAt: number | null
  deadline: OnchainPayoutDeadline
  createdAt: number
  updatedAt: number
}

export type OnchainPayoutUpdate = Partial<
  Omit<OnchainPayoutRecord, 'id' | 'createdAt' | 'version'>
> & { secrets?: string }

export interface OnchainPayoutStore {
  create(record: OnchainPayoutRecord, secrets: string): Promise<void>
  get(id: string): Promise<OnchainPayoutRecord | null>
  update(id: string, expectedVersion: number, changes: OnchainPayoutUpdate): Promise<boolean>
  readSecrets(id: string): Promise<string | null>
  listActive(): Promise<OnchainPayoutRecord[]>
  list(): Promise<OnchainPayoutRecord[]>
}
