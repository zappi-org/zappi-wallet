/**
 * Dev-only automation seed — `?seed=1`: provisions a wallet and unlocks it, so a fresh
 * profile reaches the app shell without walking onboarding.
 *
 * Dev-gated: `import.meta.env.DEV` is folded to `false` in production, so the whole path
 * (and the public test-vector mnemonic below) is dropped from the prod bundle.
 */

export const DEV_SEED_PIN = '123456'

/** Public BIP-39 test vector: known to everyone, dev only, never real funds. */
export const DEV_SEED_MNEMONIC =
  'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about'

export const DEV_SEED_QUERY_KEY = 'seed'

/**
 * Script-injected mnemonic (Orca: `orca storage local set --key zappi.dev-seed`). Overrides the
 * built-in vector, so a runbook can own its seed instead of relying on the app's constant.
 */
export const DEV_SEED_STORAGE_KEY = 'zappi.dev-seed'

/** Injected mnemonic, or null when absent/short. 12 words minimum — anything else is a typo. */
export function readInjectedSeed(storage: Pick<Storage, 'getItem'> = window.localStorage): string | null {
  const value = storage.getItem(DEV_SEED_STORAGE_KEY)?.trim()
  return value && value.split(/\s+/).length >= 12 ? value : null
}

/** Dev build AND `?seed` present. */
export function isDevSeedRequested(search: string = window.location.search): boolean {
  if (!import.meta.env.DEV) return false
  return new URLSearchParams(search).has(DEV_SEED_QUERY_KEY)
}

/**
 * Create the dev wallet when none exists. Never throws — a failed seed just leaves the
 * app on its normal onboarding path, which is a clearer failure than a blank screen.
 */
export async function seedDevWallet(
  security: {
    hasWallet(): Promise<boolean>
    createWallet(mnemonic: string, password: string): Promise<{ ok: boolean }>
  },
  storage: Pick<Storage, 'getItem'> = window.localStorage,
): Promise<boolean> {
  if (await security.hasWallet()) return false
  const mnemonic = readInjectedSeed(storage) ?? DEV_SEED_MNEMONIC
  const result = await security.createWallet(mnemonic, DEV_SEED_PIN)
  return result.ok
}
