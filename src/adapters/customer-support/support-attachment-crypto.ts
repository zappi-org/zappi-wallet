import { bytesToHex } from '@noble/hashes/utils.js'

function toBase64(bytes: Uint8Array): string {
  let output = ''
  for (let i = 0; i < bytes.length; i += 0x8000) {
    output += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  }
  return btoa(output)
}

function fromBase64(value: string): Uint8Array {
  const binary = atob(value)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i)
  }
  return bytes
}

function asArrayBuffer(bytes: Uint8Array): Uint8Array {
  return bytes
}

export interface EncryptedSupportAttachmentBlob {
  ciphertext: Uint8Array
  key: string
  iv: string
  plaintextSha256: string
  ciphertextSha256: string
}

export async function sha256Hex(data: Uint8Array): Promise<string> {
  const hash = await crypto.subtle.digest('SHA-256', asArrayBuffer(data))
  return bytesToHex(new Uint8Array(hash))
}

export async function encryptSupportAttachment(data: Uint8Array): Promise<EncryptedSupportAttachmentBlob> {
  const keyBytes = crypto.getRandomValues(new Uint8Array(32))
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const cryptoKey = await crypto.subtle.importKey('raw', asArrayBuffer(keyBytes), { name: 'AES-GCM' }, false, ['encrypt'])
  const ciphertext = new Uint8Array(
    await crypto.subtle.encrypt({ name: 'AES-GCM', iv: asArrayBuffer(iv) }, cryptoKey, asArrayBuffer(data)),
  )
  const [plaintextSha256, ciphertextSha256] = await Promise.all([
    sha256Hex(data),
    sha256Hex(ciphertext),
  ])

  return {
    ciphertext,
    key: toBase64(keyBytes),
    iv: toBase64(iv),
    plaintextSha256,
    ciphertextSha256,
  }
}

export async function decryptSupportAttachment(args: {
  ciphertext: Uint8Array
  key: string
  iv: string
  expectedPlaintextSha256: string
  expectedCiphertextSha256: string
}): Promise<Uint8Array> {
  const ciphertextSha256 = await sha256Hex(args.ciphertext)
  if (ciphertextSha256 !== args.expectedCiphertextSha256) {
    throw new Error('Attachment download integrity check failed')
  }

  const keyBytes = fromBase64(args.key)
  const iv = fromBase64(args.iv)
  const cryptoKey = await crypto.subtle.importKey('raw', asArrayBuffer(keyBytes), { name: 'AES-GCM' }, false, ['decrypt'])
  const plaintext = new Uint8Array(
    await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: asArrayBuffer(iv) },
      cryptoKey,
      asArrayBuffer(args.ciphertext),
    ),
  )
  const plaintextSha256 = await sha256Hex(plaintext)
  if (plaintextSha256 !== args.expectedPlaintextSha256) {
    throw new Error('Attachment decrypt integrity check failed')
  }

  return plaintext
}
