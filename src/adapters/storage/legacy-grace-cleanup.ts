/**
 * Legacy cleanup for the removed unlock-grace store: older builds persisted a
 * PIN-free decryptable mnemonic copy in the 'zappi-grace' IndexedDB. Idempotent
 * — safe to call every boot. Removable once no pre-removal builds remain.
 */

const DB_NAME = 'zappi-grace'
const DELETE_TIMEOUT_MS = 10_000

/** Rejects on failure/timeout so logout's wipe can abort; boot callers
 *  treat it as fire-and-forget. */
export async function deleteLegacyGraceDatabase(opts?: { timeoutMs?: number }): Promise<void> {
  const timeoutMs = opts?.timeoutMs ?? DELETE_TIMEOUT_MS
  await new Promise<void>((resolve, reject) => {
    // blocked is transient: other tabs close on versionchange, then onsuccess
    // fires. Only the timeout turns a stuck delete into a hard failure.
    const timer = setTimeout(() => {
      reject(new Error(`zappi-grace delete timed out after ${timeoutMs}ms (blocked by another connection?)`))
    }, timeoutMs)
    const request = indexedDB.deleteDatabase(DB_NAME)
    request.onsuccess = () => {
      clearTimeout(timer)
      resolve()
    }
    request.onerror = () => {
      clearTimeout(timer)
      reject(request.error ?? new Error('zappi-grace delete failed'))
    }
    request.onblocked = () => {}
  })
}
