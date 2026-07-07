/**
 * EncryptionAdapter — crypto.subtle 래핑 (AES-256-GCM + PBKDF2)
 *
 * 브라우저 네이티브 Web Crypto API. 번들 크기 추가 0.
 */

import type { Encryption, EncryptedData } from '@/core/ports/driven/encryption.port'
import { bytesToHex, hexToBytes } from '@noble/hashes/utils.js'

// 반복수 상수는 이 어댑터가 소유하지 않는다 — 정책은 서비스 층(KDF_ITERATIONS)이
// 결정하고 이 실행자는 인자로 받은 iterations 를 그대로 적용한다 (docs/design/kdf-upgrade.md §5.2).

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
        // v1 의미 동결 (§1.3): salt hex 문자열을 그대로 TextEncoder 로 인코딩한다.
        // 이 인코딩을 바꾸면 기존 레코드 검증이 깨진다 — 반복수만 인자화한다.
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

// hex 변환은 @noble/hashes 로 통일 (Phase 3) — 구 로컬 hexToBytes 는 malformed
// 입력에 무음으로 쓰레기를 만들었지만 noble 은 throw 한다. 이 어댑터의 hex 입력은
// 전부 자기-생성 왕복(salt/iv)이라 유효 보장 — fail-loud 가 순수 이득.

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
