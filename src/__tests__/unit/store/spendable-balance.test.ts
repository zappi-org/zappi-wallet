import { describe, expect, it } from 'vitest'
import { spendableByMint, spendableTotal } from '@/store/selectors'

describe('spendable balance', () => {
  it('subtracts in-flight payouts per mint', () => {
    expect(
      spendableByMint(
        { 'https://a.example': 100000, 'https://b.example': 5000 },
        { 'https://a.example': 30000 },
      ),
    ).toEqual({ 'https://a.example': 70000, 'https://b.example': 5000 })
  })

  it('never goes below zero', () => {
    expect(spendableByMint({ 'https://a.example': 1000 }, { 'https://a.example': 5000 })).toEqual({
      'https://a.example': 0,
    })
  })

  it('ignores in-flight amounts for unknown mints', () => {
    expect(
      spendableByMint({ 'https://a.example': 1000 }, { 'https://b.example': 5000 }),
    ).toEqual({ 'https://a.example': 1000 })
  })

  it('sums the spendable total', () => {
    expect(
      spendableTotal(
        { 'https://a.example': 100000, 'https://b.example': 5000 },
        { 'https://a.example': 100000 },
      ),
    ).toBe(5000)
  })
})
