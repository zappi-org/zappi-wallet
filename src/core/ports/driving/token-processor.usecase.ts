import type { FailedSwap, ProcessedEvent } from '@/core/types'

export interface TokenProcessResult {
  success: boolean
  amount?: number
  mintUrl?: string
  error?: string
  /** 'spent' = already claimed (crash recovery) */
  reason?: 'spent' | 'failed'
}

export interface TokenProcessorUseCase {
  /** 토큰 수신 처리 (redeem + 이벤트 기록). store 변경 없이 결과만 반환. */
  processToken(params: {
    token: string
    eventId: string
    sender: string
    requestId?: string
    memo?: string
    metadata?: Record<string, unknown>
  }): Promise<TokenProcessResult>

  /** POS 디바이스에 delivery ACK 전송 */
  sendDeliveryAck(recipientPubkey: string, txId: string, relays: string[]): Promise<void>

  /** 이벤트 중복 처리 확인 (eventId 기준) */
  isEventProcessed(eventId: string): Promise<boolean>

  /** 이벤트 중복 처리 확인 (txId 기준) */
  isEventProcessedByTxId(txId: string): Promise<boolean>

  /** 이벤트 처리 완료 기록 */
  markEventProcessed(event: ProcessedEvent): Promise<void>

  /** 실패한 스왑을 retry queue에 저장 */
  saveFailedSwap(swap: FailedSwap): Promise<void>
}
