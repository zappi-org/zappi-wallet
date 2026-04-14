import { describe, it, expect } from 'vitest'
import { resolveFlowTarget } from '../resolve-flow-target'

describe('resolveFlowTarget', () => {
  it('should return "send" for bolt11', () => {
    expect(resolveFlowTarget('bolt11')).toBe('send')
  })

  it('should return "send" for cashu-request', () => {
    expect(resolveFlowTarget('cashu-request')).toBe('send')
  })

  it('should return "send" for lnurl-pay', () => {
    expect(resolveFlowTarget('lnurl-pay')).toBe('send')
  })

  it('should return "send" for lightning-address', () => {
    expect(resolveFlowTarget('lightning-address')).toBe('send')
  })

  it('should return "receive" for cashu-token', () => {
    expect(resolveFlowTarget('cashu-token')).toBe('receive')
  })

  it('should return "receive" for lnurl-withdraw', () => {
    expect(resolveFlowTarget('lnurl-withdraw')).toBe('receive')
  })

  it('should return "send" for unknown type (fallback)', () => {
    expect(resolveFlowTarget('unknown-type')).toBe('send')
  })
})
