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
import type { NostrGateway } from '@/core/ports/driven/nostr-gateway.port'
import { sat, add } from '@/core/domain/amount'
import {
  CashuLightningAdapter,
  type LightningBackend,
} from './adapters/cashu-lightning.adapter'
import {
  CashuEcashAdapter,
  type EcashBackend,
  type LockingCondition,
} from './adapters/cashu-ecash.adapter'

// ─── PaymentRequest types ───

export interface ResolvedCreq {
  payableMints: string[]
  allowedMints: string[]
  amount?: number
  transport: { type: 'inband' } | { type: 'http'; url: string }
  nut10?: { kind: string; data: string; tags?: string[][] }
}

export interface PreparedCreq {
  operationId: string
  resolved: ResolvedCreq
}

export interface CreqExecutionResult {
  type: 'inband' | 'http'
  token?: string
}

// ─── PaymentRequest backend interface ───

export interface PaymentRequestBackend {
  parsePaymentRequest(creq: string): Promise<ResolvedCreq>
  preparePaymentRequest(resolved: ResolvedCreq, options: { mintUrl: string; amount?: number }): Promise<PreparedCreq>
  executePaymentRequest(prepared: PreparedCreq): Promise<CreqExecutionResult>
}

// ─── Module-level backend interface (DI용) ───

export interface CashuModuleBackend extends LightningBackend, EcashBackend, PaymentRequestBackend {
  getBalances(): Promise<{ [mintUrl: string]: number }>
}

// ─── Module ───

export class CashuModule implements WalletModule {
  readonly id = 'cashu'
  readonly displayName = 'Cashu'

  private adapters: PaymentMethodAdapter[] = []
  private initialized = false
  private eventHandlers = new Map<string, Set<(...args: unknown[]) => void>>()

  constructor(
    private backend: CashuModuleBackend,
    private nostrGateway?: NostrGateway,
  ) {}

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

  // ─── NUT-18 Payment Request ───

  /**
   * creq 결제.
   * HTTP transport → Coco가 POST 자동 처리.
   * inband → token 반환 + NostrGateway로 DM 전송.
   */
  async payCreq(
    creqString: string,
    accountId: string,
    options?: {
      nostrContext?: { recipientPubkey: string; relays: string[] }
      lockingCondition?: LockingCondition
    },
  ): Promise<CreqExecutionResult> {
    const resolved = await this.backend.parsePaymentRequest(creqString)

    // lockingCondition이 명시되면 prepareSend로 직접 처리 (P2PK lock 등)
    // 없으면 기존 PaymentRequest 경로
    const lockingCondition = options?.lockingCondition
    const amount = resolved.amount

    const prepared = await this.backend.preparePaymentRequest(resolved, {
      mintUrl: accountId,
      amount,
    })

    // P2PK locking condition이 있으면 prepareSend 경로로 전환
    let result: CreqExecutionResult
    if (lockingCondition) {
      // PaymentRequest의 send operation을 취소하고 P2PK로 재준비
      // TODO: Coco가 PaymentRequest + P2PK를 동시에 지원하면 간소화 가능
      const sendPrepared = await this.backend.prepareSend({
        mintUrl: accountId,
        amount: amount ?? 0,
        lockingCondition,
      })
      const { token } = await this.backend.executeSend(sendPrepared.operationId)
      result = { type: resolved.transport.type === 'http' ? 'http' : 'inband', token }
    } else {
      result = await this.backend.executePaymentRequest(prepared)
    }

    if (result.type === 'inband' && result.token && options?.nostrContext && this.nostrGateway) {
      await this.nostrGateway.sendDirectMessage({
        recipientPubkey: options.nostrContext.recipientPubkey,
        content: result.token,
        relays: options.nostrContext.relays,
      })
    }

    return result
  }

  // ─── Events ───

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
