import type { KeyPair } from '@/core/domain/key-manager'
import type { Result } from '@/core/types/result'
import type { SecurityError } from '@/core/errors/security'

export interface UnlockResult {
  keys: KeyPair
  bip39Seed: Uint8Array
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
