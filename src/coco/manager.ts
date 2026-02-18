/**
 * Coco Manager - Singleton instance for Cashu wallet operations
 */
import { Manager, ConsoleLogger } from 'coco-cashu-core';
import { IndexedDbRepositories } from 'coco-cashu-indexeddb';
import { getSeed } from './seedGetter';
import { connectCocoToStore } from './bridge';

let managerInstance: Manager | null = null;
let initPromise: Promise<Manager> | null = null;

// Timeout for watcher initialization (5 seconds)
const WATCHER_INIT_TIMEOUT_MS = 5000;

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
  // Create IndexedDB repositories
  const repos = new IndexedDbRepositories({
    name: 'zappi-coco-wallet',
  });
  await repos.init();

  // Create logger
  const logger = new ConsoleLogger('coco', { level: 'info' });

  // Create manager with seed getter
  const manager = new Manager(repos, getSeed, logger);

  // Enable watchers for automatic state tracking (with timeout for offline resilience)
  // Watchers may try to connect to mints, so we add timeout and catch errors
  if (navigator.onLine) {
    try {
      const watcherPromise = Promise.all([
        manager.enableMintQuoteWatcher({ watchExistingPendingOnStart: true }),
        manager.enableProofStateWatcher(),
      ]);
      const timeoutPromise = new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('Watcher init timeout')), WATCHER_INIT_TIMEOUT_MS)
      );
      await Promise.race([watcherPromise, timeoutPromise]);
    } catch (err) {
      console.warn('[Coco] Watcher initialization failed or timed out:', err);
      // Continue without watchers - they can be enabled later when online
    }
  } else {
    console.log('[Coco] Offline - skipping watcher initialization');
  }

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
