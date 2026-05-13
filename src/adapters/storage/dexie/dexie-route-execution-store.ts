import type { RouteExecutionStore } from '@/core/ports/driven/route-execution-store.port'
import { getDatabase } from './schema'

export class DexieRouteExecutionStore implements RouteExecutionStore {
  private get db() {
    return getDatabase()
  }

  async savePendingMelt(params: {
    quoteId: string
    mintUrl: string
    amount: number
    fee: number
    destination?: string
  }): Promise<void> {
    await this.db.pendingMelts.put({
      meltQuoteId: params.quoteId,
      mintUrl: params.mintUrl,
      amount: params.amount,
      fee: params.fee,
      destination: params.destination ?? '',
      createdAt: Date.now(),
    })
  }

  async deletePendingMelt(quoteId: string): Promise<void> {
    await this.db.pendingMelts.delete(quoteId)
  }

  async savePendingSendToken(params: {
    id: string
    token: string
    mintUrl: string
    amount: number
    operationId: string
  }): Promise<void> {
    await this.db.pendingSendTokens.put({
      id: params.id,
      token: params.token,
      mintUrl: params.mintUrl,
      amount: params.amount,
      operationId: params.operationId,
      createdAt: Date.now(),
    })
  }
}
