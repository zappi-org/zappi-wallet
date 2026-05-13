import { sha256 } from '@noble/hashes/sha2.js'
import { bytesToHex } from '@noble/hashes/utils.js'
import type { NostrEvent } from '@/core/domain/nostr'
import { parseNutZapInfo } from '@/core/domain/nutzap'
import { NOSTR_KINDS } from '@/core/constants'
import type { ExternalMnemonicMintDiscoveryPort } from '@/core/ports/driven/external-mnemonic-mint-discovery.port'
import type {
  DiscoveredExternalMint,
  ExternalMnemonicMintDiscoveryResult,
  ExternalMnemonicMintDiscoverySource,
} from '@/core/ports/driven/external-mnemonic-mint-discovery.port'
import type { KeyManager } from '@/core/ports/driven/key-manager.port'
import type { NostrGateway } from '@/core/ports/driven/nostr-gateway.port'
import {
  decrypt,
  derivePublicKey,
  getConversationKey,
  verifyEventSignature,
} from './internal/nostr-crypto'

// Interop domain separator used by Cashu.me/Macadamia for Nostr mint-list backups.
const MINT_BACKUP_DOMAIN_SEPARATOR = 'cashu-mint-backup'
const MINT_BACKUP_IDENTIFIER = 'mint-list'

interface BackupPayload {
  mints?: unknown
  timestamp?: unknown
}

export interface NostrExternalMnemonicMintDiscoveryOptions {
  getDiscoveryRelays: () => string[]
}

export class NostrExternalMnemonicMintDiscoveryAdapter implements ExternalMnemonicMintDiscoveryPort {
  constructor(
    private readonly nostrGateway: NostrGateway,
    private readonly keyManager: KeyManager,
    private readonly options: NostrExternalMnemonicMintDiscoveryOptions,
  ) {}

  async discoverMintUrls(params: { mnemonic: string }): Promise<ExternalMnemonicMintDiscoveryResult> {
    const mnemonic = normalizeMnemonic(params.mnemonic)
    if (!this.keyManager.validateMnemonic(mnemonic)) {
      throw new Error('Invalid mnemonic')
    }

    const failedSources: ExternalMnemonicMintDiscoveryResult['failedSources'] = []
    const discoveredMints: DiscoveredExternalMint[] = []
    const relays = unique(this.options.getDiscoveryRelays().map(normalizeRelayHint).filter(Boolean))

    if (relays.length > 0) {
      try {
        await this.nostrGateway.connect(relays)
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        failedSources.push({ source: 'public-profile', error: message })
        failedSources.push({ source: 'encrypted-backup', error: message })
      }
    }

    const nostrKeyPair = this.keyManager.deriveNostrKeyPair(mnemonic)
    const backupKeyPair = deriveMintBackupKeyPair(this.keyManager.deriveBip39Seed(mnemonic))

    await this.collectPublicProfileMints(nostrKeyPair.publicKey, discoveredMints, failedSources)
    await this.collectEncryptedBackupMints(backupKeyPair, discoveredMints, failedSources)

    const mintUrls = unique(discoveredMints.map((mint) => mint.mintUrl))

    return {
      mintUrls,
      discoveredMints,
      failedSources,
    }
  }

  private async collectPublicProfileMints(
    pubkey: string,
    discoveredMints: DiscoveredExternalMint[],
    failedSources: { source: ExternalMnemonicMintDiscoverySource; error: string }[],
  ): Promise<void> {
    try {
      const events = await this.nostrGateway.queryEvents([
        { kinds: [NOSTR_KINDS.NUTZAP_INFO], authors: [pubkey], limit: 3 },
      ])
      for (const event of newestValidEvents(events, pubkey, NOSTR_KINDS.NUTZAP_INFO)) {
        const info = parseNutZapInfo(event)
        for (const mintUrl of info.mints) {
          const normalized = normalizeMintUrl(mintUrl)
          if (!normalized) continue
          discoveredMints.push({
            mintUrl: normalized,
            source: 'public-profile',
            createdAt: event.created_at,
          })
        }
      }
    } catch (error) {
      failedSources.push({
        source: 'public-profile',
        error: error instanceof Error ? error.message : String(error),
      })
    }
  }

