export interface ChatStorageCipher {
  assertUnlocked(): void;
  captureGuard(): () => void;
  encrypt(value: string, context: readonly string[]): Promise<string>;
  decrypt(value: string, context: readonly string[]): Promise<string>;
}
