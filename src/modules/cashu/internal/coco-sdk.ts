/**
 * Coco SDK — Manager 인스턴스 관리
 *
 * Coco Manager singleton과 관련 유틸.
 * Phase 7: coco/manager.ts에서 이 파일로 완전 이전 완료.
 */
import { initializeCoco, type Manager, type MintQuote, ConsoleLogger } from 'coco-cashu-core'
import { IndexedDbRepositories } from 'coco-cashu-indexeddb'
import { getSeed } from './seed-getter'

let managerInstance: Manager | null = null
let initPromise: Promise<Manager> | null = null
let reposInstance: IndexedDbRepositories | null = null

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
