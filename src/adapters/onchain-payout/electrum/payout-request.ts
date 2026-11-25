import { finalizeEvent, generateSecretKey, getPublicKey } from 'nostr-tools/pure'
import type { Event } from 'nostr-tools/core'
import { bytesToHex } from '@noble/hashes/utils.js'
import { decryptMessage, encryptMessage } from './message-crypto'
import type { PayoutOffer } from './offers'
import { REQUEST_KIND } from './offers'
import type { PayoutRelayClient, PayoutRelayEvent } from './relay-client'

const REQUEST_LOOKBACK_SECONDS = 60

export interface RequestPayoutParams {
  client: PayoutRelayClient
  offer: PayoutOffer
  relays: string[]
  invoiceAmount: number
  paymentHash: string
  claimPubkey: string
  timeoutMs: number
  now: number
}

export async function requestPayout(params: RequestPayoutParams): Promise<Record<string, unknown>> {
  const { client, offer, relays, invoiceAmount, paymentHash, claimPubkey, timeoutMs, now } = params

  const secretKey = generateSecretKey()
  const secretHex = bytesToHex(secretKey)
  const ephemeralPubkey = getPublicKey(secretKey)
  const requestRelays = [...new Set([...relays, ...offer.relays])]

  const content = JSON.stringify({
    type: 'reversesubmarine',
    pairId: 'BTC/BTC',
    invoiceAmount,
    preimageHash: paymentHash,
    claimPublicKey: claimPubkey,
    method: 'createswap',
  })

  const event = finalizeEvent(
    {
      kind: REQUEST_KIND,
      created_at: Math.floor(now),
      tags: [['p', offer.pubkey]],
      content: encryptMessage(secretHex, offer.pubkey, content),
    },
    secretKey,
  ) as Event

  return new Promise<Record<string, unknown>>((resolve, reject) => {
    let settled = false
    let unsubscribe = () => {}

    const finish = (action: () => void) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      unsubscribe()
      action()
    }

    const timer = setTimeout(() => {
      finish(() => reject(new Error('payout request timed out')))
    }, timeoutMs)

    const handle = (incoming: PayoutRelayEvent) => {
      if (incoming.pubkey !== offer.pubkey) return
      let body: unknown
      try {
        body = JSON.parse(decryptMessage(secretHex, offer.pubkey, incoming.content))
      } catch {
        return
      }
      if (typeof body !== 'object' || body === null || Array.isArray(body)) return
      const reply = body as Record<string, unknown>
      if (reply.reply_to !== event.id) return
      if ('error' in reply) {
        finish(() => reject(new Error('provider rejected the payout request')))
        return
      }
      finish(() => resolve(reply))
    }

    unsubscribe = client.subscribe(
      requestRelays,
      { kinds: [REQUEST_KIND], '#p': [ephemeralPubkey], since: Math.floor(now) - REQUEST_LOOKBACK_SECONDS },
      handle,
    )

    client.publish(requestRelays, event).catch((error: unknown) => {
      finish(() => reject(error instanceof Error ? error : new Error('payout request publish failed')))
    })
  })
}
