/**
 * Bootstrap fragment — NIP-46 remote-signer (bunker) assembly.
 *
 * Constructs only; `start()` is invoked after unlock (lifecycle/UI), so no relay
 * work happens at composition time. The transport owns a dedicated
 * NostrSessionController so signer sessions never touch the wallet's persistent
 * relay set.
 */

import { Nip46Transport } from "@/adapters/nostr/nip46-transport";
import { derivePublicKey } from "@/adapters/nostr/internal/nostr-crypto";
import { DexieSignerSessionStore } from "@/adapters/storage/dexie/dexie-signer-session.store";
import { RemoteSigningService } from "@/core/services/remote-signing.service";
import type { EventBus } from "@/core/events/event-bus";

export function assembleRemoteSigning(deps: {
  /** Nostr private key (hex) — available after unlock */
  nostrPrivateKeyHex: string;
  eventBus: EventBus;
}): RemoteSigningService {
  const transport = new Nip46Transport(deps.nostrPrivateKeyHex);
  const store = new DexieSignerSessionStore();
  return new RemoteSigningService(transport, store, deps.eventBus, {
    selfPubkey: derivePublicKey(deps.nostrPrivateKeyHex),
  });
}
