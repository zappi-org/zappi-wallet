import { describe, it, expect, beforeEach } from 'vitest'
import { SecurityService } from '@/services/security/security.service'

describe('SecurityService', () => {
  let service: SecurityService

  beforeEach(() => {
    service = new SecurityService()
  })

  describe('generateMnemonic', () => {
    it('should generate a 12-word mnemonic by default', () => {
      const mnemonic = service.generateMnemonic()
      const words = mnemonic.split(' ')

      expect(words).toHaveLength(12)
    })

    it('should generate a 24-word mnemonic when specified', () => {
      const mnemonic = service.generateMnemonic(24)
      const words = mnemonic.split(' ')

      expect(words).toHaveLength(24)
    })

    it('should generate different mnemonics each time', () => {
      const m1 = service.generateMnemonic()
      const m2 = service.generateMnemonic()

      expect(m1).not.toBe(m2)
    })
  })

  describe('validateMnemonic', () => {
    it('should return true for valid 12-word mnemonic', () => {
      const mnemonic = service.generateMnemonic(12)
      const result = service.validateMnemonic(mnemonic)

      expect(result).toBe(true)
    })

    it('should return true for valid 24-word mnemonic', () => {
      const mnemonic = service.generateMnemonic(24)
      const result = service.validateMnemonic(mnemonic)

      expect(result).toBe(true)
    })

    it('should return false for invalid mnemonic', () => {
      const result = service.validateMnemonic('invalid mnemonic phrase')

      expect(result).toBe(false)
    })

    it('should return false for wrong word count', () => {
      const result = service.validateMnemonic('word1 word2 word3')

      expect(result).toBe(false)
    })
  })

  describe('deriveNostrKeys', () => {
    it('should derive consistent keys from same mnemonic', () => {
      const mnemonic = service.generateMnemonic()
      const keys1 = service.deriveNostrKeys(mnemonic)
      const keys2 = service.deriveNostrKeys(mnemonic)

      expect(keys1.privateKey).toBe(keys2.privateKey)
      expect(keys1.publicKey).toBe(keys2.publicKey)
    })

    it('should derive different keys from different mnemonics', () => {
      const mnemonic1 = service.generateMnemonic()
      const mnemonic2 = service.generateMnemonic()
      const keys1 = service.deriveNostrKeys(mnemonic1)
      const keys2 = service.deriveNostrKeys(mnemonic2)

      expect(keys1.privateKey).not.toBe(keys2.privateKey)
    })

    it('should return keys in hex format', () => {
      const mnemonic = service.generateMnemonic()
      const keys = service.deriveNostrKeys(mnemonic)

      expect(keys.privateKey).toMatch(/^[0-9a-f]{64}$/)
      expect(keys.publicKey).toMatch(/^[0-9a-f]{64}$/)
    })
  })

  describe('encrypt / decrypt', () => {
    it('should encrypt and decrypt data correctly', async () => {
      const password = 'test-password-123'
      const data = 'secret mnemonic phrase'

      const encrypted = await service.encrypt(data, password)
      const decrypted = await service.decrypt(encrypted, password)

      expect(decrypted).toBe(data)
    })

    it('should produce different ciphertext with different salt/iv', async () => {
      const password = 'test-password'
      const data = 'same data'

      const e1 = await service.encrypt(data, password)
      const e2 = await service.encrypt(data, password)

      expect(e1.encryptedData).not.toBe(e2.encryptedData)
    })

    it('should fail to decrypt with wrong password', async () => {
      const data = 'secret data'
      const encrypted = await service.encrypt(data, 'correct-password')

      await expect(
        service.decrypt(encrypted, 'wrong-password')
      ).rejects.toThrow()
    })
  })

  describe('hashPassword', () => {
    it('should produce consistent hash for same password and salt', async () => {
      const password = 'test-password'
      const salt = 'fixed-salt-value'

      const hash1 = await service.hashPassword(password, salt)
      const hash2 = await service.hashPassword(password, salt)

      expect(hash1).toBe(hash2)
    })

    it('should produce different hash for different passwords', async () => {
      const salt = 'same-salt'

      const hash1 = await service.hashPassword('password1', salt)
      const hash2 = await service.hashPassword('password2', salt)

      expect(hash1).not.toBe(hash2)
    })
  })

  describe('generateRandomBytes', () => {
    it('should generate bytes of specified length', () => {
      const bytes = service.generateRandomBytes(32)

      expect(bytes).toHaveLength(32)
    })

    it('should generate different bytes each time', () => {
      const b1 = service.generateRandomBytes(16)
      const b2 = service.generateRandomBytes(16)

      expect(b1).not.toEqual(b2)
    })
  })

  describe('bytesToHex / hexToBytes', () => {
    it('should convert bytes to hex and back', () => {
      const original = new Uint8Array([1, 2, 3, 255, 0, 128])
      const hex = service.bytesToHex(original)
      const back = service.hexToBytes(hex)

      expect(back).toEqual(original)
    })
  })
})
