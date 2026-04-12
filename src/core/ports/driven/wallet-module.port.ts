import type { Amount } from '@/core/domain/amount'
import type { PaymentMethodAdapter } from './payment-method.port'

export interface SendParams {
  destination?: string
  accountId: string
  amount: Amount
  memo?: string
  options?: Record<string, unknown>
}

export interface SendResult {
  operationId: string
  method: string
  protocol: string
  state: string
  data?: Record<string, unknown>
  effectiveFee?: Amount
}

export interface WalletModule {
  readonly id: string
  readonly displayName: string

  initialize(): Promise<void>
  dispose(): Promise<void>
  isEnabled(): boolean

  send(params: SendParams): Promise<SendResult>

  getPaymentAdapters(): PaymentMethodAdapter[]
  getCapabilities(): ModuleCapability[]
  getBalance(): Promise<ModuleBalance>

  on(event: string, handler: (...args: unknown[]) => void): () => void
}

export interface ModuleBalance {
  moduleId: string
  accounts: { id: string; label: string; amount: Amount }[]
  total: Amount
}

export interface ModuleCapability {
  id: string
  protocol: 'bolt11' | 'bolt12' | 'ecash'
  operations: string[]
}
