/**
 * 로케일 구조·보간 동등성 (병행 i18n 리뷰 NIT 채택 — 상주 게이트)
 *
 * EMITTED_KEYS 테스트는 에러 키만 커버한다. 이 테스트는 5개 로케일 전체에 대해
 * - 키 구조 완전 일치 (missing 0 / extra 0 — en 기준)
 * - 보간 변수 집합 일치 (es/id 토스트의 유령 {{unit}} 이 실제로 리터럴 노출을
 *   만들던 결함 클래스의 상시 차단)
 * 를 강제한다. 로케일 편집이 드리프트하면 여기서 즉시 깨진다.
 */
import { describe, it, expect } from 'vitest'
import en from '@/i18n/locales/en'
import ko from '@/i18n/locales/ko'
import ja from '@/i18n/locales/ja'
import es from '@/i18n/locales/es'
import id from '@/i18n/locales/id'

type Tree = Record<string, unknown>

function flatten(obj: Tree, prefix = ''): Map<string, string> {
  const out = new Map<string, string>()
  for (const [k, v] of Object.entries(obj)) {
    const path = prefix ? `${prefix}.${k}` : k
    if (v && typeof v === 'object') {
      for (const [ck, cv] of flatten(v as Tree, path)) out.set(ck, cv)
    } else {
      out.set(path, String(v))
    }
  }
  return out
}

function varsOf(value: string): string {
  return [...value.matchAll(/\{\{(\w+)\}\}/g)].map((m) => m[1]).sort().join(',')
}

const BASE = flatten(en as Tree)
const OTHERS = { ko, ja, es, id } as const

// 소비자가 로케일로 분기해 변수 집합이 의도적으로 다른 키 (token-view-model 의
// ko/ja 월 표기 분기 — en 값 '{{monthName}}' 은 해당 분기에서 도달 불가, 리뷰 NIT 판정).
// 새 항목 추가는 분기 근거 주석 필수 — 무근거 추가는 이 게이트의 무력화다.
const INTERPOLATION_ALLOWLIST = new Set(['token.history.anchor.monthSameYear'])

describe('locale parity (en 기준)', () => {
  it.each(Object.keys(OTHERS) as Array<keyof typeof OTHERS>)(
    '%s — 키 구조 missing 0 / extra 0',
    (locale) => {
      const target = flatten(OTHERS[locale] as Tree)
      const missing = [...BASE.keys()].filter((k) => !target.has(k))
      const extra = [...target.keys()].filter((k) => !BASE.has(k))
      expect(missing, `${locale} missing`).toEqual([])
      expect(extra, `${locale} extra`).toEqual([])
    },
  )

  it.each(Object.keys(OTHERS) as Array<keyof typeof OTHERS>)(
    '%s — 보간 변수 집합 동일 (유령 {{var}} 리터럴 노출 차단)',
    (locale) => {
      const target = flatten(OTHERS[locale] as Tree)
      const mismatches: string[] = []
      for (const [key, enValue] of BASE) {
        if (INTERPOLATION_ALLOWLIST.has(key)) continue
        const other = target.get(key)
        if (other !== undefined && varsOf(enValue) !== varsOf(other)) {
          mismatches.push(`${key}: en[${varsOf(enValue)}] vs ${locale}[${varsOf(other)}]`)
        }
      }
      expect(mismatches).toEqual([])
    },
  )
})
