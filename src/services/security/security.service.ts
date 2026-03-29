import { generateMnemonic, validateMnemonic, mnemonicToSeedSync } from '@scure/bip39'
import { wordlist } from '@scure/bip39/wordlists/english.js'
import { HDKey } from '@scure/bip32'
import { bytesToHex, hexToBytes } from '@noble/hashes/utils.js'
import { getPublicKey } from 'nostr-tools'
import { NIP06_DERIVATION_PATH } from '@/core/constants'
import { ok, err, type Result } from '@/core/types'
import type { BaseError } from '@/core/errors'
import { SecurityError } from '@/core/errors'

// Storage keys
const WALLET_STORAGE_KEY = 'zappi_encrypted_wallet'
const PASSWORD_HASH_KEY = 'zappi_password_hash'

/**
 * Encrypted data container
 */
export interface EncryptedData {
  encryptedData: string // Base64 encoded
  salt: string // Hex encoded
  iv: string // Hex encoded
}

/**
 * Nostr key pair
 */
export interface NostrKeyPair {
  privateKey: string // Hex encoded
  publicKey: string // Hex encoded
}

/**
 * Stored wallet data
 */
interface StoredWallet {
  encryptedMnemonic: EncryptedData
  passwordHash: string
  passwordSalt: string
  publicKey: string
  createdAt: number
}

/**
 * Service for security operations:
 * - Mnemonic generation and validation (BIP-39)
 * - Key derivation (NIP-06)
 * - Password-based encryption (AES-256-GCM)
 */
export class SecurityService {
  /**
   * Generate a new BIP-39 mnemonic
   * @param wordCount 12 or 24 words
   */
  generateMnemonic(wordCount: 12 | 24 = 12): string {
    const strength = wordCount === 12 ? 128 : 256
    return generateMnemonic(wordlist, strength)
  }

  /**
   * Validate a BIP-39 mnemonic
   */
  validateMnemonic(mnemonic: string): boolean {
    return validateMnemonic(mnemonic, wordlist)
  }

  /**
   * Derive Nostr keys from mnemonic using NIP-06 derivation path
   */
  deriveNostrKeys(mnemonic: string): NostrKeyPair {
    const seed = mnemonicToSeedSync(mnemonic)
    const hdKey = HDKey.fromMasterSeed(seed)
    const derivedKey = hdKey.derive(NIP06_DERIVATION_PATH)

    if (!derivedKey.privateKey) {
      throw new Error('Failed to derive private key')
    }

    const privateKeyHex = bytesToHex(derivedKey.privateKey)
    const publicKeyHex = getPublicKey(derivedKey.privateKey)

    return {
      privateKey: privateKeyHex,
      publicKey: publicKeyHex,
    }
  }

