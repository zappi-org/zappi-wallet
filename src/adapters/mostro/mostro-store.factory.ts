import { rawKeyEncryptor, type Store } from 'mostro-ts-client'
import { openIndexedDbStore } from 'mostro-ts-client/browser'
import { deriveMostroStoreKey } from './mostro-store-key'

const DEFAULT_DB_NAME = 'zappi-mostro'

/**
 * Build the Mostro persistence store backed by IndexedDB.
 *
 * The store holds per-trade secret keys, so it is always encrypted at rest with
 * a wallet-seed-derived key (never plaintext).
 */
export function createMostroStore(seed: Uint8Array, dbName: string = DEFAULT_DB_NAME): Store {
  return openIndexedDbStore({
    dbName,
    encryptor: rawKeyEncryptor(deriveMostroStoreKey(seed)),
  })
}
