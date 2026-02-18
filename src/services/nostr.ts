import NDK, { NDKEvent, NDKPrivateKeySigner } from '@nostr-dev-kit/ndk';
import { getP2PKPubkey } from './crypto';

let ndk: NDK | null = null;
let signer: NDKPrivateKeySigner | null = null;

export async function initNDK(relays: string[], privateKeyHex: string): Promise<NDK> {
  signer = new NDKPrivateKeySigner(privateKeyHex);

  ndk = new NDK({
    explicitRelayUrls: relays,
    signer,
  });

  await ndk.connect();
  return ndk;
}

export function getNDK(): NDK | null {
  return ndk;
}

// Publish kind:10019 (NutZap info) event
export async function publishNutzapInfo(
  mints: string[],
  relays: string[],
  privateKey: string
): Promise<string | null> {
  if (!ndk || !signer) {
    throw new Error('NDK not initialized');
  }

  const p2pkPubkey = getP2PKPubkey(privateKey);

  // Build tags
  const tags: string[][] = [];

  // Add relay tags
  for (const relay of relays) {
    tags.push(['relay', relay]);
  }

  // Add mint tags
  for (const mint of mints) {
    tags.push(['mint', mint, 'sat']);
  }

  // Add pubkey tag (P2PK format with 02 prefix)
  tags.push(['pubkey', p2pkPubkey]);

  const event = new NDKEvent(ndk);
  event.kind = 10019;
  event.tags = tags;
  event.content = '';

  await event.publish();

  return event.id;
}

// Publish kind:10050 (DM Relay List) event for NIP-17
export async function publishDMRelayList(relays: string[]): Promise<string | null> {
  if (!ndk || !signer) {
    throw new Error('NDK not initialized');
  }

  // Build tags - relay tags for DM relays
  const tags: string[][] = [];
  for (const relay of relays) {
    tags.push(['relay', relay]);
  }

  const event = new NDKEvent(ndk);
  event.kind = 10050;
  event.tags = tags;
  event.content = '';

  await event.publish();

  console.log('[Nostr] Published DM relay list (kind:10050)');
  return event.id;
}

// Disconnect NDK
export function disconnectNDK(): void {
  if (ndk) {
    // NDK doesn't have a disconnect method, but we can clear the reference
    ndk = null;
    signer = null;
  }
}

// Fetch kind:10019 (NutZap info) for a pubkey to restore mints/relays
export async function fetchNutzapInfo(
  pubkey: string,
  defaultRelays: string[]
): Promise<{ mints: string[]; relays: string[] } | null> {
  // Create temporary NDK to fetch without signing
  const tempNdk = new NDK({
    explicitRelayUrls: defaultRelays,
  });

  try {
    await tempNdk.connect();

    // Fetch kind:10019 events for this pubkey
    const events = await tempNdk.fetchEvents({
      kinds: [10019],
      authors: [pubkey],
      limit: 1,
    });

    if (events.size === 0) {
      console.log('[Nostr] No kind:10019 found for pubkey');
      return null;
    }

    // Get the most recent event
    const event = Array.from(events)[0];

    // Extract mints and relays from tags
    const mints: string[] = [];
    const relays: string[] = [];

    for (const tag of event.tags) {
      if (tag[0] === 'mint' && tag[1]) {
        mints.push(tag[1]);
      } else if (tag[0] === 'relay' && tag[1]) {
        relays.push(tag[1]);
      }
    }

    console.log('[Nostr] Restored from kind:10019:', { mints, relays });

    return {
      mints: mints.length > 0 ? mints : [],
      relays: relays.length > 0 ? relays : [],
    };
  } catch (error) {
    console.error('[Nostr] Failed to fetch kind:10019:', error);
    return null;
  }
}
