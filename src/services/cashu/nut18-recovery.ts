/**
 * NUT-18 HTTP Transport Recovery Service
 *
 * Recovers payments sent via HTTP POST transport when the user
 * left ReceiveQRStep before payment arrived.
 *
 * Called once per recoverAll() (app start, foreground, manual refresh).
 * No continuous polling — single GET check per pending record.
 */

import { getDatabase } from '@/data/database/schema'
import { useAppStore } from '@/store'
import { receiveP2PKToken } from '@/coco'
import { getEncodedToken, type Proof } from '@cashu/cashu-ts'

const REQUEST_TIMEOUT_MS = 8000

interface PaymentRequestPayload {
  id?: string
  memo?: string
  mint: string
  unit: string
  proofs: Proof[]
}

export async function recoverPendingEcashReceives(): Promise<{ recovered: number }> {
  const db = getDatabase()
  const pending = await db.pendingEcashReceives.toArray()

  if (pending.length === 0) return { recovered: 0 }

  // Skip requests currently being polled by ReceiveQRStep
  const activeRequestId = useAppStore.getState().pendingEcashRequestId
  const p2pkPrivkey = useAppStore.getState().nostrPrivkey

  const eligible = pending.filter((r) => r.requestId !== activeRequestId)
  if (eligible.length === 0) return { recovered: 0 }

  if (!p2pkPrivkey) {
    // Wallet not unlocked yet → preserve all records for next recovery attempt
    console.log('[NUT18-Recovery] Privkey not available, deferring all records')
    return { recovered: 0 }
  }

  const results = await Promise.allSettled(
    eligible.map(async (record) => {
      const controller = new AbortController()
      const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)

      try {
        const response = await fetch(record.httpEndpoint, {
          method: 'GET',
          headers: { 'Accept': 'application/json' },
          signal: controller.signal,
        })
        clearTimeout(timeout)

        // 404 = mint has no data (not paid or already consumed) → cleanup
        if (response.status === 404) {
          await db.pendingEcashReceives.delete(record.requestId)
          return false
        }

        if (!response.ok) return false // transient server error → retry next time

        const payload = await response.json() as PaymentRequestPayload
        if (!payload.proofs?.length || !payload.mint) return false

        // Receive the token (requires P2PK privkey to unlock)
        const token = getEncodedToken({ mint: payload.mint, proofs: payload.proofs })
        await receiveP2PKToken(token, p2pkPrivkey)
        await db.pendingEcashReceives.delete(record.requestId)
        console.log(`[NUT18-Recovery] Recovered ${record.amount} sats from HTTP: ${record.requestId}`)
        return true
      } catch (err) {
        clearTimeout(timeout)
        const msg = String(err).toLowerCase()
        if (msg.includes('spent') || msg.includes('already')) {
          // Already received via Nostr → cleanup
          await db.pendingEcashReceives.delete(record.requestId)
        } else if (err instanceof Error && err.name === 'AbortError') {
          // Timeout → retry next time
        } else {
          console.warn(`[NUT18-Recovery] Check failed for ${record.requestId}:`, err)
        }
        return false
      }
    })
  )

  const recovered = results.filter((r) => r.status === 'fulfilled' && r.value === true).length

  if (recovered > 0) {
    useAppStore.getState().triggerTxRefresh()
  }

  return { recovered }
}
