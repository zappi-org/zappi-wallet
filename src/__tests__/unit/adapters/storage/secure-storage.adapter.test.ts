/**
 * SecureStorageAdapter — tag (iv hex) exposure + CAS replaceWallet contract.
 * Verified on real fake-indexeddb + crypto.subtle (no mocking).
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { SecureStorageAdapter } from '@/adapters/storage/secure-storage.adapter'
import type { StoredWallet } from '@/core/ports/driven/secure-storage.port'

function makeWallet(overrides?: Partial<StoredWallet>): StoredWallet {
  return {
    encryptedMnemonic: { ciphertext: 'ct', salt: 's', iv: 'i' },
    passwordHash: 'hash',
    passwordSalt: 'salt',
    publicKey: 'pub',
    createdAt: 1,
    kdfVersion: 2,
    ...overrides,
  }
}

describe('SecureStorageAdapter — tag / CAS', () => {
  let adapter: SecureStorageAdapter

  beforeEach(async () => {
    adapter = new SecureStorageAdapter()
    // Reset only the wallet record (keep the shared device key store so decryption still works).
    await adapter.deleteWallet()
  })

  it('getWalletWithTag returns null when no record exists', async () => {
    expect(await adapter.getWalletWithTag()).toBeNull()
  })

  it('tag is stable across reads of the same record, and changes after saveWallet', async () => {
    await adapter.saveWallet(makeWallet())
    const r1 = await adapter.getWalletWithTag()
    const r2 = await adapter.getWalletWithTag()
    expect(r1).not.toBeNull()
    expect(r1!.tag).toBe(r2!.tag) // same record → same tag
    expect(r1!.tag).toMatch(/^[0-9a-f]{24}$/) // 12-byte iv hex
    expect(r1!.wallet.publicKey).toBe('pub')

    await adapter.saveWallet(makeWallet({ publicKey: 'pub2' }))
    const r3 = await adapter.getWalletWithTag()
    expect(r3!.tag).not.toBe(r1!.tag) // new write → new tag
    expect(r3!.wallet.publicKey).toBe('pub2')
  })

  it('replaceWallet: matching tag → replaces record and returns true', async () => {
    await adapter.saveWallet(makeWallet({ publicKey: 'orig' }))
    const { tag } = (await adapter.getWalletWithTag())!

    const ok = await adapter.replaceWallet(makeWallet({ publicKey: 'next' }), tag)
    expect(ok).toBe(true)
    expect((await adapter.getWallet())!.publicKey).toBe('next')
  })

  it('replaceWallet: mismatched tag → record unchanged, returns false', async () => {
    await adapter.saveWallet(makeWallet({ publicKey: 'orig' }))
    const ok = await adapter.replaceWallet(makeWallet({ publicKey: 'loser' }), 'deadbeefdeadbeefdeadbeef')
    expect(ok).toBe(false)
    expect((await adapter.getWallet())!.publicKey).toBe('orig') // unchanged
  })

  it('replaceWallet: absent record → false (no-op, F5/F10 logout race safety)', async () => {
    const ok = await adapter.replaceWallet(makeWallet(), 'anytag')
    expect(ok).toBe(false)
    expect(await adapter.getWallet()).toBeNull()
  })

  it('CAS single-tx: external write between read and replace → stale tag rejected', async () => {
    await adapter.saveWallet(makeWallet({ publicKey: 'gen1' }))
    const { tag: staleTag } = (await adapter.getWalletWithTag())!

    // A different generation lands first (e.g., saveWallet from another tab) — the current tag changes.
    await adapter.saveWallet(makeWallet({ publicKey: 'gen2' }))

    // Replace with staleTag → CAS's in-tx get sees the mismatch with the current tag (gen2) → no-op.
    const ok = await adapter.replaceWallet(makeWallet({ publicKey: 'gen1-migrated' }), staleTag)
    expect(ok).toBe(false)
    expect((await adapter.getWallet())!.publicKey).toBe('gen2') // no resurrection/overwrite
  })
})
