/**
 * mintUrlKey / isSameMintUrl / getMintBalance — canonical mint URL equality.
 *
 * Pinned principles:
 * - normalizeMintUrl (storage normalization) semantics are frozen — it does not
 *   lowercase or strip ports. Absorbing those variants is mintUrlKey's job (comparison only).
 *   If this separation breaks, keys mismatch against existing stored data (a funds-display bug).
 * - getMintBalance's byMint lookup falls back to canonical on a direct-match miss,
 *   eliminating notation-variant misses.
 */
import { describe, it, expect } from 'vitest'
import { mintUrlKey, isSameMintUrl, normalizeMintUrl } from '@/core/domain/mint-url'
import { getMintBalance } from '@/utils/url'

const CANON = 'https://mint.example.com'

describe('mintUrlKey — notation-variant absorption table', () => {
  it.each([
    ['https://mint.example.com', '기준형'],
    ['https://mint.example.com/', 'trailing slash'],
    ['https://mint.example.com//', '다중 trailing slash'],
    ['https://MINT.EXAMPLE.COM', '호스트 대문자'],
    ['HTTPS://Mint.Example.Com', '프로토콜+호스트 대소문자 혼합'],
    ['https://mint.example.com:443', '명시적 기본 포트'],
    ['https://mint.example.com:443/', '기본 포트 + slash'],
    ['mint.example.com', '프로토콜 생략 (normalizeMintUrl 위임)'],
    ['  https://mint.example.com  ', '공백'],
  ])('%s (%s) → same key', (variant) => {
    expect(mintUrlKey(variant)).toBe(mintUrlKey(CANON))
  })

  it('path variants: trailing slash absorbed, case preserved', () => {
    expect(mintUrlKey('https://m.com/api/')).toBe(mintUrlKey('https://m.com/api'))
    // path is a case-sensitive resource — must be a different key
    expect(mintUrlKey('https://m.com/API')).not.toBe(mintUrlKey('https://m.com/api'))
  })

  it('distinguishes non-default port, different host, and http', () => {
    expect(mintUrlKey('https://mint.example.com:3338')).not.toBe(mintUrlKey(CANON))
    expect(mintUrlKey('https://other.example.com')).not.toBe(mintUrlKey(CANON))
    expect(mintUrlKey('http://mint.example.com')).not.toBe(mintUrlKey(CANON))
    // http's default port is :80
    expect(mintUrlKey('http://m.com:80')).toBe(mintUrlKey('http://m.com'))
  })

  it('unparseable strings fall back to the normalizeMintUrl result (never throws)', () => {
    expect(() => mintUrlKey('not a url at all')).not.toThrow()
  })
})

describe('isSameMintUrl', () => {
  it('treats notation variants of the same mint as equal', () => {
    expect(isSameMintUrl('https://Mint.Example.com:443/', 'mint.example.com')).toBe(true)
  })

  it('distinguishes different mints', () => {
    expect(isSameMintUrl('https://a.example.com', 'https://b.example.com')).toBe(false)
  })
})

describe('normalizeMintUrl semantics frozen (storage-normalization guard)', () => {
  it('does not lowercase or strip the default port — that is the job of comparison-only mintUrlKey', () => {
    expect(normalizeMintUrl('https://MINT.Example.com/')).toBe('https://MINT.Example.com')
    expect(normalizeMintUrl('https://m.com:443')).toBe('https://m.com:443')
    expect(normalizeMintUrl('m.com')).toBe('https://m.com')
  })
})

describe('getMintBalance — byMint lookup canonical fallback (audit MAJOR-7)', () => {
  const byMint = {
    'https://mint.example.com': 21,
    'https://zero.example.com': 0,
  }

  it('direct/slash match takes priority', () => {
    expect(getMintBalance('https://mint.example.com', byMint)).toBe(21)
    expect(getMintBalance('https://mint.example.com/', byMint)).toBe(21)
  })

  it('finds notation variants (case, :443) via canonical fallback', () => {
    expect(getMintBalance('https://MINT.example.com:443/', byMint)).toBe(21)
  })

  it('balance 0 honestly returns 0 (?? semantics — a falsy value is not treated as a miss)', () => {
    expect(getMintBalance('https://zero.example.com', byMint)).toBe(0)
  })

  it('a mint absent under every variant returns 0', () => {
    expect(getMintBalance('https://unknown.example.com', byMint)).toBe(0)
  })
})
