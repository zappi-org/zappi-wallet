import { describe, it, expect, vi } from 'vitest'
import { CryptoService } from '@/core/services/crypto.service'
import type { CryptoGateway } from '@/core/ports/driven/crypto-gateway.port'

function createMockGateway(): CryptoGateway {
  return {
    encodeNpub: vi.fn().mockReturnValue('npub1xxx'),
    encodeNprofile: vi.fn().mockReturnValue('nprofile1xxx'),
    decodeNpub: vi.fn().mockReturnValue({ type: 'npub', data: 'hex123' }),
    derivePOSSubKey: vi.fn().mockReturnValue({
      index: 0,
      p2pkPublicKey: 'pk1',
      p2pkPrivateKey: 'sk1',
      nostrPublicKey: 'npk1',
      nostrPrivateKey: 'nsk1',
    }),
    getP2PKPubkey: vi.fn().mockReturnValue('02abc'),
  }
}

describe('CryptoService', () => {
  it('should delegate encodeNpub to gateway', () => {
    const gw = createMockGateway()
    const svc = new CryptoService(gw)
    expect(svc.encodeNpub('hex')).toBe('npub1xxx')
    expect(gw.encodeNpub).toHaveBeenCalledWith('hex')
  })

  it('should delegate encodeNprofile to gateway', () => {
    const gw = createMockGateway()
    const svc = new CryptoService(gw)
    expect(svc.encodeNprofile('hex', ['wss://relay'])).toBe('nprofile1xxx')
    expect(gw.encodeNprofile).toHaveBeenCalledWith('hex', ['wss://relay'])
  })

  it('should delegate decodeNpub to gateway', () => {
    const gw = createMockGateway()
    const svc = new CryptoService(gw)
    expect(svc.decodeNpub('npub1test')).toEqual({ type: 'npub', data: 'hex123' })
  })

  it('should delegate derivePOSSubKey to gateway', () => {
    const gw = createMockGateway()
    const svc = new CryptoService(gw)
    const key = svc.derivePOSSubKey('mnemonic', 0)
    expect(key.index).toBe(0)
    expect(gw.derivePOSSubKey).toHaveBeenCalledWith('mnemonic', 0)
  })

  it('should delegate getP2PKPubkey to gateway', () => {
    const gw = createMockGateway()
    const svc = new CryptoService(gw)
    expect(svc.getP2PKPubkey('privkey')).toBe('02abc')
  })
})
