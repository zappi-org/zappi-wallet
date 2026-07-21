/**
 * SecurityService — wallet security orchestrator.
 *
 * Composes the KeyManager, Encryption, and SecureStorage ports:
 * mnemonic generation, PIN-based encryption/decryption, lock/unlock, and password change.
 */

import type { KeyManager } from '@/core/ports/driven/key-manager.port'
import type { Encryption } from '@/core/ports/driven/encryption.port'
import type { SecureStorage, StoredWallet } from '@/core/ports/driven/secure-storage.port'
import type { SeedCache } from '@/core/ports/driven/seed-cache.port'
import type { UnlockGrace } from '@/core/ports/driven/unlock-grace.port'
import type { KeyPair } from '@/core/domain/key-manager'
import type { SecurityUseCase, UnlockResult } from '@/core/ports/driving/security.usecase'
import { Ok, Err, type Result } from '@/core/domain/result'
import { SecurityError } from '@/core/errors/security'

// ─── KDF generation policy ───
// The service layer owns the version→iterations map; adapters just execute with the given count.
const KDF_ITERATIONS: Record<number, number> = { 1: 100_000, 2: 600_000 }
const CURRENT_KDF_VERSION = 2
// Known versions the verifyAgainstRecord fallback iterates; an unknown declared version demotes to this set.
const KNOWN_VERSIONS = [1, 2]

// ─── Service ───

export class SecurityService implements SecurityUseCase {
  private cachedKeys: KeyPair | null = null
  private cachedSeed: Uint8Array | null = null

  constructor(
    private readonly keyManager: KeyManager,
    private readonly encryption: Encryption,
    private readonly storage: SecureStorage,
    private readonly seedCache: SeedCache,
    private readonly grace: UnlockGrace,
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
        return Err(new SecurityError('INVALID_MNEMONIC', 'Invalid mnemonic phrase'))
      }

      const keys = this.keyManager.deriveNostrKeyPair(mnemonic)
      const bip39Seed = this.keyManager.deriveBip39Seed(mnemonic)

      // New wallets are always written at the CURRENT version.
      const iterations = KDF_ITERATIONS[CURRENT_KDF_VERSION]
      const encryptedMnemonic = await this.encryption.encrypt(mnemonic, password, iterations)
      const passwordSalt = randomHex(16)
      const passwordHash = await this.encryption.hashPassword(password, passwordSalt, iterations)

      const wallet: StoredWallet = {
        encryptedMnemonic,
        passwordHash,
        passwordSalt,
        publicKey: keys.publicKey,
        createdAt: Date.now(),
        kdfVersion: CURRENT_KDF_VERSION,
      }

      await this.storage.saveWallet(wallet)

      this.cachedKeys = keys
      this.cachedSeed = bip39Seed
      this.seedCache.cacheMnemonic(mnemonic)

