/**
 * Bootstrap fragment — Nostr Gateway assembly (verbatim move from bootstrap.ts).
 *
 * bootstrap.ts reads the kill-switch snapshot once at the same execution point and
 * passes it in as an argument (the original read it inside this section; execution
 * order is unchanged).
 */

import { NostrGatewayAdapter } from "@/adapters/nostr/nostr-gateway";
import { DexieGiftwrapCursorStore } from "@/adapters/storage/dexie/dexie-giftwrap-cursor.store";
import type { KillSwitches } from "@/core/utils/kill-switch";

export function assembleNostrGateway(deps: {
  /** Nostr private key (hex) — available after unlock */
  nostrPrivateKeyHex: string;
  killSwitches: KillSwitches;
}) {
  const { nostrPrivateKeyHex, killSwitches } = deps;

  // With ks.cursor ON, skip injecting the store → cursor spec is ignored, reverting to old behavior (full replay)
  const giftwrapCursorStore = killSwitches.cursor
    ? undefined
    : new DexieGiftwrapCursorStore();
  const nostrGateway = new NostrGatewayAdapter({
    privateKeyHex: nostrPrivateKeyHex,
    cursorStore: giftwrapCursorStore,
    // SessionController delegation — connection/subscription registry, attach guarantee,
    // session lease, per-relay catch-up. If ON, the entire legacy path instead.
    useSessionController: !killSwitches["nostr-controller"],
  });

  return { giftwrapCursorStore, nostrGateway };
}
