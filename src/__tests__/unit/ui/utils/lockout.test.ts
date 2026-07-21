/**
 * Lockout marker reader — the single source of truth shared by LockScreen and the
 * boot resume path. Pins that both parse the persisted shape identically and that a
 * missing/corrupt/expired marker degrades safely.
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { readLockoutMarker, isLockoutActive } from '@/ui/utils/lockout'

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

  it('isLockoutActive is true only while the marker is unexpired', () => {
    localStorage.setItem('lockout', JSON.stringify({ until: Date.now() + 60_000, attempts: 5 }))
    expect(isLockoutActive()).toBe(true)
  })

  it('isLockoutActive is false for an expired marker', () => {
    localStorage.setItem('lockout', JSON.stringify({ until: Date.now() - 1, attempts: 5 }))
    expect(isLockoutActive()).toBe(false)
  })

  it('isLockoutActive is false when no marker is present', () => {
    expect(isLockoutActive()).toBe(false)
  })
})
