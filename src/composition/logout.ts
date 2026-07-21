/**
 * Logout = complete erasure of account data.
 *
 * The old logout deleted data piece-by-piece (settings, transactions, contacts…),
 * so it was vulnerable to enumeration drift; without a registry the funds DB (coco)
 * survived wholesale, and failures were silent, masquerading as success. This module
 * is the single source of the erasure policy.
 *
 * Order is a contract — key invariant: the mnemonic (wallet record) is the last
 * mutable step. If an earlier step (②③) fails anywhere, the wallet record survives,
 * so verifyPassword still works and the user can meaningfully retry logout (every
 * step is idempotent — deleting a missing DB succeeds instantly), and the app stays
 * on the lock screen so onboarding-inheritance is impossible. The reverse order
 * (mnemonic first) produces the worst half-state on failure: mnemonic destroyed +
 * plaintext bearer proofs left behind + retry impossible (NO_WALLET→wrongPin
 * misindication) + the next onboarded account inheriting the prior funds/history.
 *
 * ⊗ Grace DB (before ⓪) — deletes the whole dedicated zappi-grace DB, which holds a
 *    PIN-free decryptable mnemonic copy (more sensitive than the wallet record).
 *    Throws on failure so a half-completed wipe can never leave a resumable mnemonic
 *    beside a destroyed account.
 * ⓪ Other-tab reload signal (first) — closes the window in which another tab's
 *    in-progress writes revive data mid-erasure. Reloaded tabs sit on lock/onboarding
 *    and don't open coco (coco init is post-unlock). ⑥ fires once more after erasure
 *    to catch tabs opened during it.
 * ① Stop this tab's writers — support.destroy() + registry.dispose() (keeps timers/
 *    sockets/watchers from reviving the DB during or after erasure). Erasure proceeds
 *    even with no registry (pre-bootstrap).
 * ② Delete funds DB (coco) — awaited with timeout (no silent success when blocked).
 * ③ Erase zappi DB — clear-first, delete-best-effort. (a) clear every table on the
 *    live connection (no version bump — can't be blocked by open tabs, dynamic
 *    enumeration avoids drift) → (b) db.delete() best-effort with timeout (data is
 *    already gone). Can't reverse: Dexie delete() closes its own connection first, so
 *    the fallback can't acquire one at timeout.
 * ④ Delete encrypted wallet (mnemonic, zappi-secure) — only after all data is gone.
 * ⑤ localStorage policy —
 *    Delete: passkey credentials + encrypted PIN (incl. legacy, via removePasskey),
 *          zappi-anchor (keeping it lets a different mnemonic skip full replay and
 *          miss funds), zappi-balance-cache (stale prior-account balance),
 *          zappi_last_alive_at.
 *    Keep: lockout·zappi_invite_* (brute-force defense is account-agnostic device
 *          defense), zappi-language (device preference), zappi.ks.* (device kill switch).
 * ⑥ broadcastSync('logout') re-send → ⑦ store reset. Page reload is the caller's
 *    (MainApp) responsibility.
 *
 * Failures in data-erasure steps (②③(a)④) surface via throw — no fake success.
 * SettingsScreen renders a throw as lock.errorOccurred (false is reserved for PIN error).
 */

import { getDatabase } from '@/adapters/storage/dexie/schema'
import { deleteGraceDatabase } from '@/adapters/storage/unlock-grace.adapter'
import { AnchorStoreAdapter } from '@/adapters/storage/anchor-store.adapter'
import { LocalStorageBalanceCache } from '@/adapters/cache/local-storage-balance-cache.adapter'
import { deleteCocoData } from '@/modules/cashu'
import { broadcastSync } from '@/utils/cross-tab-sync'
import { useAppStore } from '@/store'
import { STORAGE_KEYS } from '@/core/constants'

const ZAPPI_DB_DELETE_TIMEOUT_MS = 5_000

export interface WipeAccountDeps {
  /** Delete the encrypted wallet record in zappi-secure */
  security: { deleteWallet(): Promise<void> }
  /** null = pre-bootstrap/locked — just means there are no writers to stop; erasure is unchanged */
  registry: { support: { destroy(): Promise<void> }; dispose(): void } | null
  /** Remove passkey credentials + encrypted PIN (incl. legacy keys) — injected by the
   *  caller so composition doesn't import ui/services/passkey directly */
  removePasskey: () => void
}

export async function wipeAccountData(deps: WipeAccountDeps): Promise<void> {
  // Grace DB (before every other step). The grace blob is a PIN-free decryptable
  // mnemonic copy — more sensitive than the wallet record — so destroy the whole
  // dedicated DB first and throw on failure: a half-completed wipe must never leave
  // a resumable mnemonic beside a destroyed account, and the user drops to a
  // retryable lock screen with all data still intact.
  await deleteGraceDatabase()

  // ⓪ Stop other tabs (reload) — blocks reviving writes from other tabs during the
  // erasure window. Residual window (accepted): if a user completes PIN entry in a
  // reloaded lock tab within the erasure window (~seconds), an empty coco DB can be
  // recreated, but ⑥'s re-send reloads that tab again.
  broadcastSync('logout')

  // ① Stop this tab's writers — keep erasing even on failure (aborting leaves more data behind)
  if (deps.registry) {
    await deps.registry.support.destroy().catch((e) => {
      console.warn('[Logout] support.destroy failed — continuing wipe:', e)
    })
    try {
      deps.registry.dispose()
    } catch (e) {
      console.warn('[Logout] registry.dispose failed — continuing wipe:', e)
    }
  }

  // ② Funds DB (coco) — throw on failure; the wallet record still exists, so retry is possible
  await deleteCocoData()

  // ③ zappi DB — clear-first, delete-best-effort
  const db = getDatabase()
  await Promise.all(db.tables.map((table) => table.clear()))
  try {
    await withTimeout(db.delete(), ZAPPI_DB_DELETE_TIMEOUT_MS, 'zappi DB delete')
  } catch (e) {
    // Data already erased in (a) — log the degradation (empty schema shell remains) and continue
    console.warn('[Logout] zappi DB delete blocked/failed after clear (data already wiped):', e)
  }

  // ④ Encrypted wallet (mnemonic) — the last mutable step; reaching here means account data is already gone
  await deps.security.deleteWallet()

  // ⑤ localStorage policy
  deps.removePasskey()
  new AnchorStoreAdapter().clearCachedAnchor()
  new LocalStorageBalanceCache().clear()
  localStorage.removeItem(STORAGE_KEYS.LAST_ALIVE)

  // ⑥ Reload any tabs that may have opened during erasure
  broadcastSync('logout')

  // ⑦ Store reset — prevents residue before reload
  useAppStore.getState().resetAll()
}

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`${label} timed out after ${ms}ms`))
    }, ms)
    promise.then(
      (value) => {
        clearTimeout(timer)
        resolve(value)
      },
      (error) => {
        clearTimeout(timer)
        reject(error)
      },
    )
  })
}
