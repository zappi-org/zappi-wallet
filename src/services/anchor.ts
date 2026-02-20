import { SimplePool, nip17 } from 'nostr-tools'
import { hexToBytes } from '@noble/hashes/utils.js'
import { useAppStore } from '@/store'

// Anchor validity period (2 days in milliseconds)
const ANCHOR_VALIDITY_MS = 2 * 24 * 60 * 60 * 1000;

// Network timeout for relay operations (10 seconds)
const NETWORK_TIMEOUT_MS = 10000;

// Anchor message type
export interface AnchorMessage {
  type: 'zappi-anchor';
  v: 1;
  timestamp: number;
}

// Cached anchor interface
export interface CachedAnchor {
  timestamp: number;
  eventId: string;
  cachedAt: number;
}

const ANCHOR_CACHE_KEY = 'zappi-anchor';

/**
 * Get cached anchor from localStorage
 */
export function getCachedAnchor(): CachedAnchor | null {
  try {
    const cached = localStorage.getItem(ANCHOR_CACHE_KEY);
    if (!cached) return null;
    return JSON.parse(cached) as CachedAnchor;
  } catch {
    return null;
  }
}

/**
 * Set cached anchor to localStorage
 */
export function setCachedAnchor(anchor: CachedAnchor): void {
  localStorage.setItem(ANCHOR_CACHE_KEY, JSON.stringify(anchor));
}

/**
 * Clear cached anchor
 */
export function clearCachedAnchor(): void {
  localStorage.removeItem(ANCHOR_CACHE_KEY);
}

/**
 * Check if anchor is still valid (within 2 days)
 */
export function isAnchorValid(timestamp: number): boolean {
  const now = Date.now();
  const anchorTime = timestamp * 1000; // Convert to ms
  return (now - anchorTime) < ANCHOR_VALIDITY_MS;
}

/**
 * Helper to add timeout to promises
 */
function withTimeout<T>(promise: Promise<T>, ms: number, errorMsg: string): Promise<T> {
  // Prevent unhandled rejection if timeout wins the race
  promise.catch(() => {})
  return Promise.race([
    promise,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error(errorMsg)), ms)
    ),
  ]);
}

/**
 * Publish anchor to self using NIP-17 Gift Wrap
 */
export async function publishAnchor(): Promise<CachedAnchor | null> {
  // Skip if offline
  if (!navigator.onLine) {
    console.log('[Anchor] Offline - skipping publish');
    return null;
  }

  const { settings, nostrPubkey, nostrPrivkey } = useAppStore.getState()
  const relays = settings.relays
  const publicKey = nostrPubkey
  const privateKey = nostrPrivkey

  if (!publicKey || !privateKey) {
    console.error('[Anchor] No keys available')
    return null
  }

  try {
    const now = Math.floor(Date.now() / 1000)

    const anchorMessage: AnchorMessage = {
      type: 'zappi-anchor',
      v: 1,
      timestamp: now,
    }

    // nip17.wrapEvent signature: (senderPrivateKey, recipient, message, conversationTitle?, replyTo?)
    // recipient must be an object with publicKey property
    const recipient = { publicKey }
    const message = JSON.stringify(anchorMessage);
    const sk = hexToBytes(privateKey)

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const giftWrap = await (nip17 as any).wrapEvent(sk, recipient, message);

    // Publish to relays with timeout
    const pool = new SimplePool();
    const publishResults = await withTimeout(
      Promise.allSettled(
        relays.map(async (url) => {
          try {
            await pool.publish([url], giftWrap);
            return url;
          } catch (err) {
            console.error(`[Anchor] Failed to publish to ${url}:`, err);
            return null;
          }
        })
      ),
      NETWORK_TIMEOUT_MS,
      'Anchor publish timeout'
    );

    pool.close(relays);

    const successCount = publishResults.filter(
      (r) => r.status === 'fulfilled' && r.value
    ).length;
    console.log(`[Anchor] Published to ${successCount}/${relays.length} relays`);

    console.log('[Anchor] Published new anchor:', now);

    const cached: CachedAnchor = {
      timestamp: now,
      eventId: giftWrap.id,
      cachedAt: Date.now(),
    };

    setCachedAnchor(cached);
    return cached;
  } catch (error) {
    console.error('[Anchor] Failed to publish:', error);
    return null;
  }
}

/**
 * Fetch anchors from relays (returns all found anchors)
 */
