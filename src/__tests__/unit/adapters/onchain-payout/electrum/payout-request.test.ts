import { describe, expect, it } from 'vitest'
import { generateSecretKey, getPublicKey } from 'nostr-tools/pure'
import { bytesToHex } from '@noble/hashes/utils.js'
import { decryptMessage, encryptMessage } from '@/adapters/onchain-payout/electrum/message-crypto'
import { REQUEST_KIND, type PayoutOffer } from '@/adapters/onchain-payout/electrum/offers'
import { requestPayout } from '@/adapters/onchain-payout/electrum/payout-request'
import type { PayoutRelayClient, PayoutRelayEvent } from '@/adapters/onchain-payout/electrum/relay-client'

const now = 1700000000
const paymentHash = 'aa'.repeat(32)
const claimPubkey = '02' + 'bb'.repeat(32)

const serverSecret = generateSecretKey()
const serverPubkey = getPublicKey(serverSecret)
const otherSecret = generateSecretKey()
const otherPubkey = getPublicKey(otherSecret)

const offer: PayoutOffer = {
  pubkey: serverPubkey,
  feePercent: 0.5,
  networkFee: 150,
  minAmount: 20000,
  maxForwardAmount: 5000000,
  maxReverseAmount: 5000000,
  relays: ['wss://offer-relay.example', 'wss://shared-relay.example'],
  powBits: 40,
  createdAt: now,
}

interface FakeState {
  onEvent: ((event: PayoutRelayEvent) => void) | null
  published: PayoutRelayEvent[]
  unsubscribed: boolean
  filter: Record<string, unknown> | null
  relays: string[]
  onPublish: ((event: PayoutRelayEvent) => void) | null
  failPublish: boolean
}

function createFakeClient(): { client: PayoutRelayClient; state: FakeState } {
  const state: FakeState = {
    onEvent: null,
    published: [],
    unsubscribed: false,
    filter: null,
    relays: [],
    onPublish: null,
    failPublish: false,
  }
  const client: PayoutRelayClient = {
    async query() {
      return []
    },
    async publish(_relays, event) {
      state.published.push(event)
      if (state.failPublish) throw new Error('relay refused')
      state.onPublish?.(event)
    },
    subscribe(relays, filter, onEvent) {
      state.relays = relays
      state.filter = filter
      state.onEvent = onEvent
      return () => {
        state.unsubscribed = true
      }
    },
    close() {},
  }
  return { client, state }
}

function replyEvent(
  request: PayoutRelayEvent,
  body: Record<string, unknown>,
  options: { secret?: Uint8Array; pubkey?: string; id?: string } = {},
): PayoutRelayEvent {
  const secret = options.secret ?? serverSecret
  return {
    id: options.id ?? 'reply-1',
    pubkey: options.pubkey ?? serverPubkey,
    kind: REQUEST_KIND,
    created_at: now,
    tags: [['p', request.pubkey]],
    content: encryptMessage(bytesToHex(secret), request.pubkey, JSON.stringify(body)),
    sig: '00',
  }
}

function request(client: PayoutRelayClient, timeoutMs = 1000) {
  return requestPayout({
    client,
    offer,
    relays: ['wss://our-relay.example', 'wss://shared-relay.example'],
    invoiceAmount: 100000,
    paymentHash,
    claimPubkey,
    timeoutMs,
    now,
  })
}

describe('payout request', () => {
  it('publishes an encrypted request and resolves with the reply', async () => {
    const { client, state } = createFakeClient()
    state.onPublish = (event) => {
      state.onEvent?.(replyEvent(event, { reply_to: event.id, invoice: 'lnbcrt1', id: 'server-1' }))
    }

    const response = await request(client)

    expect(response).toMatchObject({ id: 'server-1', invoice: 'lnbcrt1' })
    expect(state.published).toHaveLength(1)
    const published = state.published[0]
    expect(published.kind).toBe(REQUEST_KIND)
    expect(published.tags).toEqual([['p', serverPubkey]])
    expect(published.created_at).toBe(now)
    const body = JSON.parse(
      decryptMessage(bytesToHex(serverSecret), published.pubkey, published.content),
    )
    expect(body).toMatchObject({
      type: 'reversesubmarine',
      pairId: 'BTC/BTC',
      invoiceAmount: 100000,
      preimageHash: paymentHash,
      claimPublicKey: claimPubkey,
      method: 'createswap',
    })
    expect(state.unsubscribed).toBe(true)
  })

  it('subscribes before publishing on the merged relay list', async () => {
    const { client, state } = createFakeClient()
    let subscribedAtPublish = false
    state.onPublish = (event) => {
      subscribedAtPublish = state.onEvent !== null
      state.onEvent?.(replyEvent(event, { reply_to: event.id }))
    }

    await request(client)

    expect(subscribedAtPublish).toBe(true)
    expect(state.relays.sort()).toEqual([
      'wss://offer-relay.example',
      'wss://our-relay.example',
      'wss://shared-relay.example',
    ])
    expect(state.filter).toMatchObject({ kinds: [REQUEST_KIND], since: now - 60 })
    expect((state.filter?.['#p'] as string[])[0]).toHaveLength(64)
  })

  it('uses a fresh ephemeral key per request', async () => {
    const { client, state } = createFakeClient()
    state.onPublish = (event) => {
      state.onEvent?.(replyEvent(event, { reply_to: event.id }))
    }
    await request(client)
    await request(client)
    expect(state.published[0].pubkey).not.toBe(state.published[1].pubkey)
  })

  it('ignores replies from another pubkey', async () => {
    const { client, state } = createFakeClient()
    state.onPublish = (event) => {
      state.onEvent?.(
        replyEvent(event, { reply_to: event.id, invoice: 'evil' }, { secret: otherSecret, pubkey: otherPubkey }),
      )
      state.onEvent?.(replyEvent(event, { reply_to: event.id, invoice: 'good' }))
    }
    await expect(request(client)).resolves.toMatchObject({ invoice: 'good' })
  })

  it('ignores replies for another request', async () => {
    const { client, state } = createFakeClient()
    state.onPublish = (event) => {
      state.onEvent?.(replyEvent(event, { reply_to: 'other-request', invoice: 'wrong' }))
      state.onEvent?.(replyEvent(event, { reply_to: event.id, invoice: 'right' }))
    }
    await expect(request(client)).resolves.toMatchObject({ invoice: 'right' })
  })

  it('rejects when the provider answers with an error', async () => {
    const { client, state } = createFakeClient()
    state.onPublish = (event) => {
      state.onEvent?.(replyEvent(event, { reply_to: event.id, error: 'server text' }))
    }
    await expect(request(client)).rejects.toThrow('provider rejected the payout request')
    expect(state.unsubscribed).toBe(true)
  })

  it('rejects on timeout and unsubscribes', async () => {
    const { client, state } = createFakeClient()
    await expect(request(client, 5)).rejects.toThrow('payout request timed out')
    expect(state.unsubscribed).toBe(true)
  })

  it('rejects when no relay accepts the request', async () => {
    const { client, state } = createFakeClient()
    state.failPublish = true
    await expect(request(client)).rejects.toThrow('relay refused')
    expect(state.unsubscribed).toBe(true)
  })
})
