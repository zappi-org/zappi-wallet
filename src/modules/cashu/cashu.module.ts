/**
 * CashuModule — WalletModule 구현체
 *
 * CashuBackend + Lightning/Ecash adapters를 조립하여
 * WalletModule port를 구현하는 Driven Adapter.
 *
 * internal/ (Coco SDK)을 직접 import하지 않음 — factory가 담당.
 */

import type {
  WalletModule,
  ModuleBalance,
  ModuleCapability,
} from '@/core/ports/driven/wallet-module.port'
import type { PaymentMethodAdapter } from '@/core/ports/driven/payment-method.port'
import { sat, add } from '@/core/domain/amount'
import {
  CashuLightningAdapter,
  type LightningBackend,
} from './adapters/cashu-lightning.adapter'
import {
  CashuEcashAdapter,
  type EcashBackend,
} from './adapters/cashu-ecash.adapter'

// ─── Module-level backend interface (DI용) ───

export interface CashuModuleBackend extends LightningBackend, EcashBackend {
  getBalances(): Promise<{ [mintUrl: string]: number }>
}

// ─── Module ───

export class CashuModule implements WalletModule {
  readonly id = 'cashu'
  readonly displayName = 'Cashu'

  private adapters: PaymentMethodAdapter[] = []
  private initialized = false
  private eventHandlers = new Map<string, Set<(...args: unknown[]) => void>>()

  constructor(private backend: CashuModuleBackend) {}

  async initialize(_seed: Uint8Array, _derivationPath: string): Promise<void> {
    this.adapters = [
      new CashuLightningAdapter(this.backend),
      new CashuEcashAdapter(this.backend),
    ]
    this.initialized = true
  }

  async dispose(): Promise<void> {
    this.adapters = []
    this.eventHandlers.clear()
    this.initialized = false
  }

  isEnabled(): boolean {
    return this.initialized
  }

  getPaymentAdapters(): PaymentMethodAdapter[] {
    return this.adapters
  }

  getCapabilities(): ModuleCapability[] {
    return [
      { id: 'lightning', operations: ['send', 'receive'] },
      { id: 'ecash', operations: ['send', 'receive'] },
    ]
  }

  async getBalance(): Promise<ModuleBalance> {
    const balances = await this.backend.getBalances()
    const accounts = Object.entries(balances).map(([mintUrl, sats]) => ({
      id: mintUrl,
      label: mintUrl,
      amount: sat(sats),
    }))
    return {
      moduleId: this.id,
      accounts,
      total: accounts.reduce((sum, a) => add(sum, a.amount), sat(0)),
    }
  }

  on(event: string, handler: (...args: unknown[]) => void): () => void {
    if (!this.eventHandlers.has(event)) {
      this.eventHandlers.set(event, new Set())
    }
    this.eventHandlers.get(event)!.add(handler)
    return () => {
      this.eventHandlers.get(event)?.delete(handler)
    }
  }
}
