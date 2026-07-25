import { describe, expect, it, vi } from 'vitest'
import { nip19 } from 'nostr-tools'
import { NostrPaymentTransport } from '@/adapters/nostr/nostr-payment-transport'
import type { NostrGateway } from '@/core/ports/driven/nostr-gateway.port'

const RECIPIENT_HEX = 'a'.repeat(64)
const decodeToken = vi.fn().mockResolvedValue({
  mint: 'https://mint.test',
  unit: 'sat',
  proofs: [],
})

function nprofile(relays: string[]): string {
  return nip19.nprofileEncode({ pubkey: RECIPIENT_HEX, relays })
}

function makeGateway(events: Array<{ kind: number; tags: string[][] }> = []): NostrGateway {
  return {
    queryEvents: vi.fn().mockResolvedValue(events.map((event, index) => ({
      id: `event-${index}`,
      pubkey: RECIPIENT_HEX,
      created_at: 1,
      kind: event.kind,
      tags: event.tags,
      content: '',
      sig: 'sig',
    }))),
    sendGiftWrap: vi.fn().mockResolvedValue({
      id: 'gift-wrap',
      pubkey: RECIPIENT_HEX,
      created_at: 1,
      kind: 1059,
      tags: [],
      content: '',
      sig: 'sig',
    }),
  } as unknown as NostrGateway
}

describe('NostrPaymentTransport', () => {
  it('sends to the recipient kind:10050 DM relays', async () => {
    decodeToken.mockClear()
    const gateway = makeGateway([
      { kind: 10050, tags: [['relay', 'wss://dm1.test'], ['relay', 'wss://dm2.test']] },
    ])
    const transport = new NostrPaymentTransport(gateway, decodeToken)

    const result = await transport.send({
      recipientPubkey: RECIPIENT_HEX,
      token: 'cashuAinvalid-test-token',
    })

    expect(result.success).toBe(true)
    expect(gateway.queryEvents).toHaveBeenCalledWith([
      { kinds: [10050], authors: [RECIPIENT_HEX], limit: 1 },
    ])
    expect(gateway.sendGiftWrap).toHaveBeenCalledWith(expect.objectContaining({
      recipientPubkey: RECIPIENT_HEX,
      relays: ['wss://dm1.test', 'wss://dm2.test'],
    }))
    expect(decodeToken).toHaveBeenCalledWith('cashuAinvalid-test-token')
  })

  // The money bug: a payee who publishes no 10050 (cashu.me) still names relays
  // in the nprofile. Ignoring them made the send unreachable after the funds
  // were already committed.
  it('falls back to nprofile relay hints when the payee has no kind:10050', async () => {
    decodeToken.mockClear()
    const gateway = makeGateway([])
    const transport = new NostrPaymentTransport(gateway, decodeToken)

    const result = await transport.send({
      recipientPubkey: nprofile(['wss://hint1.test', 'wss://hint2.test']),
      token: 'cashuAinvalid-test-token',
    })

    expect(result.success).toBe(true)
    expect(gateway.sendGiftWrap).toHaveBeenCalledWith(expect.objectContaining({
      recipientPubkey: RECIPIENT_HEX,
      relays: ['wss://hint1.test', 'wss://hint2.test'],
    }))
  })

  it('prefers kind:10050 and appends only the hints it does not already cover', async () => {
    decodeToken.mockClear()
    const gateway = makeGateway([
      { kind: 10050, tags: [['relay', 'wss://dm1.test']] },
    ])
    const transport = new NostrPaymentTransport(gateway, decodeToken)

    // 'wss://dm1.test/' is the same relay spelled differently — it must not
    // be published twice.
    const result = await transport.send({
      recipientPubkey: nprofile(['wss://dm1.test/', 'wss://hint1.test']),
      token: 'cashuAinvalid-test-token',
    })

    expect(result.success).toBe(true)
    expect(gateway.sendGiftWrap).toHaveBeenCalledWith(expect.objectContaining({
      relays: ['wss://dm1.test', 'wss://hint1.test'],
    }))
  })

  it('fails without sending when there is neither a kind:10050 nor a relay hint', async () => {
    decodeToken.mockClear()
    const gateway = makeGateway([])
    const transport = new NostrPaymentTransport(gateway, decodeToken)

    const result = await transport.send({
      recipientPubkey: RECIPIENT_HEX,
      token: 'cashuAinvalid-test-token',
    })

    expect(result).toEqual({ success: false, error: 'No relays available' })
    expect(gateway.sendGiftWrap).not.toHaveBeenCalled()
    expect(decodeToken).not.toHaveBeenCalled()
  })

  it('does not fall back to local default relays for a hint-less nprofile', async () => {
    decodeToken.mockClear()
    const gateway = makeGateway([])
    const transport = new NostrPaymentTransport(gateway, decodeToken)

    const result = await transport.send({
      recipientPubkey: nprofile([]),
      token: 'cashuAinvalid-test-token',
    })

    expect(result).toEqual({ success: false, error: 'No relays available' })
    expect(gateway.sendGiftWrap).not.toHaveBeenCalled()
  })
})
