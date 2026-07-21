import { describe, expect, it, vi } from 'vitest'
import type { AddressResolverUseCase } from '@/core/ports/driving/address-resolver.usecase'
import { isNostrDirectAddress } from '@/core/domain/nostr-address'
import { NostrDirectPaymentService } from '@/core/services/nostr-direct-payment.service'

function makeResolver(directToken?: { mints: string[]; p2pkPubkey?: string; dmRelays?: string[] }): AddressResolverUseCase {
  return {
    resolve: vi.fn().mockResolvedValue({
      address: 'npub1recipient',
      type: 'npub',
      pubkey: 'recipient-pubkey',
      capabilities: directToken ? { directToken } : {},
    }),
  }
}

describe('nostrDirectPayment', () => {
  it('detects npub and nprofile inputs', () => {
    expect(isNostrDirectAddress('npub1abc')).toBe(true)
    expect(isNostrDirectAddress('nprofile1abc')).toBe(true)
    expect(isNostrDirectAddress('alice@example.com')).toBe(false)
  })

  it('rejects lightning addresses with npub usernames', () => {
    expect(isNostrDirectAddress('npub1abc@example.com')).toBe(false)
    expect(isNostrDirectAddress('npub1abc@127.0.0.1:8000')).toBe(false)
    expect(isNostrDirectAddress('nprofile1abc@example.com')).toBe(false)
  })

  it('returns ready when selected mint is shared and relay info exists', async () => {
    const service = new NostrDirectPaymentService(makeResolver({
      mints: ['https://mint-b.test'],
      p2pkPubkey: '02abc',
      dmRelays: ['wss://relay.test'],
    }))

    const result = await service.resolve({
      address: 'npub1recipient',
      ownMintUrls: ['https://mint-a.test', 'https://mint-b.test'],
      selectedMintUrl: 'https://mint-b.test',
    })

    expect(result.status).toBe('ready')
    if (result.status !== 'ready') throw new Error('expected ready')
    expect(result.selectedMintUrl).toBe('https://mint-b.test')
    expect(result.validatedData.parsed.sameMintOnly).toBe(true)
    expect(result.validatedData.parsed.p2pkPubkey).toBe('02abc')
  })

  it('requires explicit mint selection when selected mint is not shared', async () => {
    const service = new NostrDirectPaymentService(makeResolver({
      mints: ['https://mint-b.test'],
      dmRelays: ['wss://relay.test'],
    }))

    const result = await service.resolve({
      address: 'npub1recipient',
      ownMintUrls: ['https://mint-a.test', 'https://mint-b.test'],
      selectedMintUrl: 'https://mint-a.test',
    })

    expect(result.status).toBe('needs-mint-selection')
    if (result.status !== 'needs-mint-selection') throw new Error('expected needs-mint-selection')
    expect(result.commonMintUrls).toEqual(['https://mint-b.test'])
    expect(result.validatedData.parsed.p2pkPubkey).toBeUndefined()
  })

  it('fails when recipient has no shared mint', async () => {
    const service = new NostrDirectPaymentService(makeResolver({
      mints: ['https://mint-b.test'],
      dmRelays: ['wss://relay.test'],
    }))

    const result = await service.resolve({
      address: 'npub1recipient',
      ownMintUrls: ['https://mint-a.test'],
      selectedMintUrl: 'https://mint-a.test',
    })

    expect(result.status).toBe('no-common-mint')
  })

  it('fails when recipient has no kind:10050 relay info', async () => {
    const service = new NostrDirectPaymentService(makeResolver({
      mints: ['https://mint-a.test'],
    }))

    const result = await service.resolve({
      address: 'npub1recipient',
      ownMintUrls: ['https://mint-a.test'],
      selectedMintUrl: 'https://mint-a.test',
    })

    expect(result.status).toBe('no-relay')
  })
})
