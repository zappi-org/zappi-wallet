/**
 * OfflineTokenStore — 오프라인 수신 토큰 저장소 port
 *
 * P2PK 토큰을 오프라인에서 수신한 뒤, 온라인 복구 시 일괄 redeem하기 위한 저장소.
 */

export interface PendingReceivedToken {
  id: string
  token: string
  mintUrl: string
  amount: number
}

export interface OfflineTokenStore {
  getAll(): Promise<PendingReceivedToken[]>
  put(record: { id: string; token: string; mintUrl: string; amount: number; dleqStatus: string; createdAt: number }): Promise<void>
  bulkDelete(ids: string[]): Promise<void>
}
