export interface DerivedKey {
  publicKey: string
}

export interface KeyDeriver {
  deriveKey(purpose: string, context: string): Promise<DerivedKey>
  sign(message: Uint8Array, purpose: string, context: string): Promise<Uint8Array>
}
