/**
 * NIP-59 gift wrap unwrapping — sender authentication, with real crypto (no mocks).
 *
 * Callers treat the returned `sender` as an authenticated identity and make
 * authorization decisions with it, so the rumor's self-declared author is only
 * trustworthy when it matches the pubkey that actually signed the seal.
 *
 * Pinned contract:
 * - a well-formed wrap resolves to the seal signer
 * - a rumor claiming another author is rejected
 * - a seal with a broken signature is rejected
 * - a non-seal inner event is rejected
 */
import { describe, it, expect } from 'vitest'
import { finalizeEvent, generateSecretKey, getPublicKey } from 'nostr-tools'
import * as nip44 from 'nostr-tools/nip44'
import { bytesToHex } from '@noble/hashes/utils.js'
import { unwrapEvent } from '@/adapters/nostr/internal/nostr-crypto'
import type { NostrEvent } from '@/core/domain/nostr'

const SEAL_KIND = 13
const GIFT_WRAP_KIND = 1059
const DM_KIND = 14
const AT = 1_700_000_000

function encryptTo(payload: unknown, senderSk: Uint8Array, recipientPubkey: string): string {
  const key = nip44.v2.utils.getConversationKey(senderSk, recipientPubkey)
  return nip44.v2.encrypt(JSON.stringify(payload), key)
}

function makeRumor(claimedAuthor: string, content: string) {
  return {
    id: 'rumor-id',
    pubkey: claimedAuthor,
    created_at: AT,
    kind: DM_KIND,
    tags: [] as string[][],
    content,
  }
}

/** Seals a rumor with `sealSk`, then wraps it for `recipientPubkey`. */
function sealAndWrap(
  rumor: ReturnType<typeof makeRumor>,
  sealSk: Uint8Array,
  recipientPubkey: string,
  corrupt?: (seal: Record<string, unknown>) => void,
): NostrEvent {
  const seal = finalizeEvent(
    { kind: SEAL_KIND, content: encryptTo(rumor, sealSk, recipientPubkey), created_at: AT, tags: [] },
    sealSk,
  ) as unknown as Record<string, unknown>

  corrupt?.(seal)

  const wrapSk = generateSecretKey()
  return finalizeEvent(
    {
      kind: GIFT_WRAP_KIND,
      content: encryptTo(seal, wrapSk, recipientPubkey),
      created_at: AT,
      tags: [['p', recipientPubkey]],
    },
    wrapSk,
  ) as unknown as NostrEvent
}

describe('unwrapEvent — gift wrap sender authentication', () => {
  const aliceSk = generateSecretKey()
  const alicePub = getPublicKey(aliceSk)
  const mallorySk = generateSecretKey()
  const malloryPub = getPublicKey(mallorySk)
  const recipientSk = generateSecretKey()
  const recipientPub = getPublicKey(recipientSk)
  const recipientSkHex = bytesToHex(recipientSk)

  it('resolves a well-formed wrap to the seal signer', () => {
    const wrap = sealAndWrap(makeRumor(alicePub, 'hello'), aliceSk, recipientPub)

    const result = unwrapEvent(wrap, recipientSkHex)

    expect(result.sender).toBe(alicePub)
    expect(result.content).toBe('hello')
  })

  it('rejects a rumor that claims an author other than the seal signer', () => {
    // Mallory seals with her own key but has the rumor claim to be Alice.
    const wrap = sealAndWrap(makeRumor(alicePub, 'pay me'), mallorySk, recipientPub)

    expect(() => unwrapEvent(wrap, recipientSkHex)).toThrow(
      'Gift wrap rumor author does not match the seal signer',
    )
  })

  it('accepts Mallory only under her own identity', () => {
    const wrap = sealAndWrap(makeRumor(malloryPub, 'hi'), mallorySk, recipientPub)

    expect(unwrapEvent(wrap, recipientSkHex).sender).toBe(malloryPub)
    expect(unwrapEvent(wrap, recipientSkHex).sender).not.toBe(alicePub)
  })

  it('rejects a seal whose signature does not verify', () => {
    const wrap = sealAndWrap(makeRumor(alicePub, 'hello'), aliceSk, recipientPub, (seal) => {
      seal.sig = '0'.repeat(128)
    })

    expect(() => unwrapEvent(wrap, recipientSkHex)).toThrow(
      'Gift wrap seal has an invalid signature',
    )
  })

  it('rejects a seal whose pubkey was swapped after signing', () => {
    const wrap = sealAndWrap(makeRumor(alicePub, 'hello'), aliceSk, recipientPub, (seal) => {
      seal.pubkey = malloryPub
    })

    expect(() => unwrapEvent(wrap, recipientSkHex)).toThrow(
      'Gift wrap seal has an invalid signature',
    )
  })

  it('rejects an inner event that is not a seal', () => {
    const notASeal = finalizeEvent(
      { kind: DM_KIND, content: 'plain', created_at: AT, tags: [] },
      aliceSk,
    )
    const wrapSk = generateSecretKey()
    const wrap = finalizeEvent(
      {
        kind: GIFT_WRAP_KIND,
        content: encryptTo(notASeal, wrapSk, recipientPub),
        created_at: AT,
        tags: [['p', recipientPub]],
      },
      wrapSk,
    ) as unknown as NostrEvent

    expect(() => unwrapEvent(wrap, recipientSkHex)).toThrow('Gift wrap does not contain a seal')
  })

  it('rejects a wrap addressed to someone else', () => {
    const wrap = sealAndWrap(makeRumor(alicePub, 'hello'), aliceSk, getPublicKey(generateSecretKey()))

    expect(() => unwrapEvent(wrap, recipientSkHex)).toThrow()
  })
})
