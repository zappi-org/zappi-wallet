/**
 * Coco SDK — Manager instance management.
 *
 * Coco Manager singleton and related utilities.
 */
import { initializeCoco, type Manager, type MintQuote, normalizeMintUrl } from '@cashu/coco-core'
import { IndexedDbRepositories } from '@cashu/coco-indexeddb'
import { getSeed } from './seed-getter'
import { cocoLogger as logger } from './logger'

let managerInstance: Manager | null = null
let initPromise: Promise<Manager> | null = null
let reposInstance: IndexedDbRepositories | null = null

const COCO_MINT_SCOPED_STORES = [
  'coco_cashu_mints',
  'coco_cashu_keysets',
  'coco_cashu_counters',
  'coco_cashu_proofs',
  'coco_cashu_mint_quotes',
  'coco_cashu_melt_quotes',
  'coco_cashu_send_operations',
  'coco_cashu_melt_operations',
  'coco_cashu_mint_operations',
  'coco_cashu_receive_operations',
  'coco_cashu_auth_sessions',
] as const

export async function getCocoManager(): Promise<Manager> {
  if (managerInstance) return managerInstance
  if (initPromise) return initPromise
  initPromise = initializeManager()
  return initPromise
}

async function initializeManager(): Promise<Manager> {
  const repos = new IndexedDbRepositories({ name: 'zappi-coco-wallet' })
  reposInstance = repos

  const manager = await initializeCoco({
    repo: repos,
    seedGetter: getSeed,
    logger,
    watchers: {
      mintOperationWatcher: { disabled: true },
      proofStateWatcher: { disabled: true },
    },
  })

  managerInstance = manager
  logger.info('Manager initialized (watchers pending — call enableWatchers() after unlock)')
  return manager
}

export async function resetCocoManager(): Promise<void> {
  // Clear any scheduled watcher online-retry so a lingering listener can't
  // re-initialize Coco after logout.
  clearWatcherRetry()
  if (managerInstance) {
    await managerInstance.dispose()
    managerInstance = null
    initPromise = null
    reposInstance = null
    watchersEnabled = false
  }
}

const COCO_DB_DELETE_TIMEOUT_MS = 10_000

/**
 * Delete the funds DB (zappi-coco-wallet) — core of a complete logout wipe.
 *
 * The old version resolved even on onerror/onblocked, faking silent success: if
 * another tab was open the funds DB survived intact yet logout looked successful.
 * We now wait for onsuccess. coco-indexeddb is Dexie-based, so other-tab
 * connections auto-close on versionchange and `blocked` is transient. Timeouts
 * and errors reject so the caller (logout) can't fake success.
 */
export async function deleteCocoData(opts?: { timeoutMs?: number }): Promise<void> {
  await resetCocoManager()
  const timeoutMs = opts?.timeoutMs ?? COCO_DB_DELETE_TIMEOUT_MS
  return new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`Coco DB delete timed out after ${timeoutMs}ms (blocked by another connection?)`))
    }, timeoutMs)
    const request = indexedDB.deleteDatabase('zappi-coco-wallet')
    request.onsuccess = () => {
      clearTimeout(timer)
      logger.info('Database deleted')
      resolve()
    }
    request.onerror = () => {
      clearTimeout(timer)
      logger.error('Delete failed:', request.error as Error)
      reject(request.error ?? new Error('Coco DB delete failed'))
    }
    request.onblocked = () => {
      // Keep waiting — once other tabs close on versionchange, onsuccess follows.
      logger.warn('Delete blocked — waiting for other connections to close')
    }
  })
}

export function isCocoInitialized(): boolean {
  return managerInstance !== null
}

let watchersEnabled = false
let watcherRetryCleanup: (() => void) | null = null

/**
 * Enable watchers. Fixes a defect where an offline unlock left them permanently
 * disabled: when offline, schedule a retry via a one-shot 'online' listener.
 * Without it, an airplane-mode unlock meant zero mint push for the whole session,
 * masked only by the 30s TLS polling.
 */
export async function enableWatchers(): Promise<void> {
  if (watchersEnabled) return

  const isOnline = typeof navigator === 'undefined' || navigator.onLine
  if (!isOnline) {
    scheduleWatcherRetryOnOnline()
    logger.info('Offline — watcher enable deferred until online')
    return
  }

  const manager = await getCocoManager()
  await manager.enableMintOperationWatcher({ watchExistingPendingOnStart: true })
  await manager.enableProofStateWatcher()
  watchersEnabled = true
  clearWatcherRetry()
  logger.info('Watchers enabled')
}

