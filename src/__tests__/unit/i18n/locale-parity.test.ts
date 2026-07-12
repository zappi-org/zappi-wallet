/**
 * Locale structure and interpolation parity.
 *
 * EMITTED_KEYS covers only error keys. This test enforces, across all 5 locales:
 * - exact key structure (missing 0 / extra 0, en as baseline)
 * - matching interpolation variable sets (guards the defect class where a phantom
 *   {{unit}} in es/id toasts leaked as a literal)
 * Any drift in locale edits breaks here immediately.
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

// Keys where the consumer branches by locale so the variable set intentionally
// differs (token-view-model's ko/ja month-name branch makes en's '{{monthName}}'
// unreachable). New entries require a rationale comment — unjustified additions
// defeat this gate.
const INTERPOLATION_ALLOWLIST = new Set(['token.history.anchor.monthSameYear'])

describe('locale parity (en baseline)', () => {
  it.each(Object.keys(OTHERS) as Array<keyof typeof OTHERS>)(
    '%s — key structure missing 0 / extra 0',
    (locale) => {
      const target = flatten(OTHERS[locale] as Tree)
      const missing = [...BASE.keys()].filter((k) => !target.has(k))
      const extra = [...target.keys()].filter((k) => !BASE.has(k))
      expect(missing, `${locale} missing`).toEqual([])
      expect(extra, `${locale} extra`).toEqual([])
    },
  )

  it.each(Object.keys(OTHERS) as Array<keyof typeof OTHERS>)(
    '%s — interpolation variable sets identical (blocks phantom {{var}} literal leakage)',
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
