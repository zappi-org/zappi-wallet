import type { JsonValue } from '@/core/domain/json'
import type { SwapOutStage } from '@/core/domain/swap-out'
import type { TransferPhase } from '@/core/domain/pending-transfer'
import type { SwapOutDeadline } from './swap-out-provider.port'

export type SwapOutPaymentStatus =
  | 'prepared'
  | 'dispatched'
  | 'paid'
  | 'failed'
  | 'rolled_back'

export interface SwapOutPayment {
  request: string
  amount: number
  operationId: string | null
  feeReserve: number
  status: SwapOutPaymentStatus
  feePaid: number | null
  settledAt: number | null
}

export interface SwapOutRecord {
  id: string
  version: number
  providerId: string
  offerId?: string
  identifier?: string
  mintUrl: string
  destination: string
  sendAmount: number
  receiveAmount: number
  stage: SwapOutStage
  phase: TransferPhase
  providerRef: JsonValue
  payments: SwapOutPayment[]
  payoutTxId: string | null
  failureReason: string | null
  publishedAt: number | null
  dispatchedAt?: number | null
  deadline: SwapOutDeadline
  createdAt: number
  updatedAt: number
}

export type SwapOutUpdate = Partial<
  Omit<SwapOutRecord, 'id' | 'createdAt' | 'version'>
> & { secrets?: string }

export interface SwapOutStore {
  create(record: SwapOutRecord, secrets: string): Promise<void>
  get(id: string): Promise<SwapOutRecord | null>
  update(id: string, expectedVersion: number, changes: SwapOutUpdate): Promise<boolean>
  readSecrets(id: string): Promise<string | null>
  listActive(): Promise<SwapOutRecord[]>
  list(): Promise<SwapOutRecord[]>
}
