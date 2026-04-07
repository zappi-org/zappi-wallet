/**
 * TokenProcessorService — Nostr gift wrap 토큰 수신 처리
 *
 * useGiftWrapListener의 processToken 로직을 서비스로 추출.
 * store 변경 없이 결과만 반환 (store 갱신은 hook이 담당).
 */

import type { TokenProcessorUseCase, TokenProcessResult } from '@/core/ports/driving/token-processor.usecase'
import type { PaymentUseCase } from '@/core/ports/driving/payment.usecase'
import type { NostrGateway } from '@/core/ports/driven/nostr-gateway.port'
import type { ProcessedEventStore } from '@/core/ports/driven/processed-event-store.port'
import type { FailedIncomingStore } from '@/core/ports/driven/failed-incoming-store.port'
import type { TransactionRepository } from '@/core/ports/driven/transaction.repository.port'
import type { FailedIncoming, ProcessedEvent } from '@/core/types'
import { sat, toNumber } from '@/core/domain/amount'

interface TokenDecoder {
  decode(token: string): { mint: string; proofs: Array<{ amount: number }> }
}

export class TokenProcessorService implements TokenProcessorUseCase {
  constructor(
    private payment: PaymentUseCase,
    private nostrGateway: NostrGateway,
    private processedEventStore: ProcessedEventStore,
    private failedIncomingStore: FailedIncomingStore,
    private txRepo: TransactionRepository,
    private tokenDecoder: TokenDecoder,
  ) {}

  async processToken(params: {
    token: string
    eventId: string
    sender: string
    requestId?: string
    memo?: string
    metadata?: Record<string, unknown>
  }): Promise<TokenProcessResult> {
    const { token, eventId, requestId, memo, metadata } = params

    // Validate format
    if (!token.startsWith('cashu')) {
      return { success: false, error: 'Invalid token format' }
    }

    // Decode
    let mintUrl: string
    let totalAmount: number
    try {
      const decoded = this.tokenDecoder.decode(token)
      mintUrl = decoded.mint
      const proofs = decoded.proofs
      if (!proofs || proofs.length === 0) {
        return { success: false, error: 'No proofs in token' }
      }
      totalAmount = proofs.reduce((sum, p) => sum + p.amount, 0)
    } catch {
      return { success: false, error: 'Token decode failed' }
    }

    try {
      // Redeem (deterministic txId for idempotency)
      const txRecordId = `tx-gw-${eventId}`
      const redeemResult = await this.payment.redeem({
        adapterId: 'cashu:ecash',
        input: token,
        transactionId: txRecordId,
      })

      if (!redeemResult.ok) {
        throw new Error(redeemResult.error.message)
      }

      const receivedAmount = toNumber(redeemResult.value.amount)

      // Mark processed
      await this.processedEventStore.save({
        eventId,
        txId: txRecordId,
        processedAt: Date.now(),
        result: 'success',
      })

      return { success: true, amount: receivedAmount, mintUrl }
    } catch (error) {
      const errorMsg = String(error)
      const isAlreadySpent = errorMsg.toLowerCase().includes('already spent')

      if (isAlreadySpent) {
        // Crash recovery: token was claimed but event not marked
        const txRecordId = `tx-gw-${eventId}`
        try {
          const existingTx = await this.txRepo.getById(txRecordId)
          if (!existingTx) {
            await this.txRepo.save({
              id: txRecordId,
              direction: 'receive',
              method: 'cashu:ecash',
              protocol: 'cashu-token',
              amount: sat(totalAmount),
              accountId: mintUrl,
              status: 'settled',
              outcome: 'claimed',
              createdAt: Date.now(),
              completedAt: Date.now(),
              memo,
              metadata: {
                ...(metadata ?? {}),
                token,
                source: requestId ? 'nut18' : 'nostr-dm',
              },
            })
          }
        } catch {
          // Token decode failed - skip
        }

        await this.processedEventStore.save({
          eventId,
          txId: txRecordId,
          processedAt: Date.now(),
          result: 'skipped',
        })

        return { success: false, amount: totalAmount, mintUrl, reason: 'spent' }
      }

      // Real failure — add to retry queue
      try {
        await this.processedEventStore.save({
          eventId,
          txId: `tx-gw-${eventId}`,
          processedAt: Date.now(),
          result: 'failed',
          error: errorMsg,
        })

        await this.failedIncomingStore.save({
          id: `fs-${crypto.randomUUID()}`,
          payload: token,
          accountId: mintUrl,
          amount: totalAmount,
          error: errorMsg,
          errorCode: 'SWAP_FAILED',
          isRetryable: true,
          attemptCount: 1,
          lastAttemptAt: Date.now(),
          createdAt: Date.now(),
          externalId: eventId,
          txId: `tx-gw-${eventId}`,
        })
      } catch (queueError) {
        console.error('[TokenProcessor] Failed to add to retry queue:', queueError)
      }

      return { success: false, error: errorMsg, mintUrl, reason: 'failed' }
    }
  }

  async sendDeliveryAck(recipientPubkey: string, txId: string, relays: string[]): Promise<void> {
    const ackContent = JSON.stringify({ type: 'delivery_ack', txId })
    await this.nostrGateway.sendPrivateDirectMessage({
      recipientPubkey,
      content: ackContent,
      relays,
    })
  }

  async isEventProcessed(eventId: string): Promise<boolean> {
    return this.processedEventStore.exists(eventId)
  }

  async isEventProcessedByTxId(txId: string): Promise<boolean> {
    return this.processedEventStore.existsByTxId(txId)
  }

  async markEventProcessed(event: ProcessedEvent): Promise<void> {
    await this.processedEventStore.save(event)
  }

  async saveFailedIncoming(item: FailedIncoming): Promise<void> {
    await this.failedIncomingStore.save(item)
  }
}
