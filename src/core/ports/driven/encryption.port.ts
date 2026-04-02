export interface EncryptedData {
  ciphertext: string  // Base64
  salt: string        // Hex
  iv: string          // Hex
}

export interface Encryption {
  encrypt(data: string, password: string): Promise<EncryptedData>
  decrypt(encrypted: EncryptedData, password: string): Promise<string>
  hashPassword(password: string, salt: string): Promise<string>
}
