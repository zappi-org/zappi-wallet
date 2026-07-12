/**
 * EncryptionAdapter — crypto.subtle wrapper (AES-256-GCM + PBKDF2).
 *
 * Browser-native Web Crypto API. Zero added bundle size.
 */

import type { Encryption, EncryptedData } from '@/core/ports/driven/encryption.port'
import { bytesToHex, hexToBytes } from '@noble/hashes/utils.js'

// This adapter does not own the iteration count — policy is decided by the service
// layer (KDF_ITERATIONS) and this executor applies the iterations it is passed as-is.

export class EncryptionAdapter implements Encryption {
  async encrypt(data: string, password: string, iterations: number): Promise<EncryptedData> {
    const salt = crypto.getRandomValues(new Uint8Array(16))
    const iv = crypto.getRandomValues(new Uint8Array(12))

    const key = await this.deriveKey(password, salt, iterations)
    const encoded = new TextEncoder().encode(data)

    const encrypted = await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv: iv as Uint8Array<ArrayBuffer> },
      key,
      encoded,
    )

    return {
      ciphertext: arrayBufferToBase64(encrypted),
      salt: bytesToHex(salt),
      iv: bytesToHex(iv),
    }
  }

  async decrypt(encrypted: EncryptedData, password: string, iterations: number): Promise<string> {
    const salt = hexToBytes(encrypted.salt)
    const iv = hexToBytes(encrypted.iv)
    const cipherBytes = new Uint8Array(base64ToArrayBuffer(encrypted.ciphertext))

    const key = await this.deriveKey(password, salt, iterations)

    const decrypted = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: iv as Uint8Array<ArrayBuffer> },
      key,
      cipherBytes,
    )

    return new TextDecoder().decode(decrypted)
  }

  async hashPassword(password: string, salt: string, iterations: number): Promise<string> {
    const encoder = new TextEncoder()
    const keyMaterial = await crypto.subtle.importKey(
      'raw',
      encoder.encode(password),
      'PBKDF2',
      false,
      ['deriveBits'],
    )

    const bits = await crypto.subtle.deriveBits(
      {
        name: 'PBKDF2',
        // v1 semantics frozen: encode the salt hex string directly via TextEncoder.
        // Changing this encoding breaks verification of existing records — only iterations are parameterized.
        salt: encoder.encode(salt),
        iterations,
        hash: 'SHA-256',
      },
      keyMaterial,
      256,
    )

    return bytesToHex(new Uint8Array(bits))
  }

  private async deriveKey(password: string, salt: Uint8Array, iterations: number): Promise<CryptoKey> {
    const keyMaterial = await crypto.subtle.importKey(
      'raw',
      new TextEncoder().encode(password),
      'PBKDF2',
      false,
      ['deriveKey'],
    )

    return crypto.subtle.deriveKey(
      {
        name: 'PBKDF2',
        salt: new Uint8Array(salt),
        iterations,
        hash: 'SHA-256',
      },
      keyMaterial,
      { name: 'AES-GCM', length: 256 },
      false,
      ['encrypt', 'decrypt'],
    )
  }
}

// ─── Helpers ───

// hex conversion is unified on @noble/hashes — the old local hexToBytes silently produced
// garbage on malformed input, but noble throws. This adapter's hex inputs are all
// self-generated round-trips (salt/iv), so validity is guaranteed — fail-loud is pure win.

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer)
  let binary = ''
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i])
  }
  return btoa(binary)
}

function base64ToArrayBuffer(base64: string): ArrayBuffer {
  const binary = atob(base64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i)
  }
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)
}
