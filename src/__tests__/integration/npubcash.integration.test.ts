import { describe, it, expect, beforeAll } from 'vitest'
import { NpubcashAdapter } from '@/adapters/npubcash/npubcash.adapter'
import { Secp256k1NostrSignerAdapter } from '@/adapters/crypto/secp256k1-nostr-signer'
import type { AuthSession } from '@/core/ports/driven/payment-alias-provider.port'

const PRIVKEY = '0000000000000000000000000000000000000000000000000000000000000001'
const BASE_URL = 'http://localhost:8000'

const signer = new Secp256k1NostrSignerAdapter(PRIVKEY)
const adapter = new NpubcashAdapter(BASE_URL)

describe('NpubcashAdapter — e2e flow (localhost:8000)', () => {
  let session: AuthSession | null = null

  it('1. authenticate', async () => {
    const result = await adapter.authenticate(signer)
    expect(result.isOk()).toBe(true)
    session = result.unwrap()
    console.log('JWT:', session.token.slice(0, 50) + '...')
  })

  it('2. getAccountInfo', async () => {
    expect(session).not.toBeNull()
    const result = await adapter.getAccountInfo(session!)
    console.log('accountInfo:', result.isOk() ? JSON.stringify(result.unwrap()) : result.error.message)
    expect(result.isOk()).toBe(true)
    if (result.isOk()) {
      console.log('  alias:', result.value.alias)
      console.log('  mintUrl:', result.value.mintUrl)
      console.log('  lockQuote:', result.value.lockQuote)
    }
  })

  it('3. setPreferredMint', async () => {
    expect(session).not.toBeNull()
    const result = await adapter.setPreferredMint(session!, 'https://mint.lemonfizz.st')
    console.log('setPreferredMint:', result.isOk() ? 'OK' : result.error.message)
    expect(result.isOk()).toBe(true)
  })

  it('4. toggleLock', async () => {
    expect(session).not.toBeNull()
    const result = await adapter.toggleLock(session!)
    console.log('toggleLock:', result.isOk() ? 'OK lockQuote=' + result.value : result.error.message)
    expect(result.isOk()).toBe(true)
  })

  it('5. getPaidQuotes', async () => {
    expect(session).not.toBeNull()
    const result = await adapter.getPaidQuotes(session!)
    if (result.isOk()) {
      console.log('paidQuotes:', JSON.stringify(result.value))
    } else {
      console.log('paidQuotes error:', result.error.message)
    }
  })
})
