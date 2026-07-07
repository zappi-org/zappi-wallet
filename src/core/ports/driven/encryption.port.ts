export interface EncryptedData {
  ciphertext: string  // Base64
  salt: string        // Hex
  iv: string          // Hex
}

export interface Encryption {
  /**
   * PBKDF2 derivation executor — does not own the iteration-count policy.
   * `iterations` is decided by the caller (the service-layer `KDF_ITERATIONS` map).
   */
  encrypt(data: string, password: string, iterations: number): Promise<EncryptedData>
  decrypt(encrypted: EncryptedData, password: string, iterations: number): Promise<string>
  hashPassword(password: string, salt: string, iterations: number): Promise<string>
}
