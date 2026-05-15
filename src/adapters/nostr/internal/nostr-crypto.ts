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

// npubDecode/nprofileDecode removed — use core/domain/nostr-address versions

export function nprofileEncode(pubkey: string, relays?: string[]): string {
  return nip19.nprofileEncode({ pubkey, relays })
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
): { content: string; sender: string; createdAt: number } {
  const sk = hexToBytes(recipientPrivkeyHex)
  const seal = decryptNip44Json(event, sk)
  if (!isNostrEvent(seal) || seal.kind !== 13) {
    throw new Error('Invalid NIP-17 seal')
  }
  if (!verifyEvent(seal as Parameters<typeof verifyEvent>[0])) {
    throw new Error('Invalid NIP-17 seal signature')
  }

  const rumor = decryptNip44Json(seal, sk)
  if (!isRumor(rumor)) {
    throw new Error('Invalid NIP-17 rumor')
  }
  if (rumor.pubkey !== seal.pubkey) {
    throw new Error('NIP-17 seal author mismatch')
  }

  return {
    content: rumor.content,
    sender: rumor.pubkey,
    createdAt: rumor.created_at,
  }
}

function decryptNip44Json(event: Pick<NostrEvent, 'content' | 'pubkey'>, privateKey: Uint8Array): unknown {
  const conversationKey = nip44.v2.utils.getConversationKey(privateKey, event.pubkey)
  return JSON.parse(nip44.v2.decrypt(event.content, conversationKey))
}

function isNostrEvent(value: unknown): value is NostrEvent {
  if (!isObject(value)) return false
  return (
    typeof value.id === 'string' &&
    typeof value.pubkey === 'string' &&
    typeof value.created_at === 'number' &&
    typeof value.kind === 'number' &&
    Array.isArray(value.tags) &&
    typeof value.content === 'string' &&
    typeof value.sig === 'string'
  )
}

function isRumor(value: unknown): value is Pick<NostrEvent, 'id' | 'pubkey' | 'created_at' | 'kind' | 'tags' | 'content'> {
  if (!isObject(value)) return false
  return (
    typeof value.id === 'string' &&
    typeof value.pubkey === 'string' &&
    typeof value.created_at === 'number' &&
    typeof value.kind === 'number' &&
    Array.isArray(value.tags) &&
    typeof value.content === 'string'
  )
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}
