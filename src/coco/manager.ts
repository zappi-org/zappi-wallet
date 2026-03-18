/**
 * Coco Manager - Singleton instance for Cashu wallet operations
 */
import { initializeCoco, type Manager, ConsoleLogger } from 'coco-cashu-core';
import { IndexedDbRepositories } from 'coco-cashu-indexeddb';
import { getSeed } from './seedGetter';
import { connectCocoToStore } from './bridge';

let managerInstance: Manager | null = null;
let initPromise: Promise<Manager> | null = null;

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

  const logger = new ConsoleLogger('coco', { level: 'info' });

  const isOnline = typeof navigator !== 'undefined' && navigator.onLine;

  const manager = await initializeCoco({
    repo: repos,
    seedGetter: getSeed,
    logger,
    watchers: isOnline
      ? {
          mintQuoteWatcher: { watchExistingPendingOnStart: true },
          proofStateWatcher: { watchExistingInflightOnStart: true },
        }
      : {
          mintQuoteWatcher: { disabled: true },
          proofStateWatcher: { disabled: true },
        },
  });

  managerInstance = manager;

  // Connect Coco events to Zustand store
  connectCocoToStore(manager);

  console.log('[Coco] Manager initialized');

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
