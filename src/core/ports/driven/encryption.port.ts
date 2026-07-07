export interface EncryptedData {
  ciphertext: string  // Base64
  salt: string        // Hex
  iv: string          // Hex
}

export interface Encryption {
  /**
   * PBKDF2 파생 실행자 — 반복수 정책을 소유하지 않는다.
   * `iterations` 는 호출자(서비스 층 `KDF_ITERATIONS` 맵)가 결정한다.
   */
  encrypt(data: string, password: string, iterations: number): Promise<EncryptedData>
  decrypt(encrypted: EncryptedData, password: string, iterations: number): Promise<string>
  hashPassword(password: string, salt: string, iterations: number): Promise<string>
}
