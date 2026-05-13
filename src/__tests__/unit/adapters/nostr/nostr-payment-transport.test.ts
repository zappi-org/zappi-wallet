import { describe, expect, it, vi } from 'vitest'
import { NostrPaymentTransport } from '@/adapters/nostr/nostr-payment-transport'
import type { NostrGateway } from '@/core/ports/driven/nostr-gateway.port'

vi.mock('@cashu/cashu-ts', () => ({
  getDecodedToken: () => ({
    mint: 'https://mint.test',
    unit: 'sat',
    proofs: [],
  }),
}))

const RECIPIENT_HEX = 'a'.repeat(64)

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
  it('sends only to recipient kind:10050 DM relays', async () => {
    const gateway = makeGateway([
      { kind: 10050, tags: [['relay', 'wss://dm1.test'], ['relay', 'wss://dm2.test']] },
    ])
    const transport = new NostrPaymentTransport(gateway)

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
  })

  it('does not fallback to default relays when kind:10050 is missing', async () => {
    const gateway = makeGateway([])
    const transport = new NostrPaymentTransport(gateway)

    const result = await transport.send({
      recipientPubkey: RECIPIENT_HEX,
      token: 'cashuAinvalid-test-token',
    })

    expect(result).toEqual({ success: false, error: 'No relays available' })
    expect(gateway.sendGiftWrap).not.toHaveBeenCalled()
  })
})
