/**
 * nostr-crypto — nostr-tools 래핑 (순수 로컬 연산)
 *
 * nostr-tools를 직접 import하는 유일한 파일.
 * 바깥에서는 이 함수들의 시그니처만 알고 nostr-tools 존재를 모름.
 */

import { finalizeEvent, verifyEvent, getPublicKey } from 'nostr-tools'
import { nip19, nip17 } from 'nostr-tools'
import * as nip44 from 'nostr-tools/nip44'
import { hexToBytes } from '@noble/hashes/utils.js'
import type { NostrEvent, UnsignedNostrEvent } from '@/core/domain/nostr'

// ─── Event signing / verification ───

export function signEvent(event: UnsignedNostrEvent, privateKeyHex: string): NostrEvent {
  const privateKey = hexToBytes(privateKeyHex)
  const unsigned = {
    kind: event.kind,
    content: event.content,
    tags: event.tags,
    created_at: event.created_at,
  }
  return finalizeEvent(unsigned, privateKey) as unknown as NostrEvent
}

export function verifyEventSignature(event: NostrEvent): boolean {
  return verifyEvent(event as Parameters<typeof verifyEvent>[0])
}

// ─── Key derivation ───

export function derivePublicKey(privateKeyHex: string): string {
  const privateKey = hexToBytes(privateKeyHex)
  return getPublicKey(privateKey)
}

// ─── NIP-19 encoding/decoding ───

export function npubEncode(pubkeyHex: string): string {
  return nip19.npubEncode(pubkeyHex)
}

export function npubDecode(npub: string): string {
  const decoded = nip19.decode(npub)
  if (decoded.type !== 'npub') throw new Error(`Expected npub, got ${decoded.type}`)
  return decoded.data
}

export function nprofileEncode(pubkey: string, relays?: string[]): string {
  return nip19.nprofileEncode({ pubkey, relays })
}

export function nprofileDecode(nprofile: string): { pubkey: string; relays?: string[] } {
  const decoded = nip19.decode(nprofile)
  if (decoded.type !== 'nprofile') throw new Error(`Expected nprofile, got ${decoded.type}`)
  return decoded.data
}

// ─── NIP-44 encryption/decryption ───

export function getConversationKey(privateKeyHex: string, publicKeyHex: string): Uint8Array {
  const privateKey = hexToBytes(privateKeyHex)
  return nip44.v2.utils.getConversationKey(privateKey, publicKeyHex)
}

export function encrypt(plaintext: string, conversationKey: Uint8Array): string {
  return nip44.v2.encrypt(plaintext, conversationKey)
}

export function decrypt(payload: string, conversationKey: Uint8Array): string {
  return nip44.v2.decrypt(payload, conversationKey)
}

// ─── NIP-19 pubkey helpers ───

export function normalizePubkey(input: string): string | null {
  const trimmed = input.trim()

  if (/^[0-9a-f]{64}$/i.test(trimmed)) {
    return trimmed.toLowerCase()
  }

  if (trimmed.startsWith('npub1') || trimmed.startsWith('nprofile1')) {
    try {
      const decoded = nip19.decode(trimmed)
      if (decoded.type === 'npub') return decoded.data
      if (decoded.type === 'nprofile') return decoded.data.pubkey
    } catch {
      return null
    }
  }

  return null
}

export function extractRelaysFromNprofile(input: string): string[] {
  const trimmed = input.trim()
  if (!trimmed.startsWith('nprofile1')) return []

  try {
    const decoded = nip19.decode(trimmed)
    if (decoded.type === 'nprofile' && decoded.data.relays) {
      return decoded.data.relays
    }
  } catch {
    // ignore
  }

  return []
}

// ─── NIP-17 gift wrap ───

export function wrapEvent(
  senderPrivkeyHex: string,
  recipientPubkeyHex: string,
  content: string,
): NostrEvent {
  const sk = hexToBytes(senderPrivkeyHex)
  return nip17.wrapEvent(sk, { publicKey: recipientPubkeyHex }, content) as unknown as NostrEvent
}

export function unwrapEvent(
  event: NostrEvent,
  recipientPrivkeyHex: string,
): { content: string; sender: string } {
  const sk = hexToBytes(recipientPrivkeyHex)
  const unwrapped = nip17.unwrapEvent(event as Parameters<typeof nip17.unwrapEvent>[0], sk)
  return {
    content: unwrapped.content,
    sender: unwrapped.pubkey,
  }
}
