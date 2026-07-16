import type { EncryptedData } from './encryption.port'

export interface StoredWallet {
  encryptedMnemonic: EncryptedData
  passwordHash: string
  passwordSalt: string
  publicKey: string
  createdAt: number
  /** KDF parameter generation. Absent = 1 (PBKDF2-SHA256 100k, legacy records). 2 = 600k. */
  kdfVersion?: number
}

export interface SecureStorage {
  getWallet(): Promise<StoredWallet | null>
  /**
   * Returns the wallet along with an opaque storage-generation tag — used as the
   * precondition (CAS) for `replaceWallet`. Kept separate from `getWallet()` because
   * only unlock/migration need the tag.
   */
  getWalletWithTag(): Promise<{ wallet: StoredWallet; tag: string } | null>
  saveWallet(wallet: StoredWallet): Promise<void>
  /**
   * Replaces only when `expectedTag` matches the current record's tag (compare-and-swap).
   * Mismatch or missing record → false (no-op). Atomic single transaction.
   */
  replaceWallet(next: StoredWallet, expectedTag: string): Promise<boolean>
  deleteWallet(): Promise<void>
}
