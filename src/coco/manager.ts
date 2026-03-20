/**
 * Coco Manager - Singleton instance for Cashu wallet operations
 */
import { initializeCoco, type Manager, type MintQuote, ConsoleLogger } from 'coco-cashu-core';
import { IndexedDbRepositories } from 'coco-cashu-indexeddb';
import { getSeed } from './seedGetter';
import { connectCocoToStore } from './bridge';

let managerInstance: Manager | null = null;
let initPromise: Promise<Manager> | null = null;
let reposInstance: IndexedDbRepositories | null = null;

/**
 * Initialize and get the Coco Manager instance
 * Uses IndexedDB for persistent storage
 */
export async function getCocoManager(): Promise<Manager> {
  if (managerInstance) {
    return managerInstance;
  }

  if (initPromise) {
    return initPromise;
  }

  initPromise = initializeManager();
  return initPromise;
}

async function initializeManager(): Promise<Manager> {
  const repos = new IndexedDbRepositories({
    name: 'zappi-coco-wallet',
  });
  reposInstance = repos;

  const logger = new ConsoleLogger('coco', { level: 'info' });

  // Watchers를 명시적으로 비활성화하여 초기화
  // 1) seed(nostrPrivkey)가 unlock 전에는 사용 불가 → getSeed() 실패 방지
  // 2) bridge 연결 전 이벤트 유실 방지
  // enableWatchers()를 unlock 후 호출
  const manager = await initializeCoco({
    repo: repos,
    seedGetter: getSeed,
    logger,
    watchers: {
      mintQuoteWatcher: { disabled: true },
      proofStateWatcher: { disabled: true },
    },
  });

  managerInstance = manager;

  // Connect Coco events to Zustand store
  // Watchers는 여기서 시작하지 않음 — seed(nostrPrivkey)가 unlock 후에야 사용 가능
  // enableWatchers()를 unlock 후 호출해야 함
  connectCocoToStore(manager);

  console.log('[Coco] Manager initialized (watchers pending — call enableWatchers() after unlock)');

  return manager;
}

/**
 * Reset the manager instance (for testing or logout)
 */
export async function resetCocoManager(): Promise<void> {
  if (managerInstance) {
    await managerInstance.dispose();
    managerInstance = null;
    initPromise = null;
    reposInstance = null;
    watchersEnabled = false;
  }
}

/**
 * Delete all Coco data (for logout)
 * This removes the entire IndexedDB database
 */
export async function deleteCocoData(): Promise<void> {
  // First dispose the manager
  await resetCocoManager();

  // Delete the IndexedDB database
  return new Promise<void>((resolve) => {
    const request = indexedDB.deleteDatabase('zappi-coco-wallet');
    request.onsuccess = () => {
      console.log('[Coco] Database deleted successfully');
      resolve();
    };
    request.onerror = () => {
      console.error('[Coco] Failed to delete database:', request.error);
      resolve(); // Continue anyway
    };
    request.onblocked = () => {
      console.warn('[Coco] Database deletion blocked');
      resolve(); // Continue anyway
    };
  });
}

/**
 * Check if manager is initialized
 */
export function isCocoInitialized(): boolean {
  return managerInstance !== null;
}

let watchersEnabled = false;

/**
 * Enable Coco watchers (MintQuoteWatcher + ProofStateWatcher)
 * Must be called AFTER unlock — seed(nostrPrivkey)가 필요
 */
export async function enableWatchers(): Promise<void> {
  if (watchersEnabled) return;

  const manager = await getCocoManager();
  const isOnline = typeof navigator !== 'undefined' && navigator.onLine;

  if (isOnline) {
    await manager.enableMintQuoteWatcher({ watchExistingPendingOnStart: true });
    await manager.enableProofStateWatcher();
    watchersEnabled = true;
    console.log('[Coco] Watchers enabled');
  }
}

/**
 * Get all pending (UNPAID/PAID) mint quotes from Coco's internal DB
 */
export async function getPendingMintQuotes(): Promise<MintQuote[]> {
  await getCocoManager(); // ensure initialized
  return reposInstance!.mintQuoteRepository.getPendingMintQuotes();
}

/**
 * Get a specific mint quote from Coco's internal DB
 */
export async function getMintQuote(mintUrl: string, quoteId: string): Promise<MintQuote | null> {
  await getCocoManager(); // ensure initialized
  return reposInstance!.mintQuoteRepository.getMintQuote(mintUrl, quoteId);
}
