/**
 * mintUrlKey / isSameMintUrl / getMintBalance — 민트 URL 동등성 canonical (감사 Phase 2)
 *
 * 원칙 핀:
 * - normalizeMintUrl(저장 정규화)의 의미는 동결 — 소문자화·포트 제거를 하지 않는다.
 *   그 변형 흡수는 비교 전용 mintUrlKey 의 몫이다. 이 분리가 무너지면
 *   기존 저장 데이터와의 키 불일치(자금 표시 버그)가 생긴다.
 * - byMint 조회(getMintBalance)는 직접 매치 실패 시 canonical 폴백으로 표기 변형
 *   미스를 없앤다 (감사 MAJOR-7).
 */
import { describe, it, expect } from 'vitest'
import { mintUrlKey, isSameMintUrl, getMintBalance, normalizeMintUrl } from '@/utils/url'

const CANON = 'https://mint.example.com'

describe('mintUrlKey — 표기 변형 흡수 표', () => {
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
  ])('%s (%s) → 동일 키', (variant) => {
    expect(mintUrlKey(variant)).toBe(mintUrlKey(CANON))
  })

  it('경로 변형: trailing slash 는 흡수, 대소문자는 보존', () => {
    expect(mintUrlKey('https://m.com/api/')).toBe(mintUrlKey('https://m.com/api'))
    // 경로는 대소문자 구분 자원 — 다른 키여야 한다
    expect(mintUrlKey('https://m.com/API')).not.toBe(mintUrlKey('https://m.com/api'))
  })

  it('비-기본 포트·다른 호스트·http 는 구별한다', () => {
    expect(mintUrlKey('https://mint.example.com:3338')).not.toBe(mintUrlKey(CANON))
    expect(mintUrlKey('https://other.example.com')).not.toBe(mintUrlKey(CANON))
    expect(mintUrlKey('http://mint.example.com')).not.toBe(mintUrlKey(CANON))
    // http 의 기본 포트는 :80
    expect(mintUrlKey('http://m.com:80')).toBe(mintUrlKey('http://m.com'))
  })

  it('파싱 불가 문자열은 normalizeMintUrl 결과로 폴백 (throw 금지)', () => {
    expect(() => mintUrlKey('not a url at all')).not.toThrow()
  })
})

describe('isSameMintUrl', () => {
  it('같은 민트의 표기 변형을 동일 판정', () => {
    expect(isSameMintUrl('https://Mint.Example.com:443/', 'mint.example.com')).toBe(true)
  })

  it('다른 민트는 구별', () => {
    expect(isSameMintUrl('https://a.example.com', 'https://b.example.com')).toBe(false)
  })
})

describe('normalizeMintUrl 의미 동결 (저장 정규화 가드)', () => {
  it('소문자화·기본 포트 제거를 하지 않는다 — 그건 비교 전용 mintUrlKey 의 몫', () => {
    expect(normalizeMintUrl('https://MINT.Example.com/')).toBe('https://MINT.Example.com')
    expect(normalizeMintUrl('https://m.com:443')).toBe('https://m.com:443')
    expect(normalizeMintUrl('m.com')).toBe('https://m.com')
  })
})

describe('getMintBalance — byMint 조회 canonical 폴백 (감사 MAJOR-7)', () => {
  const byMint = {
    'https://mint.example.com': 21,
    'https://zero.example.com': 0,
  }

  it('직접/슬래시 매치 우선', () => {
    expect(getMintBalance('https://mint.example.com', byMint)).toBe(21)
    expect(getMintBalance('https://mint.example.com/', byMint)).toBe(21)
  })

  it('표기 변형(대소문자·:443)은 canonical 폴백으로 찾는다', () => {
    expect(getMintBalance('https://MINT.example.com:443/', byMint)).toBe(21)
  })

  it('잔액 0 도 정직하게 0 (?? 시맨틱 — falsy 폴백으로 미스 처리하지 않는다)', () => {
    expect(getMintBalance('https://zero.example.com', byMint)).toBe(0)
  })

  it('어떤 변형으로도 없는 민트는 0', () => {
    expect(getMintBalance('https://unknown.example.com', byMint)).toBe(0)
  })
})
