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
import { Ok, Err, type Result } from '@/core/domain/result'
import { SecurityError } from '@/core/errors/security'

// ─── KDF 세대 정책 (docs/design/kdf-upgrade.md §5.2) ───
// 버전→반복수 맵을 서비스 층이 소유한다. 어댑터는 반복수를 인자로 받는 실행자일 뿐.
const KDF_ITERATIONS: Record<number, number> = { 1: 100_000, 2: 600_000 }
const CURRENT_KDF_VERSION = 2
// verifyAgainstRecord 폴백이 순회하는 알려진 버전 집합. 미지 declared 는 이 집합으로 강등된다.
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

      // 신규 지갑은 항상 CURRENT 버전으로 기록한다 (§5.1 "쓰기는 항상 현재 버전으로").
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
      // 태그 동반 조회 — 마이그레이션의 CAS 전제 조건 (§6.2). 부재 시 NO_WALLET
      // (half-wipe 구제 경로 불변 — §7 F10).
      const rec = await this.storage.getWalletWithTag()
      if (!rec) {
        return Err(new SecurityError('NO_WALLET', 'No wallet found'))
      }
      const { wallet, tag } = rec

      // 선언 버전 우선, 실패 시 알려진 버전 전수 폴백 (§5.5). 오답 PIN → null → INVALID_PASSWORD.
      const match = await this.verifyAgainstRecord(wallet, password)
      if (!match) {
        return Err(new SecurityError('INVALID_PASSWORD', 'Invalid password'))
      }

      const mnemonic = await this.encryption.decrypt(
        wallet.encryptedMnemonic,
        password,
        KDF_ITERATIONS[match.version],
      )
      const keys = this.keyManager.deriveNostrKeyPair(mnemonic)
      const bip39Seed = this.keyManager.deriveBip39Seed(mnemonic)

      this.cachedKeys = keys
      this.cachedSeed = bip39Seed
      this.seedCache.cacheMnemonic(mnemonic)

      // 마이그레이션: 구버전이거나(matched != CURRENT) 오염 레코드(declared != matched)일 때.
      // 실패는 비치명 — unlock 결과에 영향 없음, 레코드는 v1 온전, 다음 unlock 재시도 (§5.3 / §7 F3).
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

      // 버전 인지 검증 (읽기만 — 쓰기 없음, §5.6). v1·v2 레코드 양쪽에서 정확 판정.
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

      // 구 비밀번호는 버전 인지로 검증하고(읽기), 재기록은 항상 CURRENT 로 한다 —
      // v1 레코드 사용자가 PIN 을 바꾸면 그 시점에 자연 승급된다 (§5.6).
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

      // CAS 미적용은 의도 — changePassword 는 항상 완결된 CURRENT 레코드를 쓰는
      // post-unlock 수동 액션이라, 경합하는 마이그레이션의 CAS 는 태그 불일치로
      // 스킵되고 니모닉은 어느 순서든 보존된다 (설계 §6.1 관찰-1 / 구현 리뷰 NIT).
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

      // 버전 인지 검증 후 매칭 버전으로 복호 (읽기만 — 쓰기 없음, §5.6).
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
    await this.storage.deleteWallet()
    this.cachedKeys = null
    this.cachedSeed = null
    this.seedCache.clearCache()
  }

  // ─── KDF 버전 인지 검증 · 마이그레이션 (docs/design/kdf-upgrade.md §5) ───

  /**
   * 선언 버전 우선 시도, 실패 시 나머지 알려진 버전 전수 순회 (§5.5, 자가 치유).
   * 반환: 실제로 일치한 버전 { version } | null(오답). 미지의 declared(미래 버전 레코드)는
   * KDF_ITERATIONS[미지] 참조로 깨지지 않게 KNOWN_VERSIONS 전수(최신 우선)로 강등한다.
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
   * 레코드의 두 KDF 필드(encryptedMnemonic + passwordHash)를 CURRENT 반복수로 원자적 재작성.
   * 반환: put 성공(true) / CAS 미스·readback 실패(false). throw 는 호출자(unlock)가 비치명 처리.
   *
   * 양방향 readback (§5.4): put 될 암호문이 니모닉의 유일 사본을 대체하므로, 쓰기 전에 두 산출물을
   * **CURRENT 상수로 새로 파생한 값**과 교차 검증한다 — (a) 니모닉 왕복, (b) 검증자(hash) 왕복.
   * 둘 중 하나라도 불일치면 put 하지 않는다("자기 파라미터로 자기 산출물을 여는" 맹점 차단).
   */
  private async migrateRecord(
    wallet: StoredWallet,
    tag: string,
    password: string,
    mnemonic: string,
  ): Promise<boolean> {
    const iterations = KDF_ITERATIONS[CURRENT_KDF_VERSION]

    // 1. 두 필드를 CURRENT 반복수로 재파생
    const encryptedMnemonic = await this.encryption.encrypt(mnemonic, password, iterations)
    const passwordSalt = randomHex(16)
    const passwordHash = await this.encryption.hashPassword(password, passwordSalt, iterations)

    // 2. 양방향 readback — CURRENT 상수로 재파생해 교차 검증
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
      return false // 자기 산출물 불일치 — put 미도달 (v1 유지, 다음 unlock 재시도)
    }

    // 3. 단일 레코드 CAS 교체 (§6.2). 불일치·부재 → false (no-op).
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
