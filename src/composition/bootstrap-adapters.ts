/**
 * Non-module boundary adapter assembly (extracted from bootstrap.ts).
 *
 * LNURL/NIP-05 resolvers, Nostr payment transport, external mnemonic
 * recovery/discovery adapters.
 */

// ─── Store (composition root only) ───
import { useAppStore } from "@/store";

import { DirectLnurlAdapter } from "@/adapters/lnurl/direct-lnurl.adapter";
import { Nip05ResolverAdapter } from "@/adapters/nip05/nip05-resolver";
import { NostrPaymentTransport } from "@/adapters/nostr/nostr-payment-transport";
import { NostrExternalMnemonicMintDiscoveryAdapter } from "@/adapters/nostr/external-mnemonic-mint-discovery.adapter";
import { KeyManagerAdapter } from "@/adapters/crypto/key-manager.adapter";

// ─── Coco (composition root only) ───
import {
  createExternalMnemonicRecovery,
  decodeTokenForPaymentPayload,
} from "@/modules/cashu";

import { DEFAULT_RELAYS } from "@/core/constants";

import type { NostrGatewayAdapter } from "@/adapters/nostr/nostr-gateway";

export function assembleEdgeAdapters(deps: {
  nostrGateway: NostrGatewayAdapter;
}) {
  const { nostrGateway } = deps;

  const lnurlAdapter = new DirectLnurlAdapter();
  const nip05Adapter = new Nip05ResolverAdapter();
  const outgoingTransport = new NostrPaymentTransport(
    nostrGateway,
    decodeTokenForPaymentPayload,
  );
  const externalMnemonicRecovery = createExternalMnemonicRecovery();
  const externalMnemonicMintDiscovery =
    new NostrExternalMnemonicMintDiscoveryAdapter(
      nostrGateway,
      new KeyManagerAdapter(),
      {
        getDiscoveryRelays: () => [
          ...DEFAULT_RELAYS,
          ...(useAppStore.getState().settings.relays || []),
        ],
      }
    );

  return {
    lnurlAdapter,
    nip05Adapter,
    outgoingTransport,
    externalMnemonicRecovery,
    externalMnemonicMintDiscovery,
  };
}
