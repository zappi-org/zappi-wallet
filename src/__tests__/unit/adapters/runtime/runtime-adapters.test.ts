import { describe, expect, it } from 'vitest'
import { TrustedMintProviderAdapter } from '@/adapters/runtime/trusted-mint-provider.adapter'

describe('runtime adapters', () => {
  it('checks trusted mints through the injected settings reader', async () => {
    const adapter = new TrustedMintProviderAdapter(() => ['https://mint.example.com/'])

    await expect(adapter.hasTrustedMint('https://mint.example.com')).resolves.toBe(true)
    await expect(adapter.hasTrustedMint('https://other.example.com')).resolves.toBe(false)
  })
})
