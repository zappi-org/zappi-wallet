/**
 * NostrPaymentTransport — OutgoingPaymentTransport 어댑터
 *
 * NUT-18 payload 빌드 + 릴레이 탐색 + NIP-17 gift wrap 전송을 캡슐화.
 * nostr-dm.ts의 모든 기능을 흡수하여 대체한다.
 */

import type { NostrGateway } from '@/core/ports/driven/nostr-gateway.port'
import { normalizePubkey } from './internal/nostr-crypto'
import type {
  OutgoingPaymentTransport,
  OutgoingPaymentParams,
  OutgoingPaymentResult,
} from '@/core/ports/driven/outgoing-payment-transport.port'
import {
  buildPaymentPayload,
  serializePaymentPayload,
  type CashuProof,
} from '@/core/domain/cashu-payment-payload'

export class NostrPaymentTransport implements OutgoingPaymentTransport {
  constructor(private readonly nostrGateway: NostrGateway) {}

  async send(params: OutgoingPaymentParams): Promise<OutgoingPaymentResult> {
    const { recipientPubkey, token, memo, requestId } = params

    try {
      const recipientHex = normalizePubkey(recipientPubkey)
      if (!recipientHex) {
        return { success: false, error: 'Invalid recipient public key' }
      }

      const relays = await this.resolveRelays(recipientPubkey)
      if (relays.length === 0) {
        return { success: false, error: 'No relays available' }
      }

      const content = await buildContent(token, memo, requestId)

      await this.nostrGateway.sendGiftWrap({
        recipientPubkey: recipientHex,
        content,
        relays,
      })

      return { success: true }
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error)
      console.error('[NostrPaymentTransport] send failed:', error)
      return { success: false, error: errorMsg }
    }
  }

  /**
   * 수신자 DM 릴레이 탐색
   * kind:10050 (DM Relay List)만 실제 전송 릴레이로 사용한다.
   * nprofile relay hint나 로컬 기본 릴레이는 최신 수신 릴레이 보장이 없으므로 fallback하지 않는다.
   */
  private async resolveRelays(recipientPubkey: string): Promise<string[]> {
    const recipientHex = normalizePubkey(recipientPubkey)
    if (recipientHex) {
      try {
        const events = await this.nostrGateway.queryEvents([
          { kinds: [10050], authors: [recipientHex], limit: 1 },
        ])

        if (events.length > 0) {
          const dmRelays = events[0].tags
            .filter((tag: string[]) => tag[0] === 'relay' && tag[1])
            .map((tag: string[]) => tag[1])

          if (dmRelays.length > 0) {
            return dmRelays
          }
        }
      } catch (err) {
        console.warn('[NostrPaymentTransport] kind:10050 lookup failed:', err)
      }
    }

    return []
  }
}

// ─── Pure helpers ───

async function buildContent(
  token: string,
  memo?: string,
  requestId?: string,
): Promise<string> {
  try {
    const { getDecodedToken } = await import('@cashu/cashu-ts')
    const decoded = getDecodedToken(token)

    const payload = buildPaymentPayload({
      mint: decoded.mint,
      unit: decoded.unit || 'sat',
      proofs: decoded.proofs as CashuProof[],
      id: requestId,
      memo: memo || decoded.memo,
    })
    return serializePaymentPayload(payload)
  } catch (err) {
    console.warn(
      '[NostrPaymentTransport] Failed to build NUT-18 payload, sending raw token:',
      err,
    )
    return token
  }
}
