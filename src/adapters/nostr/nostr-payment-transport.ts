/**
 * NostrPaymentTransport — OutgoingPaymentTransport 어댑터
 *
 * NUT-18 payload 빌드 + 릴레이 탐색 + NIP-17 gift wrap 전송을 캡슐화.
 * nostr-dm.ts의 모든 기능을 흡수하여 대체한다.
 */

import type { NostrGateway } from '@/core/ports/driven/nostr-gateway.port'
import { extractRelaysFromNprofile, normalizePubkey } from './internal/nostr-crypto'
import { relayIdentity } from './internal/nostr-relay'
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
   * Resolves the recipient's inbox relays.
   *
   * kind:10050 (DM Relay List) stays authoritative and goes first, but a payee
   * who publishes no 10050 can only be reached through the relay hints inside
   * the nprofile they handed us — treating 10050 as the only source made those
   * requests undeliverable while the funds were already committed.
   * Local default relays remain excluded: they carry no delivery guarantee.
   */
  private async resolveRelays(recipientPubkey: string): Promise<string[]> {
    const dmRelays = await this.queryDmRelayList(recipientPubkey)
    const hintedRelays = extractRelaysFromNprofile(recipientPubkey)
    return dedupeRelays([...dmRelays, ...hintedRelays])
  }

  private async queryDmRelayList(recipientPubkey: string): Promise<string[]> {
    const recipientHex = normalizePubkey(recipientPubkey)
    if (!recipientHex) return []

    try {
      const events = await this.nostrGateway.queryEvents([
        { kinds: [10050], authors: [recipientHex], limit: 1 },
      ])
      if (events.length === 0) return []

      return events[0].tags
        .filter((tag: string[]) => tag[0] === 'relay' && tag[1])
        .map((tag: string[]) => tag[1])
    } catch (err) {
      console.warn('[NostrPaymentTransport] kind:10050 lookup failed:', err)
      return []
    }
  }
}

// ─── Pure helpers ───

/**
 * Merges relay lists without duplicating a relay spelled two ways.
 * Identity comes from the same normalizer the pool uses, but the first spelling
 * is what gets published — normalizing the emitted URL would silently rewrite
 * the recipient's own 10050 entries.
 */
function dedupeRelays(relays: string[]): string[] {
  const seen = new Set<string>()
  const merged: string[] = []

  for (const relay of relays) {
    const trimmed = relay.trim()
    if (!trimmed) continue
    const identity = relayIdentity(trimmed)
    if (seen.has(identity)) continue
    seen.add(identity)
    merged.push(trimmed)
  }

  return merged
}

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
