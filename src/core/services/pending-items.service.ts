/**
 * PendingItemsService — pending items query
 *
 * 여러 도메인(수신 토큰, 수신 요청, 발신 토큰)의 pending 상태를 합쳐서 조회.
 * query-only 서비스.
 */

import type { PendingItemsUseCase, PendingItem } from '@/core/ports/driving/pending-items.usecase'
import type { PendingQuote } from '@/core/domain/quote'
import type { TransactionRepository } from '@/core/ports/driven/transaction.repository.port'

export interface PendingItemsDataSource {
  getPendingReceivedTokens(mintVariants?: string[]): Promise<Array<{ id: string; amount: number; mintUrl: string; createdAt: number; token: string }>>
  getPendingReceiveRequests(mintVariants?: string[]): Promise<Array<{
    id: string; amount: number; mintUrl: string; createdAt: number; expiresAt: number
    quoteId: string; invoice: string
    ecashRequest?: string; ecashRequestId?: string; httpEndpoint?: string; bip321Uri?: string
  }>>
  getPendingSendTokens(mintVariants?: string[]): Promise<Array<{ id: string; amount: number; mintUrl: string; createdAt: number; token?: string; operationId?: string }>>
  getActivePendingQuotes(): Promise<PendingQuote[]>
}

export class PendingItemsService implements PendingItemsUseCase {
  constructor(
    private dataSource: PendingItemsDataSource,
    private txRepo: TransactionRepository,
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

  private async queryAndMerge(mintVariants?: string[]): Promise<PendingItem[]> {
    const [receivedTokens, receiveRequests, sendTokens] = await Promise.all([
      this.dataSource.getPendingReceivedTokens(mintVariants),
      this.dataSource.getPendingReceiveRequests(mintVariants),
      this.dataSource.getPendingSendTokens(mintVariants),
    ])

    const items: PendingItem[] = [
      ...receivedTokens.map((t) => ({
        id: t.id,
        type: 'unclaimed-token' as const,
        amount: t.amount,
        mintUrl: t.mintUrl,
        createdAt: t.createdAt,
        token: t.token,
      })),
      ...receiveRequests.map((r) => ({
        id: r.id,
        type: 'receive-request' as const,
        amount: r.amount,
        mintUrl: r.mintUrl,
        createdAt: r.createdAt,
        expiresAt: r.expiresAt,
        quoteId: r.quoteId,
        invoice: r.invoice,
        ecashRequest: r.ecashRequest,
        ecashRequestId: r.ecashRequestId,
        bip321Uri: r.bip321Uri,
        httpEndpoint: r.httpEndpoint,
      })),
      ...await Promise.all(sendTokens.map(async (s) => {
        let memo: string | undefined
        try {
          const tx = await this.txRepo.getById(s.id)
          memo = tx?.memo
        } catch { /* ignore */ }
        return {
          id: s.id,
          type: 'sent-token' as const,
          amount: s.amount,
          mintUrl: s.mintUrl,
          createdAt: s.createdAt,
          token: s.token,
          operationId: s.operationId,
          memo,
        }
      })),
    ]

    const now = Date.now()
    return items
      .filter((item) => !item.expiresAt || item.expiresAt >= now)
      .sort((a, b) => b.createdAt - a.createdAt)
  }
}
