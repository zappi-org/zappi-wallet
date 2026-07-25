import { describe, expect, it } from 'vitest'
import {
  decryptSupportAttachment,
  encryptSupportAttachment,
  sha256Hex,
  type EncryptedSupportAttachmentBlob,
} from '@/adapters/customer-support/support-attachment-crypto'

function asArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer
}

function agentToHex(bytes: Uint8Array): string {
  return [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}

function toBase64(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes))
}

function fromBase64(value: string): Uint8Array {
  return Uint8Array.from(atob(value), (character) => character.charCodeAt(0))
}

async function agentSha256Hex(data: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', asArrayBuffer(data))
  return agentToHex(new Uint8Array(digest))
}

async function agentDecrypt(blob: EncryptedSupportAttachmentBlob): Promise<Uint8Array> {
  expect(await agentSha256Hex(blob.ciphertext)).toBe(blob.ciphertextSha256)

  const key = await crypto.subtle.importKey(
    'raw',
    asArrayBuffer(fromBase64(blob.key)),
    { name: 'AES-GCM' },
    false,
    ['decrypt'],
  )
  const plaintext = new Uint8Array(
    await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: asArrayBuffer(fromBase64(blob.iv)) },
      key,
      asArrayBuffer(blob.ciphertext),
    ),
  )

  expect(await agentSha256Hex(plaintext)).toBe(blob.plaintextSha256)
  return plaintext
}

async function agentEncrypt(data: Uint8Array) {
  const keyBytes = Uint8Array.from({ length: 32 }, (_, index) => index)
  const iv = Uint8Array.from({ length: 12 }, (_, index) => 0xf0 + index)
  const key = await crypto.subtle.importKey(
    'raw',
    asArrayBuffer(keyBytes),
    { name: 'AES-GCM' },
    false,
    ['encrypt'],
  )
  const ciphertext = new Uint8Array(
    await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv: asArrayBuffer(iv) },
      key,
      asArrayBuffer(data),
    ),
  )

  return {
    ciphertext,
    key: toBase64(keyBytes),
    iv: toBase64(iv),
    expectedPlaintextSha256: await agentSha256Hex(data),
    expectedCiphertextSha256: await agentSha256Hex(ciphertext),
  }
}

describe('support attachment crypto interoperability', () => {
  it('keeps SHA-256 metadata in the lowercase hex format used by nostr-cs agents', async () => {
    const data = new TextEncoder().encode('abc')

    await expect(sha256Hex(data)).resolves.toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    )
  })

  it('produces client attachment metadata that an agent-compatible implementation decrypts', async () => {
    const plaintext = new TextEncoder().encode('zappi support attachment')
    const encrypted = await encryptSupportAttachment(plaintext)

    const decrypted = await agentDecrypt(encrypted)
    expect(Array.from(decrypted)).toEqual(Array.from(plaintext))
  })

  it('decrypts an attachment produced by an agent-compatible implementation', async () => {
    const plaintext = new TextEncoder().encode('nostr-cs agent attachment')
    const encrypted = await agentEncrypt(plaintext)

    const decrypted = await decryptSupportAttachment(encrypted)
    expect(Array.from(decrypted)).toEqual(Array.from(plaintext))
  })
})
