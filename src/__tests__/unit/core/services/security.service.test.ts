import { describe, it, expect, vi, beforeEach } from 'vitest'
import { SecurityService } from '@/core/services/security.service'
import type { KeyManager } from '@/core/ports/driven/key-manager.port'
import type { Encryption, EncryptedData } from '@/core/ports/driven/encryption.port'
import type { SecureStorage, StoredWallet } from '@/core/ports/driven/secure-storage.port'
import type { SeedCache } from '@/core/ports/driven/seed-cache.port'
import type { UnlockGrace } from '@/core/ports/driven/unlock-grace.port'

// ─── Fixtures ───

const TEST_MNEMONIC = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about'
const TEST_KEYS = {
  privateKey: 'aabbccdd',
  publicKey: '11223344',
}
const TEST_SEED = new Uint8Array(64).fill(42)

// ─── Mocks ───

function createMocks() {
  const keyManager: KeyManager = {
    generateMnemonic: vi.fn().mockReturnValue(TEST_MNEMONIC),
    validateMnemonic: vi.fn().mockReturnValue(true),
    deriveNostrKeyPair: vi.fn().mockReturnValue(TEST_KEYS),
    deriveP2PKPubkey: vi.fn().mockReturnValue('02aabbccdd'),
    derivePOSSubKey: vi.fn(),
    deriveBip39Seed: vi.fn().mockReturnValue(TEST_SEED),
  }

  // Iteration-aware mock: hashPassword returns a value bound to (password, iterations)
  // so verifyAgainstRecord picks the right version, and a wrong PIN matches none.
  // encrypt tags the iteration count so migration re-derivation (600k) is observable.
  const encryption: Encryption = {
    encrypt: vi.fn().mockImplementation((_data: string, _pw: string, iters: number) =>
      Promise.resolve({ ciphertext: `ct@${iters}`, salt: 'aabb', iv: 'ccdd' } as EncryptedData)),
    decrypt: vi.fn().mockResolvedValue(TEST_MNEMONIC),
    hashPassword: vi.fn().mockImplementation((pw: string, _salt: string, iters: number) =>
      Promise.resolve(`hash@${iters}@${pw}`)),
  }

  // CAS-aware storage mock: the tag changes on every write and replaceWallet swaps only on a tag match.
  let storedWallet: StoredWallet | null = null
  let tagSeq = 0
  let currentTag = 'tag-0'
  const storage: SecureStorage = {
    getWallet: vi.fn().mockImplementation(() => Promise.resolve(storedWallet)),
    getWalletWithTag: vi.fn().mockImplementation(() =>
      Promise.resolve(storedWallet ? { wallet: storedWallet, tag: currentTag } : null)),
    saveWallet: vi.fn().mockImplementation((w: StoredWallet) => {
      storedWallet = w
      currentTag = `tag-${++tagSeq}`
      return Promise.resolve()
    }),
    replaceWallet: vi.fn().mockImplementation((next: StoredWallet, expectedTag: string) => {
      if (expectedTag !== currentTag) return Promise.resolve(false)
      storedWallet = next
      currentTag = `tag-${++tagSeq}`
      return Promise.resolve(true)
    }),
    deleteWallet: vi.fn().mockImplementation(() => {
      storedWallet = null
      return Promise.resolve()
    }),
  }

  // Stateful seed cache so hydrateSession → cacheMnemonic → getCachedMnemonic
  // (used by saveGrace) reflects the live session.
  let cachedMnemonic: string | null = null
  const seedCache: SeedCache = {
    cacheMnemonic: vi.fn().mockImplementation((m: string) => { cachedMnemonic = m }),
    getCachedMnemonic: vi.fn().mockImplementation(() => cachedMnemonic),
    isCached: vi.fn().mockImplementation(() => cachedMnemonic !== null),
    clearCache: vi.fn().mockImplementation(() => { cachedMnemonic = null }),
  }

  // Stateful grace mock mirroring the adapter contract: load checks expiry,
  // extend is non-creating/non-reviving, clear removes the blob.
  let graceBlob: { mnemonic: string; expiresAt: number } | null = null
  const grace: UnlockGrace = {
    save: vi.fn().mockImplementation((mnemonic: string, expiresAt: number) => {
      graceBlob = { mnemonic, expiresAt }
      return Promise.resolve()
    }),
    load: vi.fn().mockImplementation(() => {
      if (!graceBlob) return Promise.resolve(null)
      if (Date.now() >= graceBlob.expiresAt) { graceBlob = null; return Promise.resolve(null) }
      return Promise.resolve({ ...graceBlob })
    }),
    extend: vi.fn().mockImplementation((expiresAt: number) => {
      if (graceBlob && Date.now() < graceBlob.expiresAt) graceBlob.expiresAt = expiresAt
      return Promise.resolve()
    }),
    clear: vi.fn().mockImplementation(() => { graceBlob = null; return Promise.resolve() }),
  }

  return {
    keyManager,
    encryption,
    storage,
    seedCache,
    grace,
    getStoredWallet: () => storedWallet,
    setStoredWallet: (w: StoredWallet | null) => {
      storedWallet = w
      currentTag = `tag-${++tagSeq}`
    },
    getTag: () => currentTag,
    getGraceBlob: () => graceBlob,
    setGraceBlob: (b: { mnemonic: string; expiresAt: number } | null) => { graceBlob = b },
  }
}

