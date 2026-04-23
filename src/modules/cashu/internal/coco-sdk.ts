/**
 * Coco SDK — Manager 인스턴스 관리
 *
 * Coco Manager singleton과 관련 유틸.
 * Phase 7: coco/manager.ts에서 이 파일로 완전 이전 완료.
 */
import { initializeCoco, type Manager, type MintQuote, ConsoleLogger, normalizeMintUrl } from 'coco-cashu-core'
import { IndexedDbRepositories } from 'coco-cashu-indexeddb'
import { getSeed } from './seed-getter'

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

  const logger = new ConsoleLogger('coco', { level: 'info' })

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
  console.log('[Coco] Manager initialized (watchers pending — call enableWatchers() after unlock)')
  return manager
}

export async function resetCocoManager(): Promise<void> {
  if (managerInstance) {
    await managerInstance.dispose()
    managerInstance = null
    initPromise = null
    reposInstance = null
    watchersEnabled = false
  }
}

export async function deleteCocoData(): Promise<void> {
  await resetCocoManager()
  return new Promise<void>((resolve) => {
    const request = indexedDB.deleteDatabase('zappi-coco-wallet')
    request.onsuccess = () => { console.log('[Coco] Database deleted'); resolve() }
    request.onerror = () => { console.error('[Coco] Delete failed:', request.error); resolve() }
    request.onblocked = () => { console.warn('[Coco] Delete blocked'); resolve() }
  })
}

export function isCocoInitialized(): boolean {
  return managerInstance !== null
}

let watchersEnabled = false

export async function enableWatchers(): Promise<void> {
  if (watchersEnabled) return
  const manager = await getCocoManager()
  const isOnline = typeof navigator !== 'undefined' && navigator.onLine
  if (isOnline) {
    await manager.enableMintOperationWatcher({ watchExistingPendingOnStart: true })
    await manager.enableProofStateWatcher()
    watchersEnabled = true
    console.log('[Coco] Watchers enabled')
  }
}

export async function recheckPendingMintQuotes(): Promise<void> {
  if (!watchersEnabled) return
  const manager = await getCocoManager()
  await manager.disableMintOperationWatcher()
  await manager.enableMintOperationWatcher({ watchExistingPendingOnStart: true })
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
    ])
  })
}
