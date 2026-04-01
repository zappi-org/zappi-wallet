import type { PendingOperationRepository } from '@/core/ports/driven/pending-operation.repository.port'
import type { PendingOperation } from '@/core/domain/pending-operation'
import { sat } from '@/core/domain/amount'
import { getDatabase } from '@/data/database/schema'

/**
 * kind별로 레거시 Dexie 테이블에 라우팅하는 어댑터.
 *
 *   'melt'        → db.pendingMelts
 *   'send-token'  → db.pendingSendTokens
 *   'mint-quote'  → db.transactions (status=pending, type=lightning, direction=receive)
 */
export class DexiePendingOperationRepository implements PendingOperationRepository {
  private get db() {
    return getDatabase()
  }

  async list(): Promise<PendingOperation[]> {
    const [melts, sendTokens, mintQuotes] = await Promise.all([
      this.listMelts(),
      this.listSendTokens(),
      this.listMintQuotes(),
    ])
    return [...melts, ...sendTokens, ...mintQuotes]
  }

  async listByAccount(accountId: string): Promise<PendingOperation[]> {
    const all = await this.list()
    return all.filter((op) => op.accountId === accountId)
  }

  async delete(id: string): Promise<void> {
    // 각 테이블에서 시도 — id가 어느 테이블에 있는지 도메인은 모른다
    await Promise.all([
      this.db.pendingMelts.delete(id).catch(() => {}),
      this.db.pendingSendTokens.delete(id).catch(() => {}),
    ])
  }

  async deleteExpired(maxAgeMs: number): Promise<number> {
    const cutoff = Date.now() - maxAgeMs
    let deleted = 0

    const expiredMelts = await this.db.pendingMelts
      .where('createdAt')
      .below(cutoff)
      .toArray()
    for (const m of expiredMelts) {
      await this.db.pendingMelts.delete(m.meltQuoteId)
      deleted++
    }

    const expiredSendTokens = await this.db.pendingSendTokens
      .where('createdAt')
      .below(cutoff)
      .toArray()
    for (const s of expiredSendTokens) {
      await this.db.pendingSendTokens.delete(s.id)
      deleted++
    }

    return deleted
  }

  async count(): Promise<number> {
    const [melts, sendTokens, mintQuotes] = await Promise.all([
      this.db.pendingMelts.count(),
      this.db.pendingSendTokens.count(),
      this.db.transactions
        .where('status')
        .equals('pending')
        .and((tx) => tx.type === 'lightning' && tx.direction === 'receive')
        .count(),
    ])
    return melts + sendTokens + mintQuotes
  }

  // ─── 내부 변환 ───

  private async listMelts(): Promise<PendingOperation[]> {
    const records = await this.db.pendingMelts.toArray()
    return records.map((r) => ({
      id: r.meltQuoteId,
      kind: 'melt',
      accountId: r.mintUrl,
      amount: sat(r.amount),
      createdAt: r.createdAt,
      metadata: { destination: r.destination, fee: r.fee },
    }))
  }

  private async listSendTokens(): Promise<PendingOperation[]> {
    const records = await this.db.pendingSendTokens.toArray()
    return records.map((r) => ({
      id: r.id,
      kind: 'send-token',
      accountId: r.mintUrl,
      amount: sat(r.amount),
      createdAt: r.createdAt,
      metadata: {
        ...(r.token != null && { token: r.token }),
        ...(r.operationId != null && { operationId: r.operationId }),
      },
    }))
  }

  private async listMintQuotes(): Promise<PendingOperation[]> {
    const records = await this.db.transactions
      .where('status')
      .equals('pending')
      .and((tx) => tx.type === 'lightning' && tx.direction === 'receive')
      .toArray()
    return records.map((r) => ({
      id: r.id,
      kind: 'mint-quote',
      accountId: r.mintUrl,
      amount: sat(r.amount),
      createdAt: r.createdAt,
      metadata: {
        ...(r.metadata?.quoteId != null && { quoteId: r.metadata.quoteId }),
        ...(r.bolt11 != null && { bolt11: r.bolt11 }),
      },
    }))
  }
}
