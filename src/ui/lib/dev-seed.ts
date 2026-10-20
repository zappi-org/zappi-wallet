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

/** Dev build AND `?seed` present. */
export function isDevSeedRequested(search: string = window.location.search): boolean {
  if (!import.meta.env.DEV) return false
  return new URLSearchParams(search).has(DEV_SEED_QUERY_KEY)
}

/**
 * Create the dev wallet when none exists. Never throws — a failed seed just leaves the
 * app on its normal onboarding path, which is a clearer failure than a blank screen.
 */
export async function seedDevWallet(security: {
  hasWallet(): Promise<boolean>
  createWallet(mnemonic: string, password: string): Promise<{ ok: boolean }>
}): Promise<boolean> {
  if (await security.hasWallet()) return false
  const result = await security.createWallet(DEV_SEED_MNEMONIC, DEV_SEED_PIN)
  return result.ok
}
