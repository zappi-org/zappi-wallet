import { describe, it, expect, vi } from 'vitest'
import { UsernameService } from '@/core/services/username.service'
import type { LightningAddressProvider } from '@/core/ports/driven/lightning-address.port'
import { ok } from '@/core/types/result'

function createMockProvider(): LightningAddressProvider {
  return {
    registerAddress: vi.fn().mockResolvedValue(ok({ address: 'user@zappi.space', username: 'user', npub: 'npub1x', isCustom: false })),
    getAddress: vi.fn().mockResolvedValue(ok({ address: 'user@zappi.space', username: 'user', npub: 'npub1x', isCustom: false })),
    checkUsername: vi.fn().mockResolvedValue(ok({ available: true })),
    changeUsername: vi.fn().mockResolvedValue(ok({ address: 'new@zappi.space', username: 'new', npub: 'npub1x', isCustom: true })),
    getDefaults: vi.fn().mockResolvedValue(ok({ mintUrl: 'https://mint', relays: [], acceptedMints: [], addressFee: 0, minSendable: 1, maxSendable: 1000000 })),
  }
}

describe('UsernameService', () => {
  it('should check username availability', async () => {
    const provider = createMockProvider()
    const svc = new UsernameService(provider)
    const result = await svc.checkUsername('testuser')
    expect(result.isOk()).toBe(true)
    expect(result.unwrap().available).toBe(true)
  })

  it('should register address', async () => {
    const provider = createMockProvider()
    const svc = new UsernameService(provider)
    const result = await svc.registerAddress('privkey')
    expect(result.isOk()).toBe(true)
    expect(result.unwrap().address).toBe('user@zappi.space')
  })

  it('should change username', async () => {
    const provider = createMockProvider()
    const svc = new UsernameService(provider)
    const result = await svc.changeUsername('privkey', 'new', 'cashuAtoken')
    expect(result.isOk()).toBe(true)
    expect(result.unwrap().username).toBe('new')
  })

  it('should get defaults', async () => {
    const provider = createMockProvider()
    const svc = new UsernameService(provider)
    const result = await svc.getDefaults()
    expect(result.isOk()).toBe(true)
  })
})