function scheduleWatcherRetryOnOnline(): void {
  if (watcherRetryCleanup || typeof window === 'undefined') return
  const handleOnline = () => {
    clearWatcherRetry()
    enableWatchers().catch((e) => {
      logger.error('Watcher enable retry failed:', e as Error)
      // Re-arm on retry failure, or this session loses its retry chance for good.
      scheduleWatcherRetryOnOnline()
    })
  }
  window.addEventListener('online', handleOnline)
  watcherRetryCleanup = () => window.removeEventListener('online', handleOnline)
}

function clearWatcherRetry(): void {
  if (watcherRetryCleanup) {
    watcherRetryCleanup()
    watcherRetryCleanup = null
  }
}

export async function recheckPendingMintQuotes(): Promise<void> {
  if (!watchersEnabled) return
  const manager = await getCocoManager()
  await manager.disableMintOperationWatcher()
  await manager.enableMintOperationWatcher({ watchExistingPendingOnStart: true })
}

/**
 * Reflect in the module flag that pause actually turned the watcher off on Coco's
 * side. Coco's `pauseSubscriptions()` disables mintOperationWatcher, but because
 * Zappi starts with `disabled: true` at init, `resumeSubscriptions()` doesn't
 * bring it back. If we don't reset the flag, resume's enableWatchers() becomes a
 * no-op (guarded above) and — now that recheck is conditional — mint push dies for
 * the whole session after an absence under 5 minutes. Re-enabling only costs a
 * local repo read plus WSS re-subscribe (no remote-check burst — confirmed via
 * coco dist watchExistingPendingOnStart).
 */
export function suspendWatchers(): void {
  watchersEnabled = false
}

export async function getPendingMintQuotes(): Promise<MintQuote[]> {
  await getCocoManager()
  return reposInstance!.mintQuoteRepository.getPendingMintQuotes()
}

export async function getMintQuote(mintUrl: string, quoteId: string): Promise<MintQuote | null> {
  await getCocoManager()
  return reposInstance!.mintQuoteRepository.getMintQuote(mintUrl, quoteId)
}

export async function abandonMintQuote(mintUrl: string, quoteId: string): Promise<void> {
  const normalizedMintUrl = normalizeMintUrl(mintUrl)
  await getCocoManager()

  if (!reposInstance) return

  await reposInstance.db.runTransaction(
    'rw',
    ['coco_cashu_mint_quotes', 'coco_cashu_mint_operations'],
    async (tx) => {
      const operations = await tx.table('coco_cashu_mint_operations')
        .where('[mintUrl+quoteId]')
        .equals([normalizedMintUrl, quoteId])
        .toArray()

      for (const operation of operations) {
        await tx.table('coco_cashu_mint_operations').delete(operation.id)
      }

      await tx.table('coco_cashu_mint_quotes').delete([normalizedMintUrl, quoteId])
    },
  )
}

export async function removeMintFromCoco(mintUrl: string): Promise<void> {
  const normalizedMintUrl = normalizeMintUrl(mintUrl)
  await getCocoManager()

  if (!reposInstance) return

  await reposInstance.db.runTransaction('rw', [...COCO_MINT_SCOPED_STORES], async (tx) => {
    await Promise.all([
      tx.table('coco_cashu_mints').delete(normalizedMintUrl),
      tx.table('coco_cashu_keysets').where('mintUrl').equals(normalizedMintUrl).delete(),
      tx.table('coco_cashu_counters').where('[mintUrl+keysetId]').between([normalizedMintUrl, ''], [normalizedMintUrl, '\uffff']).delete(),
      tx.table('coco_cashu_proofs').where('mintUrl').equals(normalizedMintUrl).delete(),
      tx.table('coco_cashu_mint_quotes').where('mintUrl').equals(normalizedMintUrl).delete(),
      tx.table('coco_cashu_melt_quotes').where('mintUrl').equals(normalizedMintUrl).delete(),
      tx.table('coco_cashu_send_operations').where('mintUrl').equals(normalizedMintUrl).delete(),
      tx.table('coco_cashu_melt_operations').where('mintUrl').equals(normalizedMintUrl).delete(),
      tx.table('coco_cashu_mint_operations').where('mintUrl').equals(normalizedMintUrl).delete(),
      tx.table('coco_cashu_receive_operations').where('mintUrl').equals(normalizedMintUrl).delete(),
      tx.table('coco_cashu_auth_sessions').delete(normalizedMintUrl),
    ])
  })
}
