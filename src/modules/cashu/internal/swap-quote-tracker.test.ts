import { describe, it, expect, beforeEach } from 'vitest'
import {
  markQuoteAsSwap,
  unmarkQuoteAsSwap,
  isSwapQuote,
} from './swap-quote-tracker'

describe('swap-quote-tracker', () => {
  beforeEach(() => {
    unmarkQuoteAsSwap('q1')
    unmarkQuoteAsSwap('q2')
  })

  it('should return false for unknown quote', () => {
    expect(isSwapQuote('unknown')).toBe(false)
  })

  it('should mark quote as swap', () => {
    markQuoteAsSwap('q1')
    expect(isSwapQuote('q1')).toBe(true)
  })

  it('should unmark quote', () => {
    markQuoteAsSwap('q1')
    unmarkQuoteAsSwap('q1')
    expect(isSwapQuote('q1')).toBe(false)
  })

  it('should track multiple quotes independently', () => {
    markQuoteAsSwap('q1')
    markQuoteAsSwap('q2')
    expect(isSwapQuote('q1')).toBe(true)
    expect(isSwapQuote('q2')).toBe(true)
    unmarkQuoteAsSwap('q1')
    expect(isSwapQuote('q1')).toBe(false)
    expect(isSwapQuote('q2')).toBe(true)
  })
})
