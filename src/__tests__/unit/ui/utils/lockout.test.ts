/**
 * Lockout marker reader — pins the persisted shape LockScreen parses and that a
 * missing/corrupt marker degrades safely.
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { readLockoutMarker } from '@/ui/utils/lockout'

describe('lockout marker', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it('readLockoutMarker returns null when absent', () => {
    expect(readLockoutMarker()).toBeNull()
  })

  it('readLockoutMarker parses a well-formed marker', () => {
    const until = Date.now() + 60_000
    localStorage.setItem('lockout', JSON.stringify({ until, attempts: 5 }))
    expect(readLockoutMarker()).toEqual({ until, attempts: 5 })
  })

  it('readLockoutMarker returns null on malformed JSON', () => {
    localStorage.setItem('lockout', 'not-json')
    expect(readLockoutMarker()).toBeNull()
  })

  it('readLockoutMarker returns null when fields are the wrong shape', () => {
    localStorage.setItem('lockout', JSON.stringify({ until: 'soon' }))
    expect(readLockoutMarker()).toBeNull()
  })
})
