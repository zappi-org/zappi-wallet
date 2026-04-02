import { describe, it, expect } from 'vitest'
import { EncryptionAdapter } from '@/adapters/crypto/encryption.adapter'

const adapter = new EncryptionAdapter()

describe('EncryptionAdapter', () => {
  describe('encrypt → decrypt roundtrip', () => {
    it('encrypts and decrypts correctly', async () => {
      const plaintext = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about'
      const password = 'test-pin-1234'

      const encrypted = await adapter.encrypt(plaintext, password)

      expect(encrypted.ciphertext).toBeTruthy()
      expect(encrypted.salt).toHaveLength(32)  // 16 bytes hex
      expect(encrypted.iv).toHaveLength(24)    // 12 bytes hex

      const decrypted = await adapter.decrypt(encrypted, password)
      expect(decrypted).toBe(plaintext)
    })

    it('produces different ciphertext each time (random salt/iv)', async () => {
      const plaintext = 'test data'
      const password = 'password'

      const a = await adapter.encrypt(plaintext, password)
      const b = await adapter.encrypt(plaintext, password)

      expect(a.ciphertext).not.toBe(b.ciphertext)
      expect(a.salt).not.toBe(b.salt)
      expect(a.iv).not.toBe(b.iv)
    })

    it('fails with wrong password', async () => {
      const encrypted = await adapter.encrypt('secret', 'correct')

      await expect(adapter.decrypt(encrypted, 'wrong')).rejects.toThrow()
    })
  })

  describe('hashPassword', () => {
    it('produces deterministic hash', async () => {
      const hash1 = await adapter.hashPassword('pin1234', 'salt-abc')
      const hash2 = await adapter.hashPassword('pin1234', 'salt-abc')
      expect(hash1).toBe(hash2)
    })

    it('produces different hash for different passwords', async () => {
      const hash1 = await adapter.hashPassword('pin1234', 'salt')
      const hash2 = await adapter.hashPassword('pin5678', 'salt')
      expect(hash1).not.toBe(hash2)
    })

    it('produces different hash for different salts', async () => {
      const hash1 = await adapter.hashPassword('pin', 'salt-a')
      const hash2 = await adapter.hashPassword('pin', 'salt-b')
      expect(hash1).not.toBe(hash2)
    })

    it('returns 64-char hex string (256 bits)', async () => {
      const hash = await adapter.hashPassword('pin', 'salt')
      expect(hash).toHaveLength(64)
      expect(hash).toMatch(/^[0-9a-f]+$/)
    })
  })
})
