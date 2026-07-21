import type { KeyPair } from '@/core/domain/key-manager'
import type { Result } from '@/core/domain/result'
import type { SecurityError } from '@/core/errors/security'

export interface UnlockResult {
  keys: KeyPair
  bip39Seed: Uint8Array
  /**
   * Whether this unlock performed a KDF re-encryption migration.
   * true → the UI layer triggers an other-tab reload (broadcast) + clears a false lockout.
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

  // ─── Unlock grace (PIN-free reload resume) ───

  /**
   * Resume a still-valid grace session without a PIN. Returns the same
   * UnlockResult shape as unlock() (migrated=false — grace never migrates KDF),
   * or null when there's no live grace. Failures fall back to null (→ PIN).
   */
  tryResumeSession(): Promise<UnlockResult | null>
  /** Persist grace for the current (unlocked) session with the given expiry. */
  saveGrace(expiresAt: number): Promise<void>
  /** Atomically refresh grace expiry (non-creating heartbeat). */
  extendGrace(expiresAt: number): Promise<void>
  /** Invalidate grace without touching the in-memory session (lockout entry). */
  clearGrace(): Promise<void>
}
