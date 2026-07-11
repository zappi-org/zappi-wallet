import { describe, expect, it } from 'vitest'

import { middleEllipsis, formatLightningAddress } from '@/ui/screens/Send/sendDisplayHelpers'

describe('middleEllipsis', () => {
  it('passes short values through unchanged', () => {
    expect(middleEllipsis('lnbc1u1p')).toBe('lnbc1u1p')
    expect(middleEllipsis('npub1abc')).toBe('npub1abc')
  })

  it('folds long values, keeping both ends visible', () => {
    const invoice = 'lnbc1500n1pjqrst9pp5abcdefghijklmnopqrstuvwxyz0123456789xyzabcd'
    const folded = middleEllipsis(invoice, 8, 6)
    expect(folded).toBe(`${invoice.slice(0, 8)}…${invoice.slice(-6)}`)
    expect(folded.startsWith(invoice.slice(0, 8))).toBe(true)
    expect(folded.endsWith(invoice.slice(-6))).toBe(true)
    expect(folded).toContain('…')
  })

  it('trims surrounding whitespace before measuring', () => {
    expect(middleEllipsis('  short  ')).toBe('short')
  })

  it('respects custom head/tail lengths', () => {
    const value = '0123456789abcdefghij'
    expect(middleEllipsis(value, 4, 4)).toBe('0123…ghij')
  })
})

describe('formatLightningAddress', () => {
  it('passes short addresses through unchanged', () => {
    expect(formatLightningAddress('alice@getalby.com')).toBe('alice@getalby.com')
  })

  it('folds a long local part while preserving the FULL domain', () => {
    const address = 'verylongusernamehere@getalby.com'
    const result = formatLightningAddress(address)
    expect(result.length).toBeLessThan(address.length)
    expect(result.endsWith('@getalby.com')).toBe(true)
    expect(result).toContain('…')
  })

  it('never truncates the domain even when it alone exceeds maxLength', () => {
    const address = 'bob@an-extremely-long-lightning-domain-name.example.com'
    const result = formatLightningAddress(address, 24)
    expect(result.endsWith('@an-extremely-long-lightning-domain-name.example.com')).toBe(true)
  })

  it('falls back to middleEllipsis when there is no @ in a long value', () => {
    const value = 'not-an-address-just-a-really-long-string-of-text'
    expect(formatLightningAddress(value)).toBe(middleEllipsis(value, 10, 6))
  })

  it('falls back to middleEllipsis when @ is the first character', () => {
    const value = '@justdomainwithoutlocalpartatall.example'
    expect(formatLightningAddress(value)).toBe(middleEllipsis(value, 10, 6))
  })
})
