/**
 * PendingItemsService — pending item query + lifecycle
 *
 * 여러 도메인(수신 토큰, 수신 요청, 발신 토큰)의 pending 상태를 합쳐서 조회하고,
 * receive request의 effective expiry 판정과 정리를 담당한다.
 */

import { checkEffectiveExpiry, type CounterpartyStateProbe, type EffectiveExpiryStatus } from '@/core/domain/effective-expiry'
import { toNumber } from '@/core/domain/amount'
import { expireReceiveRequest, isPending, type PaymentMethod, type ReceiveRequest } from '@/core/domain/receive-request'
import type { PendingItemsUseCase, PendingItem } from '@/core/ports/driving/pending-items.usecase'
import type { PendingQuote } from '@/core/domain/quote'
import type { PaymentMethodAdapter } from '@/core/ports/driven/payment-method.port'
import type { ReceiveRequestRepository } from '@/core/ports/driven/receive-request.repository.port'
import type { TransactionRepository } from '@/core/ports/driven/transaction.repository.port'

export interface PendingItemsDataSource {
  getPendingReceivedTokens(mintVariants?: string[]): Promise<Array<{ id: string; amount: number; mintUrl: string; createdAt: number; token: string }>>
  getPendingSendTokens(mintVariants?: string[]): Promise<Array<{ id: string; amount: number; mintUrl: string; createdAt: number; token?: string; operationId?: string }>>
  getActivePendingQuotes(): Promise<PendingQuote[]>
}

export class PendingItemsService implements PendingItemsUseCase {
  constructor(
    private dataSource: PendingItemsDataSource,
    private txRepo: TransactionRepository,
    private receiveRequestRepo: ReceiveRequestRepository,
    private getReceiveAdapters: () => PaymentMethodAdapter[],
  ) {}

  async getByMint(mintUrl: string): Promise<PendingItem[]> {
    const base = mintUrl.replace(/\/+$/, '')
    const variants = [base, base + '/']
    return this.queryAndMerge(variants)
  }

  async getAll(): Promise<PendingItem[]> {
    return this.queryAndMerge()
  }

  async getActivePendingQuotes(): Promise<PendingQuote[]> {
    return this.dataSource.getActivePendingQuotes()
  }

  async checkEffectiveExpiry(id: string): Promise<EffectiveExpiryStatus> {
    const request = await this.receiveRequestRepo.getById(id)
    if (!request) {
      return 'expired'
    }
    if (!isPending(request)) {
      // A paid request is done, not dead — callers must never expire it.
      return request.fulfillmentStatus === 'fulfilled' ? 'fulfilled' : 'expired'
    }

    const probes = request.paymentMethods
      .filter((method) => method.status === 'active')
      .map((method) => this.createProbe(request, method))
      .filter((probe): probe is CounterpartyStateProbe => probe !== null)

    return checkEffectiveExpiry(request, probes)
  }

  async expireById(id: string): Promise<void> {
    const now = Date.now()
    const request = await this.receiveRequestRepo.update(id, (current) =>
      isPending(current) ? expireReceiveRequest(current, now) : current,
    )

    if (request) {
      if (request.fulfillmentStatus !== 'expired') {
        return
      }

      const txIds = new Set([id, ...request.paymentMethods.map((method) => method.ref)])
      await Promise.all(Array.from(txIds).map(async (txId) => {
        await this.txRepo.delete(txId).catch(() => {})
      }))
      return
    }

    await this.txRepo.delete(id).catch(() => {})
  }

  private async queryAndMerge(mintVariants?: string[]): Promise<PendingItem[]> {
    const [receivedTokens, receiveRequests, sendTokens] = await Promise.all([
      this.dataSource.getPendingReceivedTokens(mintVariants),
      this.receiveRequestRepo.listPending(mintVariants),
      this.dataSource.getPendingSendTokens(mintVariants),
    ])

    const items: PendingItem[] = [
      ...receivedTokens.map((t) => ({
        id: t.id,
        direction: 'receive' as const,
        kind: 'token' as const,
        amount: t.amount,
        accountId: t.mintUrl,
        createdAt: t.createdAt,
        details: { token: t.token },
      })),
      ...receiveRequests.map((r) => ({
        id: r.id,
        direction: 'receive' as const,
        kind: 'request' as const,
        amount: toNumber(r.amount),
        accountId: r.accountId,
        createdAt: r.createdAt,
        expiresAt: r.expiresAt,
        details: {
          quoteId: r.paymentMethods.find((method) => method.type === 'bolt11')?.ref ?? '',
          invoice: r.paymentMethods.find((method) => method.type === 'bolt11')?.encoded ?? '',
          ecashRequest: r.paymentMethods.find((method) => method.type === 'ecash')?.encoded,
          ecashRequestId: r.paymentMethods.find((method) => method.type === 'ecash')?.ref,
          bip321Uri: r.bip321Uri,
          httpEndpoint: (r.paymentMethods.find((method) => method.type === 'ecash')?.metadata as Record<string, unknown> | undefined)?.httpEndpoint as
            | string
            | undefined,
        },
      })),
      ...await Promise.all(sendTokens.map(async (s) => {
        let memo: string | undefined
        try {
          const tx = await this.txRepo.getById(s.id)
          memo = tx?.memo
        } catch { /* ignore */ }
        return {
          id: s.id,
          direction: 'send' as const,
          kind: 'token' as const,
          amount: s.amount,
          accountId: s.mintUrl,
          createdAt: s.createdAt,
          memo,
          details: { token: s.token, operationId: s.operationId },
        }
      })),
    ]

    const now = Date.now()
    return items
      .filter((item) => !item.expiresAt || item.expiresAt >= now)
      .sort((a, b) => b.createdAt - a.createdAt)
  }

  private createProbe(request: ReceiveRequest, method: PaymentMethod): CounterpartyStateProbe | null {
    const adapter = this.resolveAdapter(method)
    if (!adapter?.checkAlive) {
      return null
    }

    return {
      checkAlive: async () => {
        try {
          return await adapter.checkAlive!({
            requestId: method.ref,
            accountId: request.accountId,
          })
        } catch {
          return undefined
        }
      },
    }
  }

  private resolveAdapter(method: PaymentMethod): PaymentMethodAdapter | undefined {
    return this.getReceiveAdapters().find((adapter) => adapter.protocol === method.type)
  }
}
