import { describe, expect, it } from 'vitest'
import { UnknownError } from '@/core/errors/base'
import { getErrorI18n, translateError } from '@/ui/utils/error-i18n'

describe('error i18n', () => {
  it('maps UNKNOWN domain errors to the existing unknown-error copy', () => {
    expect(getErrorI18n(new UnknownError('Unexpected failure'))).toEqual({
      key: 'errors.unknownError',
    })
  })

  it('does not expose a missing errors.unknown translation key', () => {
    const t = (key: string) => key

    expect(translateError(new UnknownError('Unexpected failure'), t)).toBe('errors.unknownError')
  })
})
