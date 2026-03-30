import type { Amount } from '@/core/domain/amount'
import type { PaymentMethodAdapter } from './payment-method.port'

export interface WalletModule {
  readonly id: string
  readonly displayName: string

  initialize(seed: Uint8Array, derivationPath: string): Promise<void>
  dispose(): Promise<void>
  isEnabled(): boolean

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
  operations: string[]
}
