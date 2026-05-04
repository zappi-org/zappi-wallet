/**
 * CashuModule — WalletModule 구현체
 *
 * CashuBackend + Lightning/Ecash adapters를 조립하여
 * WalletModule port를 구현하는 Driven Adapter.
 *
 * destination을 보고 프로토콜 판단 + 적절한 adapter 위임.
 * PaymentService는 destination 내용을 모름 — module에 위임할 뿐.
 *
 * internal/ (Coco SDK)을 직접 import하지 않음 — factory가 담당.
 */

import type {
  WalletModule,
  ModuleBalance,
  ModuleCapability,
  SendParams as ModuleSendParams,
  SendResult as ModuleSendResult,
} from '@/core/ports/driven/wallet-module.port'
import type { PaymentMethodAdapter } from '@/core/ports/driven/payment-method.port'
import type { NostrGateway } from '@/core/ports/driven/nostr-gateway.port'
import type { ProofStateResult } from '@/core/ports/driven/send-token-operator.port'
import { sat, add, toNumber } from '@/core/domain/amount'
import {
  CashuBolt11Adapter,
  type LightningBackend,
} from './adapters/cashu-bolt11.adapter'
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
  restoreWallet(mintUrl: string): Promise<void>
  recoverPendingQuotes(): Promise<{ recovered: number; failed: number; expired: number }>
  storeOfflineToken(token: string, amount: number, mintUrl: string, dleqStatus: 'valid' | 'missing'): Promise<string>
  inspectInput(token: string): Promise<import('@/core/ports/driven/payment-method.port').InputInspection>
  abandonMintQuote(mintUrl: string, quoteId: string): Promise<void>
  checkProofStates(token: string): Promise<ProofStateResult>
}

// ─── Module ───

export class CashuModule implements WalletModule {
  readonly id = 'cashu'
  readonly displayName = 'Cashu'

  private bolt11Adapter!: CashuBolt11Adapter
  private ecashAdapter!: CashuEcashAdapter
  private adapters: PaymentMethodAdapter[] = []
  private initialized = false
  private eventHandlers = new Map<string, Set<(...args: unknown[]) => void>>()

  constructor(
    private backend: CashuModuleBackend,
    private nostrGateway?: NostrGateway,
  ) {}

  async initialize(): Promise<void> {
    this.bolt11Adapter = new CashuBolt11Adapter(this.backend)
    this.ecashAdapter = new CashuEcashAdapter(this.backend)
    this.adapters = [this.bolt11Adapter, this.ecashAdapter]
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

  // ─── Send (프로토콜 판단 + adapter 위임) ───

  private readonly protocolRoutes = [
    { test: isCreq, handler: (p: ModuleSendParams) => this.sendCreq(p) },
    { test: isLightning, handler: (p: ModuleSendParams) => this.sendViaLightning(p) },
  ]

  async send(params: ModuleSendParams): Promise<ModuleSendResult> {
    if (!params.destination) {
      return this.createToken(params)
    }
    const route = this.protocolRoutes.find(r => r.test(params.destination!))
    if (!route) {
      throw new Error(`Unsupported destination format: ${params.destination.substring(0, 10)}...`)
    }
    return route.handler(params)
  }

  private async createToken(params: ModuleSendParams): Promise<ModuleSendResult> {
    const prepared = await this.ecashAdapter.prepareSend({
      accountId: params.accountId,
      amount: params.amount,
      memo: params.memo,
      options: params.options,
    })
    const result = await this.ecashAdapter.executeSend(prepared.id)
    return {
      operationId: prepared.id,
      method: 'cashu:ecash',
      protocol: 'cashu-token',
      state: 'completed',
      data: { token: result.data?.token },
    }
  }

  private async sendCreq(params: ModuleSendParams): Promise<ModuleSendResult> {
    const resolved = await this.backend.parsePaymentRequest(params.destination!)
    const lockingCondition = params.options?.lockingCondition as LockingCondition | undefined

    const prepared = await this.backend.preparePaymentRequest(resolved, {
      mintUrl: params.accountId,
      amount: resolved.amount ?? toNumber(params.amount),
    })

    let result: CreqExecutionResult
    if (lockingCondition) {
      const sendPrepared = await this.backend.prepareSend({
        mintUrl: params.accountId,
        amount: resolved.amount ?? toNumber(params.amount),
        lockingCondition,
      })
      const { token } = await this.backend.executeSend(sendPrepared.operationId)
      result = { type: resolved.transport.type === 'http' ? 'http' : 'inband', token }
    } else {
      result = await this.backend.executePaymentRequest(prepared)
    }

    // Nostr DM transport
    const nostrContext = params.options?.nostrContext as { recipientPubkey: string; relays: string[] } | undefined
    if (result.type === 'inband' && result.token && nostrContext && this.nostrGateway) {
      await this.nostrGateway.sendPrivateDirectMessage({
        recipientPubkey: nostrContext.recipientPubkey,
        content: result.token,
        relays: nostrContext.relays,
      })
    }

    return {
      operationId: prepared.operationId,
      method: 'cashu:ecash',
      protocol: 'nut18',
      state: 'completed',
      data: { type: result.type, token: result.token },
    }
  }

  private async sendViaLightning(params: ModuleSendParams): Promise<ModuleSendResult> {
    const prepared = await this.bolt11Adapter.prepareSend({
      destination: params.destination,
      amount: params.amount,
      accountId: params.accountId,
      memo: params.memo,
    })
    const result = await this.bolt11Adapter.executeSend(prepared.id)
    return {
      operationId: prepared.id,
      method: 'cashu:lightning',
      protocol: 'bolt11',
      state: result.state,
      data: result.data,
    }
  }

  // ─── Query ───

  getPaymentAdapters(): PaymentMethodAdapter[] {
    return this.adapters
  }

  getCapabilities(): ModuleCapability[] {
    return [
      { id: 'bolt11', protocol: 'bolt11', operations: ['send', 'receive'] },
      { id: 'ecash', protocol: 'ecash', operations: ['send', 'receive'] },
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

  async recoverAccount(accountId: string): Promise<void> {
    await this.backend.restoreWallet(accountId)
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

  emit(event: string, ...args: unknown[]): void {
    const handlers = this.eventHandlers.get(event)
    if (handlers) {
      for (const handler of handlers) {
        handler(...args)
      }
    }
  }
}

// ─── Protocol detection (module 내부) ───

function isCreq(destination: string): boolean {
  return /^creq[ab]/i.test(destination)
}

function isLightning(destination: string): boolean {
  const lower = destination.toLowerCase()
  return lower.startsWith('lnbc') || lower.startsWith('lntb') || lower.startsWith('lnbcrt')
    || lower.startsWith('lno') // bolt12 offer
}
