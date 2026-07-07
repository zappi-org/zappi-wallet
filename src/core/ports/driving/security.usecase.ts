import type { KeyPair } from '@/core/domain/key-manager'
import type { Result } from '@/core/domain/result'
import type { SecurityError } from '@/core/errors/security'

export interface UnlockResult {
  keys: KeyPair
  bip39Seed: Uint8Array
  /**
   * 이 unlock 이 KDF 재암호화 마이그레이션을 수행했는가.
   * true → UI 층이 타 탭 reload(broadcast) + 거짓 lockout 소거를 트리거한다 (docs §6.4 R1).
   */
  migrated?: boolean
}

export interface SecurityUseCase {
  hasWallet(): Promise<boolean>

  createWallet(
    mnemonic: string,
    password: string,
  ): Promise<Result<UnlockResult, SecurityError>>

  unlock(password: string): Promise<Result<UnlockResult, SecurityError>>

  verifyPassword(password: string): Promise<Result<boolean, SecurityError>>

  changePassword(
    oldPassword: string,
    newPassword: string,
  ): Promise<Result<void, SecurityError>>

  getMnemonic(password: string): Promise<Result<string, SecurityError>>

  deleteWallet(): Promise<void>

  generateMnemonic(strength?: 128 | 256): string
  validateMnemonic(mnemonic: string): boolean

  /** Session cache */
  getCachedKeys(): KeyPair | null
  getCachedSeed(): Uint8Array | null
  lock(): void
}
