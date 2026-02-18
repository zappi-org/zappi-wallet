import type { Proof } from '@cashu/cashu-ts'
import { getDatabase, type ProofRecord } from '@/data/database'
import { SettingsRepository } from '@/data/repositories/settings.repository'
import { InsufficientBalanceError } from '@/core/errors'
import { ok, err, type Result } from '@/core/types'
import type { WalletBalance } from '@/core/types'
import type { BaseError } from '@/core/errors'

/**
 * Normalize mint URL (remove trailing slash)
 */
function normalizeMintUrl(url: string): string {
  return url.endsWith('/') ? url.slice(0, -1) : url
}

/**
 * Create unique ID for proof storage
 */
function createProofId(mintUrl: string, secret: string): string {
  return `${normalizeMintUrl(mintUrl)}:${secret}`
}

/**
 * Service for wallet operations (balance, proofs)
 */
export class WalletService {
  private settingsRepo: SettingsRepository

  constructor() {
    this.settingsRepo = new SettingsRepository()
  }

  private get db() {
    return getDatabase()
  }

  /**
   * Get total balance across all mints
   * Uses IndexedDB proofs as the single source of truth (eNuts-style)
   */
  async getBalance(): Promise<WalletBalance> {
    const proofs = await this.db.proofs.toArray()

    const byMint: Record<string, number> = {}
    let total = 0

    for (const proof of proofs) {
      const mintUrl = normalizeMintUrl(proof.mintUrl)
      byMint[mintUrl] = (byMint[mintUrl] || 0) + proof.amount
      total += proof.amount
    }

    return { total, byMint }
  }

  /**
   * Get balance for a specific mint
   * Uses IndexedDB proofs as the single source of truth
   */
  async getBalanceByMint(mintUrl: string): Promise<number> {
    const normalizedUrl = normalizeMintUrl(mintUrl)
    const proofs = await this.db.proofs
      .where('mintUrl')
      .equals(normalizedUrl)
      .toArray()

    return proofs.reduce((sum, p) => sum + p.amount, 0)
  }

  /**
   * Add proofs to storage
   */
  async addProofs(mintUrl: string, proofs: Proof[]): Promise<void> {
    const normalizedUrl = normalizeMintUrl(mintUrl)
    const now = Date.now()

    const records: ProofRecord[] = proofs.map((proof) => ({
      id: createProofId(normalizedUrl, proof.secret),
      mintUrl: normalizedUrl,
      amount: proof.amount,
      secret: proof.secret,
      C: proof.C,
      keysetId: proof.id,
      addedAt: now,
    }))

    await this.db.proofs.bulkPut(records)
  }

  /**
   * Get all proofs for a mint
   */
  async getProofs(mintUrl: string): Promise<Proof[]> {
    const normalizedUrl = normalizeMintUrl(mintUrl)
    const records = await this.db.proofs
      .where('mintUrl')
      .equals(normalizedUrl)
      .toArray()

    return records.map((r) => ({
      id: r.keysetId,
      amount: r.amount,
      secret: r.secret,
      C: r.C,
    }))
  }

  /**
   * Select proofs for a given amount (greedy algorithm)
   * Returns proofs that sum to at least the requested amount
   */
  async getProofsForAmount(
    mintUrl: string,
    amount: number
  ): Promise<Result<Proof[], BaseError>> {
    const normalizedUrl = normalizeMintUrl(mintUrl)
    const allProofs = await this.db.proofs
      .where('mintUrl')
      .equals(normalizedUrl)
      .toArray()

    // Sort by amount descending (greedy: use larger denominations first)
    allProofs.sort((a, b) => b.amount - a.amount)

    const selected: ProofRecord[] = []
    let selectedAmount = 0

    for (const proof of allProofs) {
      if (selectedAmount >= amount) break
      selected.push(proof)
      selectedAmount += proof.amount
    }

    if (selectedAmount < amount) {
      return err(new InsufficientBalanceError(amount, selectedAmount))
    }

    return ok(
      selected.map((r) => ({
        id: r.keysetId,
        amount: r.amount,
        secret: r.secret,
        C: r.C,
      }))
    )
  }

  /**
   * Remove proofs from storage
   */
  async removeProofs(mintUrl: string, proofs: Proof[]): Promise<void> {
    const normalizedUrl = normalizeMintUrl(mintUrl)
    const ids = proofs.map((p) => createProofId(normalizedUrl, p.secret))
    await this.db.proofs.bulkDelete(ids)
  }

  /**
   * Get configured mints from settings
   */
  async getMints(): Promise<string[]> {
    const settings = await this.settingsRepo.getSettings()
    return settings.mints
  }

  /**
   * Get all mints that have proofs
   */
  async getMintsWithBalance(): Promise<string[]> {
    const balance = await this.getBalance()
    return Object.keys(balance.byMint).filter(
      (mint) => (balance.byMint[mint] || 0) > 0
    )
  }

  /**
   * Clear all proofs (for logout)
   */
  async clearAllProofs(): Promise<void> {
    await this.db.proofs.clear()
  }
}
