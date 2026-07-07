import type { EncryptedData } from './encryption.port'

export interface StoredWallet {
  encryptedMnemonic: EncryptedData
  passwordHash: string
  passwordSalt: string
  publicKey: string
  createdAt: number
  /** KDF 파라미터 세대. 부재 = 1 (PBKDF2-SHA256 100k, 기존 레코드). 2 = 600k. */
  kdfVersion?: number
}

export interface SecureStorage {
  getWallet(): Promise<StoredWallet | null>
  /**
   * wallet 과 함께 저장 세대 태그(opaque)를 반환 — `replaceWallet` 의 전제 조건(CAS)에 사용.
   * unlock/마이그레이션만 태그를 필요로 하므로 `getWallet()` 과 분리한다 (docs §9 NIT-1).
   */
  getWalletWithTag(): Promise<{ wallet: StoredWallet; tag: string } | null>
  saveWallet(wallet: StoredWallet): Promise<void>
  /**
   * `expectedTag` 가 현재 레코드의 태그와 일치할 때만 교체 (compare-and-swap).
   * 불일치·레코드 부재 → false (no-op). 원자적 단일 트랜잭션 (docs §6.2).
   */
  replaceWallet(next: StoredWallet, expectedTag: string): Promise<boolean>
  deleteWallet(): Promise<void>
}
