import { describe, it, expect } from 'vitest'
import { sat, toNumber } from '@/core/domain/amount'
import {
  createTransaction,
  getDisplayFee,
  getTransactionType,
  getTotalCost,
} from '@/core/domain/transaction'

describe('TransactionFee', () => {
  describe('getDisplayFee', () => {
    it('returns effective fee if present', () => {
      const tx = createTransaction({
        id: 'tx-1',
        direction: 'send',
        method: 'cashu:lightning',
        protocol: 'bolt11',
        amount: sat(16),
        accountId: 'mint-1',
        fee: { quoted: sat(50), effective: sat(3) },
      })
      expect(toNumber(getDisplayFee(tx)!)).toBe(3)
    })

    it('returns quoted fee if effective is not present', () => {
      const tx = createTransaction({
        id: 'tx-1',
        direction: 'send',
        method: 'cashu:lightning',
        protocol: 'bolt11',
        amount: sat(16),
        accountId: 'mint-1',
        fee: { quoted: sat(50) },
      })
      expect(toNumber(getDisplayFee(tx)!)).toBe(50)
    })

    it('returns undefined if fee is not present', () => {
      const tx = createTransaction({
        id: 'tx-1',
        direction: 'send',
        method: 'cashu:lightning',
        protocol: 'bolt11',
        amount: sat(16),
        accountId: 'mint-1',
      })
      expect(getDisplayFee(tx)).toBeUndefined()
    })
  })

  describe('getTotalCost', () => {
    it('send: returns amount + quoted fee', () => {
      const tx = createTransaction({
        id: 'tx-1',
        direction: 'send',
        method: 'cashu:lightning',
        protocol: 'bolt11',
        amount: sat(16),
        accountId: 'mint-1',
        fee: { quoted: sat(3) },
      })
      expect(toNumber(getTotalCost(tx))).toBe(19)
    })

    it('send: returns amount + effective fee (effective takes priority)', () => {
      const tx = createTransaction({
        id: 'tx-1',
        direction: 'send',
        method: 'cashu:lightning',
        protocol: 'bolt11',
        amount: sat(16),
        accountId: 'mint-1',
        fee: { quoted: sat(50), effective: sat(3) },
      })
      expect(toNumber(getTotalCost(tx))).toBe(19)
    })

    it('send: returns amount only if fee is not present', () => {
      const tx = createTransaction({
        id: 'tx-1',
        direction: 'send',
        method: 'cashu:lightning',
        protocol: 'bolt11',
        amount: sat(16),
        accountId: 'mint-1',
      })
      expect(toNumber(getTotalCost(tx))).toBe(16)
    })

    it('receive: returns amount as-is (fee already deducted as net amount)', () => {
      const tx = createTransaction({
        id: 'tx-1',
        direction: 'receive',
        method: 'cashu:ecash',
        protocol: 'nut18',
        amount: sat(990),
        accountId: 'mint-1',
        fee: { quoted: sat(10), effective: sat(10) },
      })
      expect(toNumber(getTotalCost(tx))).toBe(990)
    })

    it('receive: returns amount if fee is not present', () => {
      const tx = createTransaction({
        id: 'tx-1',
        direction: 'receive',
        method: 'cashu:ecash',
        protocol: 'nut18',
        amount: sat(1000),
        accountId: 'mint-1',
      })
      expect(toNumber(getTotalCost(tx))).toBe(1000)
    })
  })

  describe('getTransactionType', () => {
    it('treats legacy unclaimed sends with missing protocol as ecash token transactions', () => {
      const tx = createTransaction({
        id: 'tx-legacy-token-fail',
        direction: 'send',
        method: 'cashu',
        protocol: '',
        amount: sat(16),
        accountId: 'mint-1',
        outcome: 'unclaimed',
      })

      expect(getTransactionType(tx)).toBe('ecash-token')
    })
  })
})
