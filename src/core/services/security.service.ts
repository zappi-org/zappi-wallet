/**
 * SecurityService — 지갑 보안 오케스트레이터 (ZAP-141)
 *
 * KeyManager + Encryption + SecureStorage 포트를 조합.
 * 니모닉 생성, PIN 기반 암복호화, 잠금/해제, 비밀번호 변경.
 */

import type { KeyManager } from '@/core/ports/driven/key-manager.port'
import type { Encryption } from '@/core/ports/driven/encryption.port'
import type { SecureStorage, StoredWallet } from '@/core/ports/driven/secure-storage.port'
import type { SeedCache } from '@/core/ports/driven/seed-cache.port'
import type { KeyPair } from '@/core/domain/key-manager'
import type { SecurityUseCase, UnlockResult } from '@/core/ports/driving/security.usecase'
import { ok, err, type Result } from '@/core/types/result'
import { SecurityError } from '@/core/errors/security'

// ─── Service ───

export class SecurityService implements SecurityUseCase {
  private cachedKeys: KeyPair | null = null
  private cachedSeed: Uint8Array | null = null

  constructor(
    private readonly keyManager: KeyManager,
    private readonly encryption: Encryption,
    private readonly storage: SecureStorage,
    private readonly seedCache: SeedCache,
  ) {}

  // ─── Wallet lifecycle ───

  async hasWallet(): Promise<boolean> {
    const wallet = await this.storage.getWallet()
    return wallet !== null
  }

  async createWallet(
    mnemonic: string,
    password: string,
  ): Promise<Result<UnlockResult, SecurityError>> {
    try {
      if (!this.keyManager.validateMnemonic(mnemonic)) {
        return err(new SecurityError('INVALID_MNEMONIC', 'Invalid mnemonic phrase'))
      }

      const keys = this.keyManager.deriveNostrKeyPair(mnemonic)
      const bip39Seed = this.keyManager.deriveBip39Seed(mnemonic)

      const encryptedMnemonic = await this.encryption.encrypt(mnemonic, password)
      const passwordSalt = randomHex(16)
      const passwordHash = await this.encryption.hashPassword(password, passwordSalt)

      const wallet: StoredWallet = {
        encryptedMnemonic,
        passwordHash,
        passwordSalt,
        publicKey: keys.publicKey,
        createdAt: Date.now(),
      }

      await this.storage.saveWallet(wallet)

      this.cachedKeys = keys
      this.cachedSeed = bip39Seed
      this.seedCache.cacheMnemonic(mnemonic)

      return ok({ keys, bip39Seed })
    } catch (error) {
      return err(new SecurityError('CREATE_WALLET_FAILED', String(error)))
    }
  }

  async unlock(password: string): Promise<Result<UnlockResult, SecurityError>> {
    try {
      const wallet = await this.storage.getWallet()
      if (!wallet) {
        return err(new SecurityError('NO_WALLET', 'No wallet found'))
      }

      const passwordHash = await this.encryption.hashPassword(password, wallet.passwordSalt)
      if (!constantTimeEqual(passwordHash, wallet.passwordHash)) {
        return err(new SecurityError('INVALID_PASSWORD', 'Invalid password'))
      }

      const mnemonic = await this.encryption.decrypt(wallet.encryptedMnemonic, password)
      const keys = this.keyManager.deriveNostrKeyPair(mnemonic)
      const bip39Seed = this.keyManager.deriveBip39Seed(mnemonic)

      this.cachedKeys = keys
      this.cachedSeed = bip39Seed
      this.seedCache.cacheMnemonic(mnemonic)

      return ok({ keys, bip39Seed })
    } catch (error) {
      return err(new SecurityError('UNLOCK_FAILED', String(error)))
    }
  }

  async verifyPassword(password: string): Promise<Result<boolean, SecurityError>> {
    try {
      const wallet = await this.storage.getWallet()
      if (!wallet) {
        return err(new SecurityError('NO_WALLET', 'No wallet found'))
      }

      const passwordHash = await this.encryption.hashPassword(password, wallet.passwordSalt)
      return ok(constantTimeEqual(passwordHash, wallet.passwordHash))
    } catch (error) {
      return err(new SecurityError('VERIFY_FAILED', String(error)))
    }
  }

  async changePassword(
    oldPassword: string,
    newPassword: string,
  ): Promise<Result<void, SecurityError>> {
    try {
      const wallet = await this.storage.getWallet()
      if (!wallet) {
        return err(new SecurityError('NO_WALLET', 'No wallet found'))
      }

      const oldHash = await this.encryption.hashPassword(oldPassword, wallet.passwordSalt)
      if (!constantTimeEqual(oldHash, wallet.passwordHash)) {
        return err(new SecurityError('INVALID_PASSWORD', 'Invalid password'))
      }

      const mnemonic = await this.encryption.decrypt(wallet.encryptedMnemonic, oldPassword)
      const encryptedMnemonic = await this.encryption.encrypt(mnemonic, newPassword)
      const passwordSalt = randomHex(16)
      const passwordHash = await this.encryption.hashPassword(newPassword, passwordSalt)

      const updatedWallet: StoredWallet = {
        ...wallet,
        encryptedMnemonic,
        passwordHash,
        passwordSalt,
      }

      await this.storage.saveWallet(updatedWallet)
      return ok(undefined)
    } catch (error) {
      return err(new SecurityError('CHANGE_PASSWORD_FAILED', String(error)))
    }
  }

  async getMnemonic(password: string): Promise<Result<string, SecurityError>> {
    try {
      const wallet = await this.storage.getWallet()
      if (!wallet) {
        return err(new SecurityError('NO_WALLET', 'No wallet found'))
      }

      const passwordHash = await this.encryption.hashPassword(password, wallet.passwordSalt)
      if (!constantTimeEqual(passwordHash, wallet.passwordHash)) {
        return err(new SecurityError('INVALID_PASSWORD', 'Invalid password'))
      }

      const mnemonic = await this.encryption.decrypt(wallet.encryptedMnemonic, password)
      return ok(mnemonic)
    } catch (error) {
      return err(new SecurityError('GET_MNEMONIC_FAILED', String(error)))
    }
  }

  async deleteWallet(): Promise<void> {
    await this.storage.deleteWallet()
    this.cachedKeys = null
    this.cachedSeed = null
    this.seedCache.clearCache()
  }

  // ─── KeyManager delegates ───

  generateMnemonic(strength: 128 | 256 = 128): string {
    return this.keyManager.generateMnemonic(strength)
  }

  validateMnemonic(mnemonic: string): boolean {
    return this.keyManager.validateMnemonic(mnemonic)
  }

  // ─── Session cache ───

  getCachedKeys(): KeyPair | null {
    return this.cachedKeys
  }

  getCachedSeed(): Uint8Array | null {
    return this.cachedSeed
  }

  lock(): void {
    this.cachedKeys = null
    this.cachedSeed = null
    this.seedCache.clearCache()
  }
}

// ─── Helpers ───

function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let result = 0
  for (let i = 0; i < a.length; i++) {
    result |= a.charCodeAt(i) ^ b.charCodeAt(i)
  }
  return result === 0
}

function randomHex(bytes: number): string {
  const arr = crypto.getRandomValues(new Uint8Array(bytes))
  return Array.from(arr).map((b) => b.toString(16).padStart(2, '0')).join('')
}
