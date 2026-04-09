import type { EncryptedData } from './encryption.port'

export interface StoredWallet {
  encryptedMnemonic: EncryptedData
  passwordHash: string
  passwordSalt: string
  publicKey: string
  createdAt: number
}

export interface SecureStorage {
  getWallet(): Promise<StoredWallet | null>
  saveWallet(wallet: StoredWallet): Promise<void>
  deleteWallet(): Promise<void>
}
