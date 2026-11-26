import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  decryptMessage,
  encryptMessage,
} from '@/adapters/swap-out/electrum/message-crypto'

interface Interop {
  a_sk: string
  a_pub: string
  b_sk: string
  b_pub: string
  plaintext: string
  ciphertext_py: string
}

const interop: Interop = JSON.parse(
  readFileSync('src/__tests__/fixtures/swap-out/nip04-interop.json', 'utf8'),
)

describe('payout message encryption', () => {
  it('decrypts the python produced ciphertext', () => {
    expect(decryptMessage(interop.b_sk, interop.a_pub, interop.ciphertext_py)).toBe(
      interop.plaintext,
    )
  })

  it('round trips through encrypt and decrypt', () => {
    const ciphertext = encryptMessage(interop.a_sk, interop.b_pub, interop.plaintext)
    expect(decryptMessage(interop.b_sk, interop.a_pub, ciphertext)).toBe(interop.plaintext)
  })

  it('emits the expected ciphertext format', () => {
    const ciphertext = encryptMessage(interop.a_sk, interop.b_pub, interop.plaintext)
    expect(ciphertext).toMatch(/^[A-Za-z0-9+/=]+\?iv=[A-Za-z0-9+/=]{24}$/)
  })
})