export async function fetchAnchorsFromRelays(): Promise<CachedAnchor[]> {
  // Skip if offline
  if (!navigator.onLine) {
    console.log('[Anchor] Offline - skipping fetch');
    return [];
  }

  const { settings, nostrPubkey, nostrPrivkey } = useAppStore.getState()
  const relays = settings.relays
  const publicKey = nostrPubkey
  const privateKey = nostrPrivkey

  if (!publicKey || !privateKey) {
    console.error('[Anchor] No keys available')
    return []
  }

  const pool = new SimplePool()
  const sk = hexToBytes(privateKey)
  const anchors: CachedAnchor[] = []

  try {
    // Query kind:1059 (Gift Wrap) events where we are the recipient with timeout
    const events = await withTimeout(
      pool.querySync(relays, {
        kinds: [1059],
        '#p': [publicKey],
      }),
      NETWORK_TIMEOUT_MS,
      'Anchor fetch timeout'
    );

    console.log(`[Anchor] Found ${events.length} Gift Wrap events`);

    for (const event of events) {
      try {
        const unwrapped = await nip17.unwrapEvent(event, sk);
        const content = JSON.parse(unwrapped.content);

        // Check if it's an anchor message
        if (content.type === 'zappi-anchor' && content.v === 1) {
          anchors.push({
            timestamp: content.timestamp,
            eventId: event.id,
            cachedAt: Date.now(),
          });
        }
      } catch {
        // Not our message or not an anchor, skip silently
      }
    }

    pool.close(relays);

    // Sort by timestamp (oldest first)
    anchors.sort((a, b) => a.timestamp - b.timestamp);

    console.log(`[Anchor] Found ${anchors.length} anchors`);
    return anchors;
  } catch (error) {
    console.error('[Anchor] Failed to fetch:', error);
    pool.close(relays);
    return [];
  }
}

/**
 * Main anchor check logic on app start
 * Returns: { anchor: CachedAnchor, isRecoveryMode: boolean, oldestAnchor?: CachedAnchor }
 */
export async function checkAndRefreshAnchor(): Promise<{
  anchor: CachedAnchor | null;
  isRecoveryMode: boolean;
  oldestAnchor?: CachedAnchor;
}> {
  // Case A: Local anchor exists
  const localAnchor = getCachedAnchor();

  if (localAnchor) {
    console.log('[Anchor] Using local anchor:', localAnchor.timestamp);

    // If offline, just use local anchor without refresh
    if (!navigator.onLine) {
      console.log('[Anchor] Offline - using cached anchor');
      return {
        anchor: localAnchor,
        isRecoveryMode: false,
      };
    }

    // Check if needs refresh
    if (!isAnchorValid(localAnchor.timestamp)) {
      console.log('[Anchor] Local anchor expired, publishing new one');
      const newAnchor = await publishAnchor();
      return {
        anchor: newAnchor || localAnchor,
        isRecoveryMode: false,
      };
    }

    return {
      anchor: localAnchor,
      isRecoveryMode: false,
    };
  }

  // If offline and no local anchor, return null
  if (!navigator.onLine) {
    console.log('[Anchor] Offline and no local anchor');
    return {
      anchor: null,
      isRecoveryMode: false,
    };
  }

  // Case B: No local anchor (recovery/reinstall)
  console.log('[Anchor] No local anchor, fetching from relays...');
  const remoteAnchors = await fetchAnchorsFromRelays();

  if (remoteAnchors.length > 0) {
    // Found anchors - this is recovery mode
    const oldestAnchor = remoteAnchors[0];
    const newestAnchor = remoteAnchors[remoteAnchors.length - 1];

    console.log('[Anchor] Recovery mode - oldest:', oldestAnchor.timestamp, 'newest:', newestAnchor.timestamp);

    // Check if newest anchor is expired
    if (!isAnchorValid(newestAnchor.timestamp)) {
      console.log('[Anchor] Newest anchor expired, publishing new one');
      const newAnchor = await publishAnchor();
      return {
        anchor: newAnchor || newestAnchor,
        isRecoveryMode: true,
        oldestAnchor,
      };
    }

    // Cache newest anchor
    setCachedAnchor(newestAnchor);

    return {
      anchor: newestAnchor,
      isRecoveryMode: true,
      oldestAnchor,
    };
  }

  // No anchors found - new user
  console.log('[Anchor] No anchors found, publishing initial anchor');
  const newAnchor = await publishAnchor();

  return {
    anchor: newAnchor,
    isRecoveryMode: false,
  };
}
