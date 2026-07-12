/**
 * Bootstrap fragment — TransferLifecycle assembly (verbatim move from bootstrap.ts).
 *
 * Wires the TLS (transfer lifecycle) store, operators, and service, plus the gift-wrap
 * settlement bridge. connectGiftWrapSettlementBridge has an assembly-time side effect
 * (eventBus subscription), so it runs at the same ordering position as the original
 * (just before service-layer assembly).
 */

// ─── Store (composition root only) ───
import { useAppStore } from "@/store";

import { DexiePendingTransferStore } from "@/adapters/storage/dexie/dexie-pending-transfer-store";
import { TokenCodecAdapter } from "@/adapters/codec/token-codec.adapter";

// ─── Cashu Adapters (TransferOperator implementations) ───
import { CashuBolt11Adapter } from "@/modules/cashu/adapters/cashu-bolt11.adapter";
import { CashuEcashAdapter } from "@/modules/cashu/adapters/cashu-ecash.adapter";

import { TransferLifecycleService } from "@/core/services/transfer-lifecycle.service";
import { incrementNetCounter } from "@/adapters/telemetry/net-counters";
import { connectGiftWrapSettlementBridge } from "./gift-wrap-settlement.bridge";

import type {
  TransferOperator,
  MessageTransport,
} from "@/core/ports/driven/transfer-operator.port";
import type { CashuModuleBackend } from "@/modules/cashu/cashu.module";
import type { NostrPaymentTransport } from "@/adapters/nostr/nostr-payment-transport";
import type { NostrGatewayAdapter } from "@/adapters/nostr/nostr-gateway";
import type { EventBus } from "@/core/events/event-bus";
import type { DexieOperationMap } from "@/adapters/storage/dexie/dexie-operation-map";

export function assembleTransferLifecycle(deps: {
  cashuBackend: CashuModuleBackend;
  outgoingTransport: NostrPaymentTransport;
  eventBus: EventBus;
  operationMap: DexieOperationMap;
  nostrGateway: NostrGatewayAdapter;
}) {
  const { cashuBackend, outgoingTransport, eventBus, operationMap, nostrGateway } =
    deps;

  const pendingTransferStore = new DexiePendingTransferStore();

  // MessageTransport adapter wrapping NostrPaymentTransport
  const messageTransport: MessageTransport = {
    async publish(params: {
      recipient: string;
      content: string;
      memo?: string;
    }) {
      const result = await outgoingTransport.send({
        recipientPubkey: params.recipient,
        token: params.content,
        memo: params.memo,
      });
      return { deliveryId: result.success ? "nostr-sent" : "" };
    },
  };

  const tokenCodec = new TokenCodecAdapter();

  const cashuBolt11Adapter = new CashuBolt11Adapter(cashuBackend);
  const cashuEcashAdapter = new CashuEcashAdapter(
    cashuBackend,
    messageTransport,
    tokenCodec,
    eventBus
  );

  const operators = new Map<string, TransferOperator>([
    ["bolt11", cashuBolt11Adapter],
    ["ecash", cashuEcashAdapter],
  ]);

  const transferLifecycle = new TransferLifecycleService(
    pendingTransferStore,
    operators,
    eventBus,
    operationMap,
    // Counters — injected at the boundary so core never imports telemetry directly
    {
      stuckDetected: () => incrementNetCounter("tls_stuck_detected"),
      stuckConfirmedSettled: () =>
        incrementNetCounter("tls_stuck_confirmed_settled"),
    }
  );

  const disconnectGiftWrapSettlement = connectGiftWrapSettlementBridge(
    eventBus,
    transferLifecycle,
    {
      nostrGateway,
      getPosDevices: () => useAppStore.getState().settings.posDevices,
    }
  );

  return {
    pendingTransferStore,
    tokenCodec,
    transferLifecycle,
    disconnectGiftWrapSettlement,
  };
}