  /**
   * Encrypt data with password using AES-256-GCM
   */
  async encrypt(data: string, password: string): Promise<EncryptedData> {
    const salt = this.generateRandomBytes(16)
    const iv = this.generateRandomBytes(12)

    const key = await this.deriveKey(password, salt)
    const encoder = new TextEncoder()
    const encoded = encoder.encode(data)

    const encrypted = await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv: new Uint8Array(iv) },
      key,
      encoded
    )

    return {
      encryptedData: this.arrayBufferToBase64(encrypted),
      salt: bytesToHex(salt),
      iv: bytesToHex(iv),
    }
  }

  /**
   * Decrypt data with password
   */
  async decrypt(encrypted: EncryptedData, password: string): Promise<string> {
    const salt = hexToBytes(encrypted.salt)
    const iv = hexToBytes(encrypted.iv)
    const encryptedBytes = new Uint8Array(this.base64ToArrayBuffer(encrypted.encryptedData))

    const key = await this.deriveKey(password, salt)

    const decrypted = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: new Uint8Array(iv) },
      key,
      encryptedBytes
    )

    const decoder = new TextDecoder()
    return decoder.decode(decrypted)
  }

  /**
   * Hash password with salt using PBKDF2
   */
  async hashPassword(password: string, salt: string): Promise<string> {
    const encoder = new TextEncoder()
    const keyMaterial = await crypto.subtle.importKey(
      'raw',
      encoder.encode(password),
      'PBKDF2',
      false,
      ['deriveBits']
    )

    const bits = await crypto.subtle.deriveBits(
      {
        name: 'PBKDF2',
        salt: encoder.encode(salt),
        iterations: 100000,
        hash: 'SHA-256',
      },
      keyMaterial,
      256
    )

    return bytesToHex(new Uint8Array(bits))
  }

  /**
   * Constant-time string comparison to prevent timing attacks.
   * Always compares all bytes regardless of where differences are.
   */
  private constantTimeEqual(a: string, b: string): boolean {
    if (a.length !== b.length) return false
    let result = 0
    for (let i = 0; i < a.length; i++) {
      result |= a.charCodeAt(i) ^ b.charCodeAt(i)
    }
    return result === 0
  }

  /**
   * Generate cryptographically secure random bytes
   */
  generateRandomBytes(length: number): Uint8Array {
    return crypto.getRandomValues(new Uint8Array(length))
  }

  /**
   * Convert bytes to hex string
   */
  bytesToHex(bytes: Uint8Array): string {
    return bytesToHex(bytes)
  }

  /**
   * Convert hex string to bytes
   */
  hexToBytes(hex: string): Uint8Array {
    return hexToBytes(hex)
  }

  // ===== Wallet Persistence =====

  /**
   * Check if an encrypted wallet exists
   */
  async hasEncryptedWallet(): Promise<boolean> {
    const stored = localStorage.getItem(WALLET_STORAGE_KEY)
    return stored !== null
  }

  /**
   * Create and store a new wallet
   */
  async createWallet(
    mnemonic: string,
    password: string
  ): Promise<Result<NostrKeyPair, BaseError>> {
    try {
      // Validate mnemonic
      if (!this.validateMnemonic(mnemonic)) {
        return err(new SecurityError('INVALID_MNEMONIC', 'Invalid mnemonic phrase'))
      }

      // Derive keys
      const keys = this.deriveNostrKeys(mnemonic)

      // Encrypt mnemonic
      const encryptedMnemonic = await this.encrypt(mnemonic, password)

      // Hash password for verification
      const passwordSalt = bytesToHex(this.generateRandomBytes(16))
      const passwordHash = await this.hashPassword(password, passwordSalt)

      // Store wallet
      const wallet: StoredWallet = {
        encryptedMnemonic,
        passwordHash,
        passwordSalt,
        publicKey: keys.publicKey,
        createdAt: Date.now(),
      }

      localStorage.setItem(WALLET_STORAGE_KEY, JSON.stringify(wallet))
      localStorage.setItem(PASSWORD_HASH_KEY, JSON.stringify({ passwordHash, passwordSalt }))

      // Store keys in session for use during this session
      this.cachedKeys = keys

      return ok(keys)
    } catch (error) {
      return err(new SecurityError('CREATE_WALLET_FAILED', String(error)))
    }
  }

  /**
   * Unlock wallet with password
   */
  async unlock(password: string): Promise<Result<NostrKeyPair, BaseError>> {
    try {
      const stored = localStorage.getItem(WALLET_STORAGE_KEY)
      if (!stored) {
        return err(new SecurityError('NO_WALLET', 'No wallet found'))
      }

      const wallet: StoredWallet = JSON.parse(stored)

      // Verify password (constant-time comparison to prevent timing attacks)
      const passwordHash = await this.hashPassword(password, wallet.passwordSalt)
      if (!this.constantTimeEqual(passwordHash, wallet.passwordHash)) {
        return err(new SecurityError('INVALID_PASSWORD', 'Invalid password'))
      }

      // Decrypt mnemonic and derive keys
      const mnemonic = await this.decrypt(wallet.encryptedMnemonic, password)
      const keys = this.deriveNostrKeys(mnemonic)

      // Cache keys for this session
      this.cachedKeys = keys

      return ok(keys)
    } catch (error) {
      return err(new SecurityError('UNLOCK_FAILED', String(error)))
    }
  }

  /**
   * Verify password without unlocking
   */
  async verifyPassword(password: string): Promise<Result<boolean, BaseError>> {
    try {
      const stored = localStorage.getItem(WALLET_STORAGE_KEY)
      if (!stored) {
        return err(new SecurityError('NO_WALLET', 'No wallet found'))
      }

      const wallet: StoredWallet = JSON.parse(stored)
      const passwordHash = await this.hashPassword(password, wallet.passwordSalt)

      return ok(this.constantTimeEqual(passwordHash, wallet.passwordHash))
    } catch (error) {
      return err(new SecurityError('VERIFY_FAILED', String(error)))
    }
  }

  /**
   * Change wallet password
   */
  async changePassword(
    oldPassword: string,
    newPassword: string
  ): Promise<Result<void, BaseError>> {
    try {
      const stored = localStorage.getItem(WALLET_STORAGE_KEY)
      if (!stored) {
        return err(new SecurityError('NO_WALLET', 'No wallet found'))
      }

      const wallet: StoredWallet = JSON.parse(stored)

      // Verify old password (constant-time comparison to prevent timing attacks)
      const oldHash = await this.hashPassword(oldPassword, wallet.passwordSalt)
      if (!this.constantTimeEqual(oldHash, wallet.passwordHash)) {
        return err(new SecurityError('INVALID_PASSWORD', 'Invalid password'))
      }

      // Decrypt mnemonic with old password
      const mnemonic = await this.decrypt(wallet.encryptedMnemonic, oldPassword)

      // Re-encrypt with new password
      const encryptedMnemonic = await this.encrypt(mnemonic, newPassword)

      // New password hash
      const passwordSalt = bytesToHex(this.generateRandomBytes(16))
      const passwordHash = await this.hashPassword(newPassword, passwordSalt)

      // Update stored wallet
      const updatedWallet: StoredWallet = {
        ...wallet,
        encryptedMnemonic,
        passwordHash,
        passwordSalt,
      }

      localStorage.setItem(WALLET_STORAGE_KEY, JSON.stringify(updatedWallet))
      localStorage.setItem(PASSWORD_HASH_KEY, JSON.stringify({ passwordHash, passwordSalt }))

      return ok(undefined)
    } catch (error) {
      return err(new SecurityError('CHANGE_PASSWORD_FAILED', String(error)))
    }
  }

  /**
   * Get mnemonic (requires password)
   */
  async getMnemonic(password: string): Promise<Result<string, BaseError>> {
    try {
      const stored = localStorage.getItem(WALLET_STORAGE_KEY)
      if (!stored) {
        return err(new SecurityError('NO_WALLET', 'No wallet found'))
      }

      const wallet: StoredWallet = JSON.parse(stored)

      // Verify password (constant-time comparison to prevent timing attacks)
      const passwordHash = await this.hashPassword(password, wallet.passwordSalt)
      if (!this.constantTimeEqual(passwordHash, wallet.passwordHash)) {
        return err(new SecurityError('INVALID_PASSWORD', 'Invalid password'))
      }

      const mnemonic = await this.decrypt(wallet.encryptedMnemonic, password)
      return ok(mnemonic)
    } catch (error) {
      return err(new SecurityError('GET_MNEMONIC_FAILED', String(error)))
    }
  }

  /**
   * Delete wallet and all data
   */
  async deleteWallet(): Promise<void> {
    localStorage.removeItem(WALLET_STORAGE_KEY)
    localStorage.removeItem(PASSWORD_HASH_KEY)
    this.cachedKeys = null
  }

  /**
   * Get cached keys (only available after unlock)
   */
  getCachedKeys(): NostrKeyPair | null {
    return this.cachedKeys
  }

  // Cached keys for current session
  private cachedKeys: NostrKeyPair | null = null

  // ===== Private Helpers =====

  /**
   * Derive AES key from password using PBKDF2
   */
  private async deriveKey(
    password: string,
    salt: Uint8Array
  ): Promise<CryptoKey> {
    const encoder = new TextEncoder()
    const keyMaterial = await crypto.subtle.importKey(
      'raw',
      encoder.encode(password),
      'PBKDF2',
      false,
      ['deriveKey']
    )

    return crypto.subtle.deriveKey(
      {
        name: 'PBKDF2',
        salt: new Uint8Array(salt),
        iterations: 100000,
        hash: 'SHA-256',
      },
      keyMaterial,
      { name: 'AES-GCM', length: 256 },
      false,
      ['encrypt', 'decrypt']
    )
  }

  /**
   * Convert ArrayBuffer to Base64 string
   */
  private arrayBufferToBase64(buffer: ArrayBuffer): string {
    const bytes = new Uint8Array(buffer)
    let binary = ''
    for (let i = 0; i < bytes.length; i++) {
      binary += String.fromCharCode(bytes[i])
    }
    return btoa(binary)
  }

  /**
   * Convert Base64 string to ArrayBuffer
   */
  private base64ToArrayBuffer(base64: string): ArrayBuffer {
    const binary = atob(base64)
    const bytes = new Uint8Array(binary.length)
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i)
    }
    return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)
  }
}
