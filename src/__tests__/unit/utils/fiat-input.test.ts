import { describe, expect, it } from 'vitest'

import {
  appendFiatInput,
  formatFiatInputForDisplay,
  getFiatFractionDigits,
  normalizeFiatInput,
} from '@/utils/format'

describe('fiat input editing', () => {
  it('preserves zero-prefixed decimal states without coercing them to a number', () => {
    let value = appendFiatInput('', 'decimal', 2)
    expect(value).toBe('0.')

    value = appendFiatInput(value, '0', 2)
    expect(value).toBe('0.0')

    value = appendFiatInput(value, '5', 2)
    expect(value).toBe('0.05')

    expect(appendFiatInput(value, '9', 2)).toBe('0.05')
  })

  it('keeps one useful leading zero and replaces it when entering an integer', () => {
    expect(appendFiatInput('', '0', 2)).toBe('0')
    expect(appendFiatInput('0', '0', 2)).toBe('0')
    expect(appendFiatInput('0', '7', 2)).toBe('7')
  })

  it('normalizes pasted or typed text while preserving an in-progress decimal', () => {
    expect(normalizeFiatInput('000.050', 2)).toBe('0.05')
    expect(normalizeFiatInput('0.', 2)).toBe('0.')
    expect(normalizeFiatInput('12.3.4', 2)).toBe('12.34')
  })

  it('uses each currency minor-unit precision', () => {
    expect(getFiatFractionDigits('USD')).toBe(2)
    expect(getFiatFractionDigits('JPY')).toBe(0)
    expect(getFiatFractionDigits('KWD')).toBe(3)
    expect(appendFiatInput('1', 'decimal', 0)).toBe('1')
    expect(appendFiatInput('1.23', '4', 3)).toBe('1.234')
  })

  it('groups only for display and retains trailing decimal text', () => {
    expect(formatFiatInputForDisplay('1234.')).toContain('234')
    expect(formatFiatInputForDisplay('1234.50')).toMatch(/50$/)
  })
})
