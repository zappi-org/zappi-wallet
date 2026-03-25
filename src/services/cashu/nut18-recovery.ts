/**
 * NUT-18 HTTP Transport Recovery Service
 *
 * Recovers payments sent via HTTP POST transport when the user
 * left ReceiveQRStep before payment arrived.
 *
 * Called once per recoverAll() (app start, foreground, manual refresh).
 * No continuous polling — single GET check per pending record.
 *
 * Source of truth: ReceiveRequest table (status='pending' + httpEndpoint present).
 */

import { useAppStore } from '@/store'
import { receiveP2PKToken } from '@/coco'
import { getEncodedToken, type Proof } from '@cashu/cashu-ts'
import { getPendingHttpReceiveRequests, completeReceiveRequest } from '@/services/receive-request'

const REQUEST_TIMEOUT_MS = 8000

interface PaymentRequestPayload {
  id?: string
  memo?: string
  mint: string
  unit: string
  proofs: Proof[]
}

export async function recoverPendingEcashReceives(): Promise<{ recovered: number }> {
  const activeRequestId = useAppStore.getState().pendingEcashRequestId
  const p2pkPrivkey = useAppStore.getState().nostrPrivkey

  if (!p2pkPrivkey) {
    console.log('[NUT18-Recovery] Privkey not available, deferring')
    return { recovered: 0 }
  }

  const pending = await getPendingHttpReceiveRequests()
  const eligible = pending.filter((r) => r.ecashRequestId !== activeRequestId)

  if (eligible.length === 0) return { recovered: 0 }

  const results = await Promise.allSettled(
    eligible.map(async (record) => {
      const controller = new AbortController()
      const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)

      try {
        const response = await fetch(record.httpEndpoint!, {
          method: 'GET',
          headers: { 'Accept': 'application/json' },
          signal: controller.signal,
        })
        clearTimeout(timeout)

        if (response.status === 404) return false
        if (!response.ok) return false

        const payload = await response.json() as PaymentRequestPayload
        if (!payload.proofs?.length || !payload.mint) return false

        const token = getEncodedToken({ mint: payload.mint, proofs: payload.proofs })
        await receiveP2PKToken(token, p2pkPrivkey)
        await completeReceiveRequest(record.id, 'ecash')
        console.log(`[NUT18-Recovery] Recovered ${record.amount} sats: ${record.ecashRequestId}`)
        return true
      } catch (err) {
        clearTimeout(timeout)
        const msg = String(err).toLowerCase()
        if (msg.includes('spent') || msg.includes('already')) {
          // Already received via another path → mark completed
          await completeReceiveRequest(record.id, 'ecash')
        } else if (err instanceof Error && err.name === 'AbortError') {
          // Timeout → retry next time
        } else {
          console.warn(`[NUT18-Recovery] Check failed for ${record.ecashRequestId}:`, err)
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
