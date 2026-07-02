/**
 * Coco SDK — Manager 인스턴스 관리
 *
 * Coco Manager singleton과 관련 유틸.
 * Phase 7: coco/manager.ts에서 이 파일로 완전 이전 완료.
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
  // 예약된 watcher online 재시도 정리 — 로그아웃 후 잔존 리스너가
  // Coco를 재초기화하는 것을 방지 (설계 §7.1-3).
  clearWatcherRetry()
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
    request.onsuccess = () => { logger.info('Database deleted'); resolve() }
    request.onerror = () => { logger.error('Delete failed:', request.error as Error); resolve() }
    request.onblocked = () => { logger.warn('Delete blocked'); resolve() }
  })
}

export function isCocoInitialized(): boolean {
  return managerInstance !== null
}

let watchersEnabled = false
let watcherRetryCleanup: (() => void) | null = null

/**
 * Watcher 활성화. 오프라인 unlock 시 영구 비활성으로 남던 결함 수정 (설계 §7.1-3):
 * 오프라인이면 'online' 1회 리스너로 재시도를 예약한다. 기존에는 재시도가 없어
 * 비행기 모드 unlock 후 세션 내내 mint push가 0이었고, 30초 TLS 폴링이 그 결함을
 * 가려주고 있었다 — 폴링 강등(5단계) 전에 반드시 고쳐야 하는 선행조건.
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
      // 재시도 실패 시 재무장 — 아니면 이 세션의 재시도 기회가 영구 소실된다(코드리뷰 #4)
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
 * pause가 Coco 쪽에서 watcher를 실제로 껐다는 사실을 모듈 플래그에 반영한다
 * (4단계 리뷰 #2): Coco `pauseSubscriptions()`는 mintOperationWatcher를
 * disable하지만, Zappi가 init 시 `disabled: true`로 시작하기 때문에
 * `resumeSubscriptions()`는 그것을 되살리지 않는다. 플래그를 리셋하지 않으면
 * resume의 enableWatchers()가 no-op이 되어(93행 가드) — recheck가 조건부가 된
 * 지금 — 5분 미만 부재 후 세션 내내 mint push가 죽는다.
 * 재활성 비용은 로컬 repo 읽기 + WSS 재구독뿐이다(원격 체크 버스트 없음 —
 * coco dist watchExistingPendingOnStart 확인).
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