  private async collectEncryptedBackupMints(
    keyPair: { privateKeyHex: string; publicKeyHex: string },
    discoveredMints: DiscoveredExternalMint[],
    failedSources: { source: ExternalMnemonicMintDiscoverySource; error: string }[],
  ): Promise<void> {
    try {
      const events = await this.nostrGateway.queryEvents([
        {
          kinds: [NOSTR_KINDS.PARAMETERIZED_REPLACEABLE],
          authors: [keyPair.publicKeyHex],
          '#d': [MINT_BACKUP_IDENTIFIER],
          limit: 10,
        },
      ])
      const conversationKey = getConversationKey(keyPair.privateKeyHex, keyPair.publicKeyHex)

      for (const event of newestValidEvents(events, keyPair.publicKeyHex, NOSTR_KINDS.PARAMETERIZED_REPLACEABLE)) {
        try {
          const decrypted = decrypt(event.content, conversationKey)
          const payload = parseMintBackupPayload(decrypted)
          for (const mintUrl of payload.mintUrls) {
            discoveredMints.push({
              mintUrl,
              source: 'encrypted-backup',
              createdAt: payload.timestamp ?? event.created_at,
            })
          }
        } catch {
          // Ignore individual stale/corrupt backup events; other relays may have a valid one.
        }
      }
    } catch (error) {
      failedSources.push({
        source: 'encrypted-backup',
        error: error instanceof Error ? error.message : String(error),
      })
    }
  }
}

function deriveMintBackupKeyPair(seed: Uint8Array): { privateKeyHex: string; publicKeyHex: string } {
  const separator = new TextEncoder().encode(MINT_BACKUP_DOMAIN_SEPARATOR)
  const combined = new Uint8Array(seed.length + separator.length)
  combined.set(seed)
  combined.set(separator, seed.length)

  const privateKeyHex = bytesToHex(sha256(combined))
  return {
    privateKeyHex,
    publicKeyHex: derivePublicKey(privateKeyHex),
  }
}

function normalizeMnemonic(mnemonic: string): string {
  return mnemonic.trim().toLowerCase().split(/\s+/).join(' ')
}

function parseMintBackupPayload(content: string): { mintUrls: string[]; timestamp?: number } {
  const parsed = JSON.parse(content) as BackupPayload | unknown[]
  const rawMints = Array.isArray(parsed) ? parsed : parsed.mints
  const timestamp = !Array.isArray(parsed) && typeof parsed.timestamp === 'number'
    ? parsed.timestamp
    : undefined

  if (!Array.isArray(rawMints)) {
    return { mintUrls: [], timestamp }
  }

  return {
    mintUrls: unique(rawMints
      .filter((mintUrl): mintUrl is string => typeof mintUrl === 'string')
      .map(normalizeMintUrl)
      .filter((mintUrl): mintUrl is string => Boolean(mintUrl))),
    timestamp,
  }
}

function newestValidEvents(events: NostrEvent[], author: string, kind: number): NostrEvent[] {
  return events
    .filter((event) => event.pubkey === author && event.kind === kind && verifyEventSignature(event))
    .sort((a, b) => b.created_at - a.created_at)
}

function normalizeMintUrl(mintUrl: string): string | null {
  const withProtocol = /^[a-z]+:\/\//i.test(mintUrl.trim())
    ? mintUrl.trim()
    : `https://${mintUrl.trim()}`
  try {
    const url = new URL(withProtocol)
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return null
    return url.toString().replace(/\/+$/, '')
  } catch {
    return null
  }
}

function normalizeRelayHint(relay: string): string {
  return relay.trim().replace(/\/+$/, '')
}

function unique(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))]
}
