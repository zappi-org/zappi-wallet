import { describe, it, expect } from 'vitest'
import {
  isFresh,
  isPermitted,
  isValidEventToSign,
  parsePermissions,
  parseSignerUri,
  serializePermissions,
  summarizeEvent,
} from '@/core/domain/remote-signing'
import type { UnsignedNostrEvent } from '@/core/domain/nostr'

const CLIENT = '83f3b2ae6aa368e8275397b9c26cf550101d63ebaab900d19dd4a4429f5ad8f5'
const SIGNER = 'fa984bd7dbb282f07e16e7ae87b26a2a7b9b90b7246a44771f0cf5ae58018f52'

describe('parseSignerUri', () => {
  it('parses a nostrconnect:// URI into a typed request', () => {
    const raw =
      `nostrconnect://${CLIENT}?relay=wss%3A%2F%2Frelay1.example.com` +
      `&perms=nip44_encrypt%2Csign_event%3A4&name=My+Client&secret=0s8j2djs` +
      `&relay=wss%3A%2F%2Frelay2.example.com`
    const result = parseSignerUri(raw)

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.request).toMatchObject({
      kind: 'nostrconnect',
      clientPubkey: CLIENT,
      relays: ['wss://relay1.example.com', 'wss://relay2.example.com'],
      secret: '0s8j2djs',
      name: 'My Client',
      permissions: [
        { method: 'nip44_encrypt' },
        { method: 'sign_event', kind: 4 },
      ],
    })
  })

  it('drops non-wss relays and duplicates', () => {
    const raw = `nostrconnect://${CLIENT}?relay=http%3A%2F%2Fbad&relay=wss%3A%2F%2Fr&relay=wss%3A%2F%2Fr&secret=s`
    const result = parseSignerUri(raw)
    expect(result.ok && result.request.relays).toEqual(['wss://r'])
  })

  it('rejects bad pubkey, missing secret, no relay, and unknown schemes', () => {
    expect(parseSignerUri('nostrconnect://nothex?relay=wss%3A%2F%2Fr&secret=s')).toEqual({
      ok: false,
      reason: 'bad-pubkey',
    })
    expect(parseSignerUri(`nostrconnect://${CLIENT}?relay=wss%3A%2F%2Fr`)).toEqual({
      ok: false,
      reason: 'missing-secret',
    })
    expect(parseSignerUri(`nostrconnect://${CLIENT}?secret=s`)).toEqual({
      ok: false,
      reason: 'no-relay',
    })
    expect(parseSignerUri('https://example.com')).toEqual({
      ok: false,
      reason: 'unsupported-scheme',
    })
  })

  it('rejects bunker:// (signer→client direction; Zappi is the signer)', () => {
    expect(parseSignerUri(`bunker://${SIGNER}?relay=wss%3A%2F%2Fr&secret=abc`)).toEqual({
      ok: false,
      reason: 'unsupported-scheme',
    })
  })
})

describe('permissions', () => {
  it('parses, dedupes, and drops unknown methods', () => {
    expect(parsePermissions('sign_event:4, sign_event:4, bogus, nip44_encrypt, ping')).toEqual([
      { method: 'sign_event', kind: 4 },
      { method: 'nip44_encrypt' },
      { method: 'ping' },
    ])
  })

  it('round-trips through serializePermissions', () => {
    const perms = parsePermissions('sign_event:1,nip44_decrypt')
    expect(parsePermissions(serializePermissions(perms))).toEqual(perms)
  })

  it('matches sign_event per kind and non-kind permissions across kinds', () => {
    expect(isPermitted([{ method: 'sign_event', kind: 1 }], 'sign_event', 1)).toBe(true)
    expect(isPermitted([{ method: 'sign_event', kind: 1 }], 'sign_event', 4)).toBe(false)
    expect(isPermitted([{ method: 'sign_event' }], 'sign_event', 999)).toBe(true)
    expect(isPermitted([{ method: 'ping' }], 'get_public_key')).toBe(false)
  })
})

describe('isFresh / isValidEventToSign / summarizeEvent', () => {
  it('accepts inside the window and rejects outside it', () => {
    expect(isFresh(1000, 1050, 120)).toBe(true)
    expect(isFresh(800, 1000, 120)).toBe(false)
    expect(isFresh(1500, 1000, 120)).toBe(false)
  })

  it('validates the inner sign_event target against signer pubkey and freshness', () => {
    const base = { kind: 1, content: 'x', tags: [], created_at: 1000, pubkey: SIGNER }
    expect(isValidEventToSign(base, SIGNER, 1000)).toBe(true)
    // missing pubkey is fine (filled from our key at signing time)
    expect(isValidEventToSign({ ...base, pubkey: undefined as unknown as string }, SIGNER, 1000)).toBe(true)
    expect(isValidEventToSign({ ...base, pubkey: CLIENT }, SIGNER, 1000)).toBe(false)
    expect(isValidEventToSign({ ...base, created_at: 5000 }, SIGNER, 1000)).toBe(false)
    expect(isValidEventToSign({ ...base, created_at: 0 }, SIGNER, 1000)).toBe(false)
  })

  it('truncates long content in the preview', () => {
    const event = { kind: 1, content: 'x'.repeat(200) } as UnsignedNostrEvent
    const preview = summarizeEvent(event)
    expect(preview.startsWith('kind 1: ')).toBe(true)
    expect(preview.length).toBeLessThan(160)
  })
})
