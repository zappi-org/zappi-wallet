/**
 * Production stand-in, wired via `resolve.alias` in vite.config.ts: a static import of
 * `@/ui/lib/dev-seed` fails to build instead of shipping the mnemonic.
 * A relative import bypasses the alias — `check:seed-leak` covers that case.
 */

export const DEV_SEED_PIN = ''
export const DEV_SEED_QUERY_KEY = 'seed'
export const DEV_SEED_STORAGE_KEY = '' /* no injection in production */

export function isDevSeedRequested(): boolean {
  return false
}

export function readInjectedSeed(): null {
  return null
}

export async function seedDevWallet(): Promise<boolean> {
  return false
}
