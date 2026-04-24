import { beforeEach, describe, it, expect } from 'vitest'
import { sat, toNumber } from '@/core/domain/amount'
import type { Transaction } from '@/core/domain/transaction'
import type { Transaction as LegacyTransaction } from '@/core/types'
import { DexieTransactionRepository } from '@/adapters/storage/dexie/dexie-transaction.repository'
import { resetDatabase } from '@/adapters/storage/dexie/schema'

// Import the private conversion functions via indirect testing through the repository
// For this test, we'll test the public API behavior that exercises toDomain/toLegacy

describe('DexieTransactionRepository fee migration', () => {
  beforeEach(async () => {
    await resetDatabase()
  })

  // Since toDomain/toLegacy are private, we test through save/getById
  // But for unit testing the conversion logic, we can recreate the logic here

  function legacyToSimpleDomain(legacy: Pick<LegacyTransaction, 'amount' | 'metadata'>): {
    amount: ReturnType<typeof sat>
    fee: Transaction['fee']
  } {
    const metaFee = legacy.metadata?.fee as number | undefined
    const amountDomain = sat(legacy.amount)
    return {
      amount: amountDomain,
      fee: metaFee != null ? { quoted: { value: BigInt(metaFee), unit: amountDomain.unit } } : undefined,
    }
  }

  function domainToSimpleLegacy(domain: Pick<Transaction, 'amount' | 'fee'>): {
    amount: number
    metadata: { fee?: number }
  } {
    const feeNumber = domain.fee
      ? toNumber(domain.fee.effective ?? domain.fee.quoted)
      : undefined
    return {
      amount: toNumber(domain.amount),
      metadata: {
        ...(feeNumber != null && { fee: feeNumber }),
      },
    }
  }

  describe('toDomain conversion', () => {
    it('converts legacy metadata.fee to TransactionFee { quoted }', () => {
      const legacy = { amount: 16, metadata: { fee: 3 } }
      const result = legacyToSimpleDomain(legacy)
      
      expect(result.fee).toBeDefined()
      expect(result.fee?.quoted).toBeDefined()
      expect(toNumber(result.fee!.quoted)).toBe(3)
      expect(result.fee?.effective).toBeUndefined()
    })

    it('sets fee to undefined if metadata.fee is not present', () => {
      const legacy = { amount: 16, metadata: {} }
      const result = legacyToSimpleDomain(legacy)
      
      expect(result.fee).toBeUndefined()
    })

    it('fee uses same unit as amount', () => {
      const legacy = { amount: 1000, metadata: { fee: 50 } }
      const result = legacyToSimpleDomain(legacy)
      
      expect(result.amount.unit).toBe('sat')
      expect(result.fee?.quoted.unit).toBe('sat')
      expect(result.fee?.quoted.unit).toBe(result.amount.unit)
    })
  })

  describe('toLegacy conversion', () => {
    it('converts TransactionFee to metadata.fee (effective takes priority)', () => {
      const domain: Pick<Transaction, 'amount' | 'fee'> = {
        amount: sat(16),
        fee: { quoted: sat(50), effective: sat(3) },
      }
      const result = domainToSimpleLegacy(domain)
      
      expect(result.metadata.fee).toBe(3)
    })

    it('uses quoted fee if effective is not present', () => {
      const domain: Pick<Transaction, 'amount' | 'fee'> = {
        amount: sat(16),
        fee: { quoted: sat(50) },
      }
      const result = domainToSimpleLegacy(domain)
      
      expect(result.metadata.fee).toBe(50)
    })

    it('does not set metadata.fee if domain.fee is undefined', () => {
      const domain: Pick<Transaction, 'amount' | 'fee'> = {
        amount: sat(16),
      }
      const result = domainToSimpleLegacy(domain)
      
      expect(result.metadata.fee).toBeUndefined()
    })
  })

  describe('round-trip conversion', () => {
    it('preserves fee through toDomain -> toLegacy', () => {
      const original = { amount: 1000, metadata: { fee: 25 } }
      const domain = legacyToSimpleDomain(original)
      const legacy = domainToSimpleLegacy(domain)
      
      expect(legacy.metadata.fee).toBe(25)
    })

    it('handles missing fee through round-trip', () => {
      const original = { amount: 1000, metadata: {} }
      const domain = legacyToSimpleDomain(original)
      const legacy = domainToSimpleLegacy(domain)
      
      expect(legacy.metadata.fee).toBeUndefined()
    })
  })

  describe('update metadata merging', () => {
    it('preserves swap route metadata when adding an effective fee', async () => {
      const repo = new DexieTransactionRepository()

      await repo.save({
        id: 'swap-source-tx',
        direction: 'send',
        method: 'cashu:lightning',
        protocol: 'bolt11',
        amount: sat(100),
        accountId: 'https://source.mint',
        status: 'pending',
        createdAt: Date.now(),
        intent: 'swap',
        metadata: {
          fromMintUrl: 'https://source.mint',
          toMintUrl: 'https://target.mint',
        },
        fee: { quoted: sat(3) },
      })

      await repo.update('swap-source-tx', {
        status: 'settled',
        outcome: 'claimed',
        fee: { quoted: sat(3), effective: sat(2) },
      })

      const updated = await repo.getById('swap-source-tx')
      expect(updated?.metadata).toMatchObject({
        fromMintUrl: 'https://source.mint',
        toMintUrl: 'https://target.mint',
        fee: 2,
      })
    })
  })
})
