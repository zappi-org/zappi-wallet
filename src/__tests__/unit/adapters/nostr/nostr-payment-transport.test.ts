import { describe, expect, it, vi } from 'vitest'
import { NostrPaymentTransport } from '@/adapters/nostr/nostr-payment-transport'
import type { NostrGateway } from '@/core/ports/driven/nostr-gateway.port'
import { nip19 } from 'nostr-tools'

const RECIPIENT_HEX = 'a'.repeat(64)
const decodeToken = vi.fn().mockResolvedValue({
  mint: 'https://mint.test',
  unit: 'sat',
  proofs: [],
})

function makeGateway(
  events: Array<{ kind: number; tags: string[][] }> = [],
  localRelays: { url: string; connected: boolean }[] = [],
): NostrGateway {
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
    getRelayStatus: vi.fn().mockReturnValue(localRelays),
  } as unknown as NostrGateway
}

describe('NostrPaymentTransport', () => {
  it('uses kind:10050 DM relays', async () => {
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

  it('falls back to local connected relays when kind:10050 is missing', async () => {
    decodeToken.mockClear()
    const gateway = makeGateway(
      [],
      [
        { url: 'wss://local1.test', connected: true },
        { url: 'wss://local2.test', connected: false },
        { url: 'wss://local3.test', connected: true },
      ],
    )
    const transport = new NostrPaymentTransport(gateway, decodeToken)

    const result = await transport.send({
      recipientPubkey: RECIPIENT_HEX,
      token: 'cashuAinvalid-test-token',
    })

    expect(result.success).toBe(true)
    expect(gateway.sendGiftWrap).toHaveBeenCalledWith(expect.objectContaining({
      recipientPubkey: RECIPIENT_HEX,
      relays: ['wss://local1.test', 'wss://local3.test'],
    }))
    expect(decodeToken).toHaveBeenCalledWith('cashuAinvalid-test-token')
  })

  it('returns No relays available when all sources are exhausted', async () => {
    decodeToken.mockClear()
    const gateway = makeGateway(
      [],
      [
        { url: 'wss://offline.test', connected: false },
      ],
    )
    const transport = new NostrPaymentTransport(gateway, decodeToken)

    const result = await transport.send({
      recipientPubkey: RECIPIENT_HEX,
      token: 'cashuAinvalid-test-token',
    })

    expect(result).toEqual({ success: false, error: 'No relays available' })
    expect(gateway.sendGiftWrap).not.toHaveBeenCalled()
    expect(decodeToken).not.toHaveBeenCalled()
  })

  it('prioritizes nprofile relay hints over kind:10050', async () => {
    decodeToken.mockClear()
    const gateway = makeGateway([
      { kind: 10050, tags: [['relay', 'wss://k10050.test']] },
    ])
    const transport = new NostrPaymentTransport(gateway, decodeToken)

    const nprofile = nip19.nprofileEncode({
      pubkey: RECIPIENT_HEX,
      relays: ['wss://nprofile-hint.test'],
    })

    const result = await transport.send({
      recipientPubkey: nprofile,
      token: 'cashuAinvalid-test-token',
    })

    expect(result.success).toBe(true)
    // uses nprofile relay hints, not kind:10050
    expect(gateway.sendGiftWrap).toHaveBeenCalledWith(expect.objectContaining({
      recipientPubkey: RECIPIENT_HEX,
      relays: ['wss://nprofile-hint.test'],
    }))
    // kind:10050 was NOT queried
    expect(gateway.queryEvents).not.toHaveBeenCalled()
  })
})
