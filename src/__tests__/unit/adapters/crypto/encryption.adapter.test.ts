import { describe, it, expect } from 'vitest'
import { EncryptionAdapter } from '@/adapters/crypto/encryption.adapter'

const adapter = new EncryptionAdapter()

// 반복수는 이제 인자다 (정책은 서비스 층 소유). 아래 기존 계약 테스트는 v1 반복수로 고정 실행한다.
const V1_ITER = 100_000
const V2_ITER = 600_000

describe('EncryptionAdapter', () => {
  describe('encrypt → decrypt roundtrip', () => {
    it('encrypts and decrypts correctly', async () => {
      const plaintext = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about'
      const password = 'test-pin-1234'

      const encrypted = await adapter.encrypt(plaintext, password, V1_ITER)

      expect(encrypted.ciphertext).toBeTruthy()
      expect(encrypted.salt).toHaveLength(32)  // 16 bytes hex
      expect(encrypted.iv).toHaveLength(24)    // 12 bytes hex

      const decrypted = await adapter.decrypt(encrypted, password, V1_ITER)
      expect(decrypted).toBe(plaintext)
    })

    it('produces different ciphertext each time (random salt/iv)', async () => {
      const plaintext = 'test data'
      const password = 'password'

      const a = await adapter.encrypt(plaintext, password, V1_ITER)
      const b = await adapter.encrypt(plaintext, password, V1_ITER)

      expect(a.ciphertext).not.toBe(b.ciphertext)
      expect(a.salt).not.toBe(b.salt)
      expect(a.iv).not.toBe(b.iv)
    })

    it('fails with wrong password', async () => {
      const encrypted = await adapter.encrypt('secret', 'correct', V1_ITER)

      await expect(adapter.decrypt(encrypted, 'wrong', V1_ITER)).rejects.toThrow()
    })

    it('fails to decrypt with mismatched iterations (key is iteration-bound)', async () => {
      // v1 반복수로 봉인한 암호문을 v2 반복수로 열면 키가 달라 복호 실패해야 한다.
      const encrypted = await adapter.encrypt('secret', 'pw', V1_ITER)
      await expect(adapter.decrypt(encrypted, 'pw', V2_ITER)).rejects.toThrow()
    })
  })

  describe('hashPassword', () => {
    it('produces deterministic hash', async () => {
      const hash1 = await adapter.hashPassword('pin1234', 'salt-abc', V1_ITER)
      const hash2 = await adapter.hashPassword('pin1234', 'salt-abc', V1_ITER)
      expect(hash1).toBe(hash2)
    })

    it('produces different hash for different passwords', async () => {
      const hash1 = await adapter.hashPassword('pin1234', 'salt', V1_ITER)
      const hash2 = await adapter.hashPassword('pin5678', 'salt', V1_ITER)
      expect(hash1).not.toBe(hash2)
    })

    it('produces different hash for different salts', async () => {
      const hash1 = await adapter.hashPassword('pin', 'salt-a', V1_ITER)
      const hash2 = await adapter.hashPassword('pin', 'salt-b', V1_ITER)
      expect(hash1).not.toBe(hash2)
    })

    it('returns 64-char hex string (256 bits)', async () => {
      const hash = await adapter.hashPassword('pin', 'salt', V1_ITER)
      expect(hash).toHaveLength(64)
      expect(hash).toMatch(/^[0-9a-f]+$/)
    })

    it('same input + different iterations → different hash', async () => {
      const hV1 = await adapter.hashPassword('pin1234', 'salt-abc', V1_ITER)
      const hV2 = await adapter.hashPassword('pin1234', 'salt-abc', V2_ITER)
      expect(hV1).not.toBe(hV2)
      expect(hV1).toHaveLength(64)
      expect(hV2).toHaveLength(64)
    })
  })

  // v1 의미 드리프트 회귀선 (§8-1): 100k 로 생성해 둔 고정 세트가 영원히 검증/복호 성공해야 한다.
  // salt 특이점(§1.3 — hex 문자열을 그대로 인코딩)까지 포함해 v1 의미를 박제한다.
  // 이 벡터가 깨지면 배포된 v1 레코드가 전부 복구 불능이 된다는 뜻이므로 절대 갱신 금지.
  describe('v1 pinned vector (frozen — never regenerate)', () => {
    const V1 = {
      password: 'pin1234',
      saltHex: 'a1b2c3d4e5f60718293a4b5c6d7e8f90',
      expectedHash: 'c103dbd236452f28a11d54a34fbeeacfd97d037cb558e97afad1cbc711c1cd8f',
      mnemonic: 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about',
      encrypted: {
        ciphertext: 'xz0Xz++tBnfWMiUest78bT5MBxwiXhyNOQIfDe5+wtPT22D9wqqt1vMD5zos1k7Lp7p3iUCOKyYmdN7JpgK2fAKCUFTVPFxP5mDtcFeYpXfCpWuzthQozvjhncS+qQn0ZZyzNStlHxJexUfV+Q==',
        salt: '694da445433a6c44bd16204146f4154d',
        iv: '4e690f69657920354f24cc30',
      },
    }

    it('hashPassword @100k reproduces the pinned verifier hash', async () => {
      const hash = await adapter.hashPassword(V1.password, V1.saltHex, V1_ITER)
      expect(hash).toBe(V1.expectedHash)
    })

    it('decrypt @100k recovers the pinned mnemonic', async () => {
      const decrypted = await adapter.decrypt(V1.encrypted, V1.password, V1_ITER)
      expect(decrypted).toBe(V1.mnemonic)
    })
  })
})
