/**
 * Offline Token Recovery
 *
 * 오프라인 수신 P2PK 토큰 저장/복구 로직.
 * DB 직접 의존 없음 — OfflineTokenStore port 경유.
 */

import type { OfflineTokenStore } from '@/core/ports/driven/offline-token-store.port'

/**
 * 저장된 오프라인 토큰 전부 수신 시도.
 * 성공/영구 실패(TOKEN_SPENT 등) → 삭제, 일시 오류 → 재시도용 유지.
 */
export async function redeemPendingReceivedTokens(
  store: OfflineTokenStore,
  receiveToken: (token: string) => Promise<{ amount: number; mintUrl: string }>,
): Promise<{ redeemed: number; failed: number }> {
  const pendingTokens = await store.getAll()

  if (pendingTokens.length === 0) return { redeemed: 0, failed: 0 }

  const idsToDelete: string[] = []
  let redeemed = 0
  let failed = 0

  const results = await Promise.allSettled(
    pendingTokens.map(async (pending) => {
      try {
        await receiveToken(pending.token)
        idsToDelete.push(pending.id)
        console.log(`[OfflineRecovery] Redeemed token ${pending.id}: ${pending.amount} sats`)
        return true
      } catch (error: unknown) {
        const code = (error as { code?: string })?.code
        if (code === 'TOKEN_SPENT' || code === 'INVALID_TOKEN' || code === 'INVALID_PROOF') {
          idsToDelete.push(pending.id)
          console.warn(`[OfflineRecovery] Token ${pending.id} ${code}, removing`)
        } else {
          console.warn(`[OfflineRecovery] Token ${pending.id} transient error, will retry`)
        }
        return false
      }
    })
  )

  for (const r of results) {
    if (r.status === 'fulfilled' && r.value) redeemed++
    else failed++
  }

  if (idsToDelete.length > 0) {
    await store.bulkDelete(idsToDelete)
  }

  return { redeemed, failed }
}

/**
 * 오프라인에서 수신한 토큰을 저장 (온라인 복구용)
 */
export async function storeOfflineToken(
  store: OfflineTokenStore,
  token: string,
  amount: number,
  mintUrl: string,
  dleqStatus: 'valid' | 'missing',
): Promise<string> {
  const id = `pending-recv-${crypto.randomUUID()}`
  await store.put({
    id,
    token,
    mintUrl,
    amount,
    dleqStatus,
    createdAt: Date.now(),
  })
  return id
}
