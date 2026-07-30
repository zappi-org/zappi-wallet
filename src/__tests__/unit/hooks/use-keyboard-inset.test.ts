import { describe, it, expect } from 'vitest'
import { computeInset } from '@/ui/hooks/use-keyboard-inset'

describe('computeInset', () => {
  it('is 0 when the visual viewport fills the window', () => {
    expect(computeInset(800, { height: 800, offsetTop: 0 })).toBe(0)
  })

  it('returns the covered height when the keyboard shrinks the viewport', () => {
    expect(computeInset(800, { height: 550, offsetTop: 0 })).toBe(250)
  })

  it('accounts for a scrolled visual viewport (offsetTop)', () => {
    expect(computeInset(800, { height: 500, offsetTop: 50 })).toBe(250)
  })

  it('never goes negative when the viewport is larger than the window', () => {
    expect(computeInset(800, { height: 900, offsetTop: 0 })).toBe(0)
  })
})