// ─── v1 record fixture (kdfVersion absent/1, passwordHash bound to 100k + PIN) ───

const V1_PIN = 'pin1234'
function makeV1Wallet(): StoredWallet {
  return {
    encryptedMnemonic: { ciphertext: 'v1-ct', salt: 'v1s', iv: 'v1i' },
    passwordHash: `hash@100000@${V1_PIN}`,
    passwordSalt: 'salt-v1',
    publicKey: '11223344',
    createdAt: 1,
    kdfVersion: 1,
  }
}

// ─── Tests ───

describe('SecurityService', () => {
  let service: SecurityService
  let keyManager: KeyManager
  let encryption: Encryption
  let storage: SecureStorage
  let mocks: ReturnType<typeof createMocks>

  beforeEach(() => {
    mocks = createMocks()
    keyManager = mocks.keyManager
    encryption = mocks.encryption
    storage = mocks.storage
    service = new SecurityService(keyManager, encryption, storage, mocks.seedCache, mocks.grace)
  })

  // ─── createWallet ───

  describe('createWallet', () => {
    it('creates wallet and returns keys + seed', async () => {
      const result = await service.createWallet(TEST_MNEMONIC, 'pin1234')

      expect(result.ok).toBe(true)
      if (result.ok) {
        expect(result.value.keys).toEqual(TEST_KEYS)
        expect(result.value.bip39Seed).toBe(TEST_SEED)
      }

      expect(keyManager.validateMnemonic).toHaveBeenCalledWith(TEST_MNEMONIC)
      expect(encryption.encrypt).toHaveBeenCalledWith(TEST_MNEMONIC, 'pin1234', 600_000)
      expect(storage.saveWallet).toHaveBeenCalled()
    })

    it('caches keys and seed after creation', async () => {
      await service.createWallet(TEST_MNEMONIC, 'pin1234')

      expect(service.getCachedKeys()).toEqual(TEST_KEYS)
      expect(service.getCachedSeed()).toBe(TEST_SEED)
    })

    it('rejects invalid mnemonic', async () => {
      vi.mocked(keyManager.validateMnemonic).mockReturnValue(false)

      const result = await service.createWallet('bad words', 'pin')

      expect(result.ok).toBe(false)
      if (!result.ok) {
        expect(result.error.code).toBe('INVALID_MNEMONIC')
      }
      expect(storage.saveWallet).not.toHaveBeenCalled()
    })
  })

  // ─── unlock ───

  describe('unlock', () => {
    beforeEach(async () => {
      await service.createWallet(TEST_MNEMONIC, 'pin1234')
      service.lock()
    })

    it('unlocks with correct password', async () => {
      const result = await service.unlock('pin1234')

      expect(result.ok).toBe(true)
      if (result.ok) {
        expect(result.value.keys).toEqual(TEST_KEYS)
        expect(result.value.bip39Seed).toBe(TEST_SEED)
      }
    })

    it('rejects wrong password', async () => {
      vi.mocked(encryption.hashPassword).mockResolvedValueOnce('wrong-hash')

      const result = await service.unlock('wrong-pin')

      expect(result.ok).toBe(false)
      if (!result.ok) {
        expect(result.error.code).toBe('INVALID_PASSWORD')
      }
    })

    it('returns error when no wallet exists', async () => {
      await service.deleteWallet()

      const result = await service.unlock('pin1234')

      expect(result.ok).toBe(false)
      if (!result.ok) {
        expect(result.error.code).toBe('NO_WALLET')
      }
    })
  })

  // ─── changePassword ───

  describe('changePassword', () => {
    beforeEach(async () => {
      await service.createWallet(TEST_MNEMONIC, 'old-pin')
    })

    it('changes password successfully', async () => {
      const result = await service.changePassword('old-pin', 'new-pin')

      expect(result.ok).toBe(true)
      expect(encryption.decrypt).toHaveBeenCalled()
      expect(encryption.encrypt).toHaveBeenCalledWith(TEST_MNEMONIC, 'new-pin', 600_000)
      // saveWallet called twice: create + change
      expect(storage.saveWallet).toHaveBeenCalledTimes(2)
    })

    it('rejects wrong old password', async () => {
      vi.mocked(encryption.hashPassword).mockResolvedValueOnce('wrong-hash')

      const result = await service.changePassword('wrong', 'new')

      expect(result.ok).toBe(false)
      if (!result.ok) {
        expect(result.error.code).toBe('INVALID_PASSWORD')
      }
    })
  })

  // ─── verifyPassword ───

  describe('verifyPassword', () => {
    beforeEach(async () => {
      await service.createWallet(TEST_MNEMONIC, 'pin1234')
    })

    it('returns true for correct password', async () => {
      const result = await service.verifyPassword('pin1234')

      expect(result.ok).toBe(true)
      if (result.ok) expect(result.value).toBe(true)
    })

    it('returns false for wrong password', async () => {
      vi.mocked(encryption.hashPassword).mockResolvedValueOnce('wrong-hash')

      const result = await service.verifyPassword('wrong')

      expect(result.ok).toBe(true)
      if (result.ok) expect(result.value).toBe(false)
    })
  })

  // ─── getMnemonic ───

  describe('getMnemonic', () => {
    beforeEach(async () => {
      await service.createWallet(TEST_MNEMONIC, 'pin1234')
    })

    it('returns mnemonic with correct password', async () => {
      const result = await service.getMnemonic('pin1234')

      expect(result.ok).toBe(true)
      if (result.ok) expect(result.value).toBe(TEST_MNEMONIC)
    })

    it('rejects wrong password', async () => {
      vi.mocked(encryption.hashPassword).mockResolvedValueOnce('wrong-hash')

      const result = await service.getMnemonic('wrong')

      expect(result.ok).toBe(false)
    })
  })

  // ─── lock / delete ───

  describe('lock', () => {
    it('clears cached keys and seed', async () => {
      await service.createWallet(TEST_MNEMONIC, 'pin')
      expect(service.getCachedKeys()).not.toBeNull()

      service.lock()

      expect(service.getCachedKeys()).toBeNull()
      expect(service.getCachedSeed()).toBeNull()
    })
  })

  describe('deleteWallet', () => {
    it('deletes wallet and clears cache', async () => {
      await service.createWallet(TEST_MNEMONIC, 'pin')

      await service.deleteWallet()

      expect(storage.deleteWallet).toHaveBeenCalled()
      expect(service.getCachedKeys()).toBeNull()
      expect(await service.hasWallet()).toBe(false)
    })

    it('clears grace before deleting the wallet record', async () => {
      await service.createWallet(TEST_MNEMONIC, 'pin')
      await service.saveGrace(Date.now() + 60_000)
      expect(mocks.getGraceBlob()).not.toBeNull()

      await service.deleteWallet()

      expect(mocks.grace.clear).toHaveBeenCalled()
      expect(mocks.getGraceBlob()).toBeNull()
      // Grace is the more sensitive PIN-free copy — cleared before the wallet record.
      expect(vi.mocked(mocks.grace.clear).mock.invocationCallOrder[0])
        .toBeLessThan(vi.mocked(storage.deleteWallet).mock.invocationCallOrder[0])
    })
  })

  // ─── unlock grace (PIN-free reload resume) ───

  describe('unlock grace', () => {
    it('lock() invalidates the grace blob', async () => {
      await service.createWallet(TEST_MNEMONIC, 'pin1234')
      await service.saveGrace(Date.now() + 60_000)
      expect(mocks.getGraceBlob()).not.toBeNull()

      service.lock()
      await Promise.resolve() // let the fire-and-forget clear settle

      expect(mocks.grace.clear).toHaveBeenCalled()
      expect(mocks.getGraceBlob()).toBeNull()
    })

    it('saveGrace persists the cached mnemonic; no-op when locked', async () => {
      await service.createWallet(TEST_MNEMONIC, 'pin1234')
      const expiresAt = Date.now() + 60_000
      await service.saveGrace(expiresAt)
      expect(mocks.grace.save).toHaveBeenCalledWith(TEST_MNEMONIC, expiresAt)

      service.lock()
      vi.mocked(mocks.grace.save).mockClear()
      await service.saveGrace(Date.now() + 60_000)
      expect(mocks.grace.save).not.toHaveBeenCalled() // no session → nothing to persist
    })

    it('extendGrace delegates to grace.extend', async () => {
      const expiresAt = Date.now() + 120_000
      await service.extendGrace(expiresAt)
      expect(mocks.grace.extend).toHaveBeenCalledWith(expiresAt)
    })

    it('tryResumeSession resumes a live blob with the same output as unlock', async () => {
      mocks.setGraceBlob({ mnemonic: TEST_MNEMONIC, expiresAt: Date.now() + 60_000 })

      const resumed = await service.tryResumeSession()

      expect(resumed).not.toBeNull()
      expect(resumed!.keys).toEqual(TEST_KEYS)
      expect(resumed!.bip39Seed).toBe(TEST_SEED)
      expect(resumed!.migrated).toBeUndefined() // grace never migrates KDF
      // Session caches are populated so Coco's getSeed works, exactly like unlock.
      expect(service.getCachedKeys()).toEqual(TEST_KEYS)
      expect(mocks.seedCache.cacheMnemonic).toHaveBeenCalledWith(TEST_MNEMONIC)
    })

    it('tryResumeSession returns null with no grace', async () => {
      expect(await service.tryResumeSession()).toBeNull()
      expect(service.getCachedKeys()).toBeNull()
    })

    it('tryResumeSession returns null when grace is expired (load self-deletes)', async () => {
      mocks.setGraceBlob({ mnemonic: TEST_MNEMONIC, expiresAt: Date.now() - 1 })
      expect(await service.tryResumeSession()).toBeNull()
      expect(mocks.getGraceBlob()).toBeNull()
      expect(service.getCachedKeys()).toBeNull()
    })

    it('tryResumeSession returns null when load throws (integrity failure → PIN)', async () => {
      vi.mocked(mocks.grace.load).mockRejectedValueOnce(new Error('decrypt failed'))
      expect(await service.tryResumeSession()).toBeNull()
      expect(service.getCachedKeys()).toBeNull()
    })
  })

  // ─── unlock — KDF migration contract ───

  describe('unlock — KDF migration', () => {
    let mocks: ReturnType<typeof createMocks>
    let svc: SecurityService

    beforeEach(() => {
      mocks = createMocks()
      svc = new SecurityService(mocks.keyManager, mocks.encryption, mocks.storage, mocks.seedCache, mocks.grace)
    })

    it('v1 record + correct PIN → migrates to v2 (both fields re-derived), re-unlock ok, same mnemonic', async () => {
      mocks.setStoredWallet(makeV1Wallet())

      const result = await svc.unlock(V1_PIN)
      expect(result.ok).toBe(true)
      if (result.ok) expect(result.value.migrated).toBe(true)

      expect(mocks.storage.replaceWallet).toHaveBeenCalledTimes(1)
      const next = vi.mocked(mocks.storage.replaceWallet).mock.calls[0][0]
      expect(next.kdfVersion).toBe(2)
      expect(next.passwordHash).toBe(`hash@600000@${V1_PIN}`)      // verifier re-derived at v2
      expect(next.encryptedMnemonic.ciphertext).toBe('ct@600000')  // mnemonic re-derived at v2
      expect(next.passwordSalt).not.toBe('salt-v1')                // fresh salt

      // re-unlock: record is now v2 → fast path, no re-migration, mnemonic recoverable
      svc.lock()
      const re = await svc.unlock(V1_PIN)
      expect(re.ok).toBe(true)
      if (re.ok) expect(re.value.migrated).toBe(false)
      const mn = await svc.getMnemonic(V1_PIN)
      expect(mn.ok && mn.value).toBe(TEST_MNEMONIC)
    })

    it('v2 record unlock → zero writes (fast path)', async () => {
      mocks.setStoredWallet({
        ...makeV1Wallet(),
        passwordHash: `hash@600000@${V1_PIN}`,
        encryptedMnemonic: { ciphertext: 'ct@600000', salt: 's', iv: 'i' },
        kdfVersion: 2,
      })
      const result = await svc.unlock(V1_PIN)
      expect(result.ok).toBe(true)
      if (result.ok) expect(result.value.migrated).toBe(false)
      expect(mocks.storage.replaceWallet).not.toHaveBeenCalled()
      expect(mocks.storage.saveWallet).not.toHaveBeenCalled()
    })

    it('wrong PIN → migration never fires (INVALID_PASSWORD only)', async () => {
      mocks.setStoredWallet(makeV1Wallet())
      const result = await svc.unlock('wrong-pin')
      expect(result.ok).toBe(false)
      if (!result.ok) expect(result.error.code).toBe('INVALID_PASSWORD')
      expect(mocks.storage.replaceWallet).not.toHaveBeenCalled()
    })

    it('replaceWallet false (CAS miss) → unlock Ok, record unchanged, migrated=false', async () => {
      const v1 = makeV1Wallet()
      mocks.setStoredWallet(v1)
      vi.mocked(mocks.storage.replaceWallet).mockResolvedValue(false)

      const result = await svc.unlock(V1_PIN)
      expect(result.ok).toBe(true)
      if (result.ok) expect(result.value.migrated).toBe(false)
      expect(mocks.getStoredWallet()).toBe(v1) // record untouched
    })

    it('replaceWallet throws → unlock Ok (non-fatal), record unchanged, migrated=false', async () => {
      const v1 = makeV1Wallet()
      mocks.setStoredWallet(v1)
      vi.mocked(mocks.storage.replaceWallet).mockRejectedValue(new Error('quota exceeded'))

      const result = await svc.unlock(V1_PIN)
      expect(result.ok).toBe(true)
      if (result.ok) expect(result.value.migrated).toBe(false)
      expect(mocks.getStoredWallet()).toBe(v1)
    })

    it('readback mismatch (mnemonic roundtrip) → put not reached', async () => {
      mocks.setStoredWallet(makeV1Wallet())
      // unlock decrypt returns the real mnemonic; migrate readback decrypt returns corrupted text
      vi.mocked(mocks.encryption.decrypt)
        .mockResolvedValueOnce(TEST_MNEMONIC)        // unlock
        .mockResolvedValueOnce('CORRUPTED-MNEMONIC') // migrate readback
      const result = await svc.unlock(V1_PIN)
      expect(result.ok).toBe(true)
      if (result.ok) expect(result.value.migrated).toBe(false)
      expect(mocks.storage.replaceWallet).not.toHaveBeenCalled()
    })

    it('bidirectional readback: hash2 miswiring (verifier roundtrip) → put not reached', async () => {
      mocks.setStoredWallet(makeV1Wallet())
      // call 1 = verifyAgainstRecord (must match v1); call 2 = migrate store hash;
      // call 3 = migrate readback hash (differs → trips the verifier-roundtrip gate).
      // Mnemonic roundtrip stays valid, isolating the hash gate.
      let n = 0
      vi.mocked(mocks.encryption.hashPassword).mockImplementation(
        (pw: string, _salt: string, iters: number) => {
          n += 1
          if (n === 1) return Promise.resolve(`hash@${iters}@${pw}`)
          if (n === 2) return Promise.resolve('store-hash')
          return Promise.resolve('readback-DIFFERENT')
        },
      )
      const result = await svc.unlock(V1_PIN)
      expect(result.ok).toBe(true)
      if (result.ok) expect(result.value.migrated).toBe(false)
      expect(mocks.storage.replaceWallet).not.toHaveBeenCalled()
    })

    it('contamination healing (F7): kdfVersion=2 + 100k content → fallback match → re-migration', async () => {
      mocks.setStoredWallet({
        ...makeV1Wallet(),
        passwordHash: `hash@100000@${V1_PIN}`, // v1 content
        kdfVersion: 2, // declares v2 — contaminated by old-bundle changePassword spread
      })
      const result = await svc.unlock(V1_PIN)
      expect(result.ok).toBe(true)
      if (result.ok) expect(result.value.migrated).toBe(true)
      expect(mocks.storage.replaceWallet).toHaveBeenCalledTimes(1)
      const next = vi.mocked(mocks.storage.replaceWallet).mock.calls[0][0]
      expect(next.passwordHash).toBe(`hash@600000@${V1_PIN}`) // healed to honest v2 content
      expect(next.kdfVersion).toBe(2)
    })
  })

  // ─── verifyPassword / getMnemonic / changePassword version-aware (reads only, no writes) ───

  describe('version-aware reads (no writes)', () => {
    let mocks: ReturnType<typeof createMocks>
    let svc: SecurityService

    beforeEach(() => {
      mocks = createMocks()
      svc = new SecurityService(mocks.keyManager, mocks.encryption, mocks.storage, mocks.seedCache, mocks.grace)
    })

    const cases: ReadonlyArray<{ label: string; wallet: StoredWallet }> = [
      { label: 'v1', wallet: makeV1Wallet() },
      {
        label: 'v2',
        wallet: { ...makeV1Wallet(), passwordHash: `hash@600000@${V1_PIN}`, kdfVersion: 2 },
      },
    ]

    for (const { label, wallet } of cases) {
      it(`verifyPassword on ${label} record: correct→true, wrong→false, zero writes`, async () => {
        mocks.setStoredWallet(wallet)
        const good = await svc.verifyPassword(V1_PIN)
        expect(good.ok && good.value).toBe(true)
        const bad = await svc.verifyPassword('nope')
        expect(bad.ok && bad.value).toBe(false)
        expect(mocks.storage.saveWallet).not.toHaveBeenCalled()
        expect(mocks.storage.replaceWallet).not.toHaveBeenCalled()
      })

      it(`getMnemonic on ${label} record: correct→mnemonic, wrong→err, zero writes`, async () => {
        mocks.setStoredWallet(wallet)
        const good = await svc.getMnemonic(V1_PIN)
        expect(good.ok && good.value).toBe(TEST_MNEMONIC)
        const bad = await svc.getMnemonic('nope')
        expect(bad.ok).toBe(false)
        expect(mocks.storage.saveWallet).not.toHaveBeenCalled()
        expect(mocks.storage.replaceWallet).not.toHaveBeenCalled()
      })
    }

    it('changePassword on v1 record: verifies at 100k, rewrites at 600k + kdfVersion=2', async () => {
      mocks.setStoredWallet(makeV1Wallet())
      const result = await svc.changePassword(V1_PIN, 'new-pin')
      expect(result.ok).toBe(true)
      const saved = mocks.getStoredWallet()
      expect(saved?.kdfVersion).toBe(2)
      expect(saved?.passwordHash).toBe('hash@600000@new-pin')
      expect(saved?.encryptedMnemonic.ciphertext).toBe('ct@600000')
    })
  })
})
