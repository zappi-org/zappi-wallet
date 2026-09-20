export interface ChatStorageKeyRecord {
  account: string;
  version: 1;
  wrappedKey: string;
}

export interface ChatStorageKeyStore {
  /** Returns the committed winner when multiple sessions initialize together. */
  getOrCreate(
    account: string,
    candidate: ChatStorageKeyRecord
  ): Promise<ChatStorageKeyRecord>;
}
