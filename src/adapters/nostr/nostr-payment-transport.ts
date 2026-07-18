/**
 * NostrPaymentTransport — OutgoingPaymentTransport 어댑터
 *
 * NUT-18 payload 빌드 + 릴레이 탐색 + NIP-17 gift wrap 전송을 캡슐화.
 * nostr-dm.ts의 모든 기능을 흡수하여 대체한다.
 */

import type { NostrGateway } from '@/core/ports/driven/nostr-gateway.port'
import { normalizePubkey, extractRelaysFromNprofile } from './internal/nostr-crypto'
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

export type PaymentTokenDecoder = (token: string) => Promise<{
  mint: string
  unit?: string
  proofs: CashuProof[]
  memo?: string
}>

export class NostrPaymentTransport implements OutgoingPaymentTransport {
  constructor(
    private readonly nostrGateway: NostrGateway,
    private readonly decodeToken: PaymentTokenDecoder,
  ) {}

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

      const content = await buildContent(token, this.decodeToken, memo, requestId)

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
   * 수신자 DM 릴레이 탐색 — 3-tier fallback:
   * 1. nprofile relay hint (NIP-19 nprofile에 인코딩된 relays)
   * 2. kind:10050 DM Relay List
   * 3. 로컬 연결된 릴레이 (getRelayStatus)
   */
  private async resolveRelays(recipientPubkey: string): Promise<string[]> {
    const recipientHex = normalizePubkey(recipientPubkey)

    // ── 1. nprofile relay hints ──
    const nprofileRelays = extractRelaysFromNprofile(recipientPubkey)
    if (nprofileRelays.length > 0) {
      return nprofileRelays
    }

    // ── 2. kind:10050 DM Relay List ──
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

    // ── 3. local connected relays ──
    const localRelays = this.nostrGateway
      .getRelayStatus()
      .filter((r) => r.connected)
      .map((r) => r.url)

    if (localRelays.length > 0) {
      return localRelays
    }

    return []
  }
}

// ─── Pure helpers ───

async function buildContent(
  token: string,
  decodeToken: PaymentTokenDecoder,
  memo?: string,
  requestId?: string,
): Promise<string> {
  try {
    const decoded = await decodeToken(token)

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
