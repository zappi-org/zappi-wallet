import { describe, it, expect, vi, beforeEach } from 'vitest'
import { SecurityService } from '@/core/services/security.service'
import type { KeyManager } from '@/core/ports/driven/key-manager.port'
import type { Encryption, EncryptedData } from '@/core/ports/driven/encryption.port'
import type { SecureStorage, StoredWallet } from '@/core/ports/driven/secure-storage.port'

// ─── Fixtures ───

const TEST_MNEMONIC = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about'
const TEST_KEYS = {
  privateKey: 'aabbccdd',
  publicKey: '11223344',
}
const TEST_SEED = new Uint8Array(64).fill(42)
const TEST_ENCRYPTED: EncryptedData = {
  ciphertext: 'encrypted-base64',
  salt: 'aabb',
  iv: 'ccdd',
}

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

  const encryption: Encryption = {
    encrypt: vi.fn().mockResolvedValue(TEST_ENCRYPTED),
    decrypt: vi.fn().mockResolvedValue(TEST_MNEMONIC),
    hashPassword: vi.fn().mockResolvedValue('hashed-password'),
  }

  let storedWallet: StoredWallet | null = null
  const storage: SecureStorage = {
    getWallet: vi.fn().mockImplementation(() => Promise.resolve(storedWallet)),
    saveWallet: vi.fn().mockImplementation((w: StoredWallet) => {
      storedWallet = w
      return Promise.resolve()
    }),
    deleteWallet: vi.fn().mockImplementation(() => {
      storedWallet = null
      return Promise.resolve()
    }),
  }

  return { keyManager, encryption, storage, getStoredWallet: () => storedWallet }
}

// ─── Tests ───

describe('SecurityService', () => {
  let service: SecurityService
  let keyManager: KeyManager
  let encryption: Encryption
  let storage: SecureStorage

  beforeEach(() => {
    const mocks = createMocks()
    keyManager = mocks.keyManager
    encryption = mocks.encryption
    storage = mocks.storage
    service = new SecurityService(keyManager, encryption, storage)
  })

  // ─── createWallet ───

  describe('createWallet', () => {
    it('creates wallet and returns keys + seed', async () => {
      const result = await service.createWallet(TEST_MNEMONIC, 'pin1234')

      expect(result.isOk()).toBe(true)
      if (result.isOk()) {
        expect(result.value.keys).toEqual(TEST_KEYS)
        expect(result.value.bip39Seed).toBe(TEST_SEED)
      }

      expect(keyManager.validateMnemonic).toHaveBeenCalledWith(TEST_MNEMONIC)
      expect(encryption.encrypt).toHaveBeenCalledWith(TEST_MNEMONIC, 'pin1234')
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

      expect(result.isErr()).toBe(true)
      if (result.isErr()) {
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

      expect(result.isOk()).toBe(true)
      if (result.isOk()) {
        expect(result.value.keys).toEqual(TEST_KEYS)
        expect(result.value.bip39Seed).toBe(TEST_SEED)
      }
    })

    it('rejects wrong password', async () => {
      vi.mocked(encryption.hashPassword).mockResolvedValueOnce('wrong-hash')

      const result = await service.unlock('wrong-pin')

      expect(result.isErr()).toBe(true)
      if (result.isErr()) {
        expect(result.error.code).toBe('INVALID_PASSWORD')
      }
    })

    it('returns error when no wallet exists', async () => {
      await service.deleteWallet()

      const result = await service.unlock('pin1234')

      expect(result.isErr()).toBe(true)
      if (result.isErr()) {
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

      expect(result.isOk()).toBe(true)
      expect(encryption.decrypt).toHaveBeenCalled()
      expect(encryption.encrypt).toHaveBeenCalledWith(TEST_MNEMONIC, 'new-pin')
      // saveWallet called twice: create + change
      expect(storage.saveWallet).toHaveBeenCalledTimes(2)
    })

    it('rejects wrong old password', async () => {
      vi.mocked(encryption.hashPassword).mockResolvedValueOnce('wrong-hash')

      const result = await service.changePassword('wrong', 'new')

      expect(result.isErr()).toBe(true)
      if (result.isErr()) {
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

      expect(result.isOk()).toBe(true)
      if (result.isOk()) expect(result.value).toBe(true)
    })

    it('returns false for wrong password', async () => {
      vi.mocked(encryption.hashPassword).mockResolvedValueOnce('wrong-hash')

      const result = await service.verifyPassword('wrong')

      expect(result.isOk()).toBe(true)
      if (result.isOk()) expect(result.value).toBe(false)
    })
  })

  // ─── getMnemonic ───

  describe('getMnemonic', () => {
    beforeEach(async () => {
      await service.createWallet(TEST_MNEMONIC, 'pin1234')
    })

    it('returns mnemonic with correct password', async () => {
      const result = await service.getMnemonic('pin1234')

      expect(result.isOk()).toBe(true)
      if (result.isOk()) expect(result.value).toBe(TEST_MNEMONIC)
    })

    it('rejects wrong password', async () => {
      vi.mocked(encryption.hashPassword).mockResolvedValueOnce('wrong-hash')

      const result = await service.getMnemonic('wrong')

      expect(result.isErr()).toBe(true)
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
  })
})