      return Ok({ keys, bip39Seed })
    } catch (error) {
      return Err(new SecurityError('CREATE_WALLET_FAILED', String(error)))
    }
  }

  async unlock(password: string): Promise<Result<UnlockResult, SecurityError>> {
    try {
      // Read with the tag — the CAS precondition for migration. Absent → NO_WALLET
      // (preserves the half-wipe rescue path).
      const rec = await this.storage.getWalletWithTag()
      if (!rec) {
        return Err(new SecurityError('NO_WALLET', 'No wallet found'))
      }
      const { wallet, tag } = rec

      // Try the declared version first, then fall back through all known versions. Wrong PIN → null → INVALID_PASSWORD.
      const match = await this.verifyAgainstRecord(wallet, password)
      if (!match) {
        return Err(new SecurityError('INVALID_PASSWORD', 'Invalid password'))
      }

      const mnemonic = await this.encryption.decrypt(
        wallet.encryptedMnemonic,
        password,
        KDF_ITERATIONS[match.version],
      )
      const { keys, bip39Seed } = this.hydrateSession(mnemonic)

      // Migrate when the record is an old version (matched != CURRENT) or corrupt (declared != matched).
      // Failure is non-fatal — unlock still succeeds, the record stays intact and is retried next unlock.
      let migrated = false
      const declared = wallet.kdfVersion ?? 1
      if (match.version !== CURRENT_KDF_VERSION || declared !== match.version) {
        try {
          migrated = await this.migrateRecord(wallet, tag, password, mnemonic)
        } catch (error) {
          console.error('[Security] KDF migration failed — retrying next unlock:', error)
        }
      }

      return Ok({ keys, bip39Seed, migrated })
    } catch (error) {
      return Err(new SecurityError('UNLOCK_FAILED', String(error)))
    }
  }

  async verifyPassword(password: string): Promise<Result<boolean, SecurityError>> {
    try {
      const wallet = await this.storage.getWallet()
      if (!wallet) {
        return Err(new SecurityError('NO_WALLET', 'No wallet found'))
      }

      // Version-aware verification (read-only, no write). Correct for both v1 and v2 records.
      const match = await this.verifyAgainstRecord(wallet, password)
      return Ok(match !== null)
    } catch (error) {
      return Err(new SecurityError('VERIFY_FAILED', String(error)))
    }
  }

  async changePassword(
    oldPassword: string,
    newPassword: string,
  ): Promise<Result<void, SecurityError>> {
    try {
      const wallet = await this.storage.getWallet()
      if (!wallet) {
        return Err(new SecurityError('NO_WALLET', 'No wallet found'))
      }

      // Verify the old password version-aware (read), but always rewrite at CURRENT —
      // a v1-record user is naturally upgraded the moment they change their PIN.
      const match = await this.verifyAgainstRecord(wallet, oldPassword)
      if (!match) {
        return Err(new SecurityError('INVALID_PASSWORD', 'Invalid password'))
      }

      const mnemonic = await this.encryption.decrypt(
        wallet.encryptedMnemonic,
        oldPassword,
        KDF_ITERATIONS[match.version],
      )
      const iterations = KDF_ITERATIONS[CURRENT_KDF_VERSION]
      const encryptedMnemonic = await this.encryption.encrypt(mnemonic, newPassword, iterations)
      const passwordSalt = randomHex(16)
      const passwordHash = await this.encryption.hashPassword(newPassword, passwordSalt, iterations)

      const updatedWallet: StoredWallet = {
        ...wallet,
        encryptedMnemonic,
        passwordHash,
        passwordSalt,
        kdfVersion: CURRENT_KDF_VERSION,
      }

      // Skipping CAS is intentional — changePassword is a post-unlock manual action that always
      // writes a complete CURRENT record, so a racing migration's CAS is skipped on tag mismatch
      // and the mnemonic is preserved regardless of ordering.
      await this.storage.saveWallet(updatedWallet)
      return Ok(undefined)
    } catch (error) {
      return Err(new SecurityError('CHANGE_PASSWORD_FAILED', String(error)))
    }
  }

  async getMnemonic(password: string): Promise<Result<string, SecurityError>> {
    try {
      const wallet = await this.storage.getWallet()
      if (!wallet) {
        return Err(new SecurityError('NO_WALLET', 'No wallet found'))
      }

      // Version-aware verification, then decrypt with the matched version (read-only, no write).
      const match = await this.verifyAgainstRecord(wallet, password)
      if (!match) {
        return Err(new SecurityError('INVALID_PASSWORD', 'Invalid password'))
      }

      const mnemonic = await this.encryption.decrypt(
        wallet.encryptedMnemonic,
        password,
        KDF_ITERATIONS[match.version],
      )
      return Ok(mnemonic)
    } catch (error) {
      return Err(new SecurityError('GET_MNEMONIC_FAILED', String(error)))
    }
  }

  async deleteWallet(): Promise<void> {
    // Grace holds a PIN-free decryptable mnemonic copy — drop it before the
    // wallet record so deleting a wallet can never leave a resumable session.
    await this.grace.clear()
    await this.storage.deleteWallet()
    this.cachedKeys = null
    this.cachedSeed = null
    this.seedCache.clearCache()
  }

  // ─── KDF version-aware verification · migration ───

  /**
   * Try the declared version first, then iterate the remaining known versions (self-healing).
   * Returns the version that actually matched, or null on a wrong password. An unknown declared
   * version (a future record) is demoted to iterate all KNOWN_VERSIONS (newest first) so a
   * KDF_ITERATIONS[unknown] lookup can't break it.
   */
  private async verifyAgainstRecord(
    wallet: StoredWallet,
    password: string,
  ): Promise<{ version: number } | null> {
    const declared = wallet.kdfVersion ?? 1
    const order = KNOWN_VERSIONS.includes(declared)
      ? [declared, ...KNOWN_VERSIONS.filter((v) => v !== declared)]
      : [...KNOWN_VERSIONS].reverse()
    for (const version of order) {
      const hash = await this.encryption.hashPassword(
        password,
        wallet.passwordSalt,
        KDF_ITERATIONS[version],
      )
      if (constantTimeEqual(hash, wallet.passwordHash)) return { version }
    }
    return null
  }

  /**
   * Atomically rewrite the record's two KDF fields (encryptedMnemonic + passwordHash) at the
   * CURRENT iteration count. Returns true on put success, false on CAS miss or readback failure;
   * throws are handled non-fatally by the caller (unlock).
   *
   * Two-way readback: the ciphertext being written replaces the only copy of the mnemonic, so
   * before writing we cross-check both outputs against values freshly derived with the CURRENT
   * constant — (a) mnemonic roundtrip, (b) hash roundtrip. If either mismatches we skip the put,
   * guarding against the "opening your own output with your own parameters" blind spot.
   */
  private async migrateRecord(
    wallet: StoredWallet,
    tag: string,
    password: string,
    mnemonic: string,
  ): Promise<boolean> {
    const iterations = KDF_ITERATIONS[CURRENT_KDF_VERSION]

    // 1. Re-derive both fields at the CURRENT iteration count.
    const encryptedMnemonic = await this.encryption.encrypt(mnemonic, password, iterations)
    const passwordSalt = randomHex(16)
    const passwordHash = await this.encryption.hashPassword(password, passwordSalt, iterations)

    // 2. Two-way readback — re-derive with the CURRENT constant and cross-check.
    const roundtripMnemonic = await this.encryption.decrypt(
      encryptedMnemonic,
      password,
      KDF_ITERATIONS[CURRENT_KDF_VERSION],
    )
    const roundtripHash = await this.encryption.hashPassword(
      password,
      passwordSalt,
      KDF_ITERATIONS[CURRENT_KDF_VERSION],
    )
    if (roundtripMnemonic !== mnemonic || !constantTimeEqual(roundtripHash, passwordHash)) {
      return false // self-output mismatch — skip the put (record stays intact, retried next unlock)
    }

    // 3. Single-record CAS swap; mismatch or absence → false (no-op).
    const next: StoredWallet = {
      ...wallet,
      encryptedMnemonic,
      passwordHash,
      passwordSalt,
      kdfVersion: CURRENT_KDF_VERSION,
    }
    return this.storage.replaceWallet(next, tag)
  }

  // ─── KeyManager delegates ───

  generateMnemonic(strength: 128 | 256 = 128): string {
    return this.keyManager.generateMnemonic(strength)
  }

  validateMnemonic(mnemonic: string): boolean {
    return this.keyManager.validateMnemonic(mnemonic)
  }

  // ─── Session cache ───

  /**
   * Derive keys/seed from a mnemonic and populate every session cache (Coco's
   * getSeed reads seedCache). Shared by unlock() and tryResumeSession() so both
   * paths produce an identical live session.
   */
  private hydrateSession(mnemonic: string): UnlockResult {
    const keys = this.keyManager.deriveNostrKeyPair(mnemonic)
    const bip39Seed = this.keyManager.deriveBip39Seed(mnemonic)
    this.cachedKeys = keys
    this.cachedSeed = bip39Seed
    this.seedCache.cacheMnemonic(mnemonic)
    return { keys, bip39Seed }
  }

  getCachedKeys(): KeyPair | null {
    return this.cachedKeys
  }

  getCachedSeed(): Uint8Array | null {
    return this.cachedSeed
  }

  async lock(): Promise<void> {
    // Wipe in-memory secrets synchronously (before the first await) so the session
    // is dead the instant lock() is called, independent of the grace clear.
    this.cachedKeys = null
    this.cachedSeed = null
    this.seedCache.clearCache()
    // Idle lock must invalidate the PIN-free grace copy before the UI reveals the
    // LockScreen. Awaited so the caller can order setLocked after the blob is gone;
    // a clear failure still locks (fail toward locked) with the error logged. The
    // non-creating extend() plus this clear keep a racing heartbeat from reviving it.
    try {
      await this.grace.clear()
    } catch (e) {
      console.error('[Security] Grace clear on lock failed:', e)
    }
  }

  // ─── Unlock grace ───

  async tryResumeSession(): Promise<UnlockResult | null> {
    try {
      const session = await this.grace.load()
      if (!session) return null
      // Resume without PIN — the live grace blob vouches for a recent unlock. No
      // KDF migration here; that only runs on a real PIN unlock.
      return this.hydrateSession(session.mnemonic)
    } catch (error) {
      console.error('[Security] Grace resume failed — falling back to PIN:', error)
      return null
    }
  }

  async saveGrace(expiresAt: number): Promise<void> {
    const mnemonic = this.seedCache.getCachedMnemonic()
    if (!mnemonic) return // locked / no session — nothing to persist
    await this.grace.save(mnemonic, expiresAt)
  }

  async extendGrace(expiresAt: number): Promise<void> {
    await this.grace.extend(expiresAt)
  }

  async clearGrace(): Promise<void> {
    await this.grace.clear()
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
