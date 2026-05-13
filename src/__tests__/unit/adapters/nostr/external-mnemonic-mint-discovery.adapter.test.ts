import { describe, expect, it, vi } from 'vitest'
import { sha256 } from '@noble/hashes/sha2.js'
import { bytesToHex } from '@noble/hashes/utils.js'
import type { NostrEvent } from '@/core/domain/nostr'
import type { NostrGateway } from '@/core/ports/driven/nostr-gateway.port'
import { KeyManagerAdapter } from '@/adapters/crypto/key-manager.adapter'
import { NostrExternalMnemonicMintDiscoveryAdapter } from '@/adapters/nostr/external-mnemonic-mint-discovery.adapter'
import {
  derivePublicKey,
  encrypt,
  getConversationKey,
  signEvent,
} from '@/adapters/nostr/internal/nostr-crypto'

const MNEMONIC = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about'

function createGateway(events: NostrEvent[][]): NostrGateway {
  return {
    connect: vi.fn().mockResolvedValue(undefined),
    disconnect: vi.fn().mockResolvedValue(undefined),
    getRelayStatus: vi.fn().mockReturnValue([]),
    publish: vi.fn(),
    queryEvents: vi.fn()
      .mockResolvedValueOnce(events[0])
      .mockResolvedValueOnce(events[1]),
    subscribe: vi.fn().mockReturnValue(() => {}),
    sendPrivateDirectMessage: vi.fn(),
    sendGiftWrap: vi.fn(),
    fetchGiftWraps: vi.fn(),
    subscribeGiftWraps: vi.fn().mockReturnValue(() => {}),
  } as unknown as NostrGateway
}

function createPublicProfileEvent(): NostrEvent {
  const keyManager = new KeyManagerAdapter()
  const keyPair = keyManager.deriveNostrKeyPair(MNEMONIC)

  return signEvent({
    pubkey: keyPair.publicKey,
    kind: 10019,
    created_at: 123,
    content: '',
    tags: [
      ['mint', 'https://profile.mint/'],
      ['mint', 'https://sat-only.mint', 'sat'],
      ['mint', 'https://usd.mint', 'usd'],
    ],
  }, keyPair.privateKey)
}

function createBackupEvent(): NostrEvent {
  const keyManager = new KeyManagerAdapter()
  const seed = keyManager.deriveBip39Seed(MNEMONIC)
  const separator = new TextEncoder().encode('cashu-mint-backup')
  const combined = new Uint8Array(seed.length + separator.length)
  combined.set(seed)
  combined.set(separator, seed.length)
  const privateKeyHex = bytesToHex(sha256(combined))
  const publicKeyHex = derivePublicKey(privateKeyHex)
  const conversationKey = getConversationKey(privateKeyHex, publicKeyHex)
  const encryptedContent = encrypt(JSON.stringify({
    mints: ['https://backup.mint/', 'backup-no-protocol.mint'],
    timestamp: 456,
  }), conversationKey)

  return signEvent({
    pubkey: publicKeyHex,
    kind: 30078,
    created_at: 456,
    content: encryptedContent,
    tags: [['d', 'mint-list']],
  }, privateKeyHex)
}

describe('NostrExternalMnemonicMintDiscoveryAdapter', () => {
  it('discovers mints from public profile and encrypted mint-list backup', async () => {
    const gateway = createGateway([[createPublicProfileEvent()], [createBackupEvent()]])
    const adapter = new NostrExternalMnemonicMintDiscoveryAdapter(
      gateway,
      new KeyManagerAdapter(),
      { getDiscoveryRelays: () => ['wss://relay.example/', 'wss://relay.example'] },
    )

    const result = await adapter.discoverMintUrls({ mnemonic: MNEMONIC })

    expect(gateway.connect).toHaveBeenCalledWith(['wss://relay.example'])
    expect(gateway.queryEvents).toHaveBeenCalledTimes(2)
    expect(result.mintUrls).toEqual([
      'https://profile.mint',
      'https://sat-only.mint',
      'https://backup.mint',
      'https://backup-no-protocol.mint',
    ])
    expect(result.discoveredMints.map((mint) => mint.source)).toEqual([
      'public-profile',
      'public-profile',
      'encrypted-backup',
      'encrypted-backup',
    ])
    expect(result.failedSources).toEqual([])
  })
})
