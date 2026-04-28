import { describe, expect, it, vi } from 'vitest'
import * as bip39 from '@scure/bip39'
import { HDKey } from '@scure/bip32'
import { DerivedCustomerSupportKeyProvider } from '@/adapters/customer-support/derived-customer-support-key-provider'
import { KeyManagerAdapter } from '@/adapters/crypto/key-manager.adapter'

describe('DerivedCustomerSupportKeyProvider', () => {
  it('derives a deterministic support-only key distinct from the wallet Nostr key', async () => {
    const mnemonic = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about'
    const seed = bip39.mnemonicToSeedSync(mnemonic)

    const supportA = new DerivedCustomerSupportKeyProvider(seed)
    const supportB = new DerivedCustomerSupportKeyProvider(seed)
    const walletKey = new KeyManagerAdapter().deriveNostrKeyPair(mnemonic)

    expect(await supportA.getPubkey()).toBe(await supportB.getPubkey())
    expect(await supportA.getPubkey()).not.toBe(walletKey.publicKey)
  })

  it('signs with the derived support identity and refuses use after destroy', async () => {
    const provider = new DerivedCustomerSupportKeyProvider(new Uint8Array(64).fill(7))
    const pubkey = await provider.getPubkey()

    const signed = await provider.sign({
      kind: 7700,
      tags: [],
      content: 'support',
      created_at: 1,
    })

    expect(signed.pubkey).toBe(pubkey)
    provider.destroy()
    await expect(provider.getPubkey()).rejects.toThrow('destroyed')
  })

  it('wipes intermediate HDKey private material after derivation', async () => {
    const wipeSpy = vi.spyOn(HDKey.prototype, 'wipePrivateData')

    try {
      const provider = new DerivedCustomerSupportKeyProvider(new Uint8Array(64).fill(9))

      expect(await provider.getPubkey()).toHaveLength(64)
      expect(wipeSpy).toHaveBeenCalledTimes(2)
    } finally {
      wipeSpy.mockRestore()
    }
  })
})
