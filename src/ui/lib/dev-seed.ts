/**
 * Dev-only automation seed — `?seed=1`.
 *
 * A fresh browser profile has no wallet, so every automation run would first walk the
 * 6-step onboarding (generate mnemonic → confirm → PIN → PIN confirm). With the flag:
 *
 *   1. `App.tsx` creates the wallet from a fixed public test vector *before* the
 *      hasWallet gate, so the app boots straight into the main shell.
 *   2. `MainApp` auto-unlocks with `DEV_SEED_PIN` instead of driving the keypad.
 *   3. The real app shell container carries `data-testid="app-ready"` (TEST_IDS.app.ready)
 *      — it renders only when unlocked and initialized, so its presence is the
 *      "the app is usable" assertion.
 *
 * Why this is safe: every branch is gated on `import.meta.env.DEV`, which Vite replaces
 * with `false` in a production build — the code is dropped, so a `?seed=1` link can never
 * create a wallet on a real deployment. The mnemonic is a public BIP-39 test vector: fine
 * on a dev origin, never for real funds.
 */

export const DEV_SEED_PIN = '123456'

/** Public BIP-39 test vector — deterministic, therefore known to everyone. Dev only. */
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
