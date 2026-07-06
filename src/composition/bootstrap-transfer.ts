/**
 * Bootstrap 조각 5 — TransferLifecycle 조립 (bootstrap.ts 순수 이동)
 *
 * TLS(전송 수명주기) 스토어·오퍼레이터·서비스와 gift-wrap 정산 브리지 연결.
 * connectGiftWrapSettlementBridge는 조립 시점 부수효과(eventBus 구독)라
 * 원본과 동일한 순서 위치(서비스 층 조립 직전)에서 실행된다.
 */

// ─── Store (composition root만 접근) ───
import { useAppStore } from "@/store";

import { DexiePendingTransferStore } from "@/adapters/storage/dexie/dexie-pending-transfer-store";
import { TokenCodecAdapter } from "@/adapters/codec/token-codec.adapter";

// ─── Cashu Adapters (TransferOperator 구현체) ───
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

  // (Sprint 3 — dual-run with existing services)
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
    // §12 카운터 — core가 telemetry를 직접 import하지 않도록 경계에서 주입
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
