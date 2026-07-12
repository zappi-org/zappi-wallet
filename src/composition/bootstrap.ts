/**
 * Bootstrap — Composition Root (the only boundary-crossing point).
 *
 * Assembly is split into per-domain pieces (bootstrap-*.ts) — this file is the
 * orchestrator that calls them in the original execution order and passes
 * instances between them explicitly as arguments. Only the pieces and this file
 * may import from modules/, adapters/, and core/services/.
 *
 * Called from MainApp.tsx after unlock (needs seed + nostrPrivkey).
 */

// ─── Core ───
import { createEventBus } from "@/core/events/event-bus";
import { readKillSwitches } from "@/core/utils/kill-switch";

// ─── Assembly pieces (bootstrap-*.ts — original section order) ───
import { assembleStorage } from "./bootstrap-storage";
import { assembleNostrGateway } from "./bootstrap-nostr";
import { assembleCashuModule } from "./bootstrap-cashu";
import { assembleEdgeAdapters } from "./bootstrap-adapters";
import { assembleTransferLifecycle } from "./bootstrap-transfer";
import { assembleCoreServices } from "./bootstrap-services";
import { connectStoreBridges } from "./bootstrap-store-bridges";
import { createLifecycle } from "./bootstrap-lifecycle";
import { assembleIncomingPipeline } from "./bootstrap-incoming";
import { assembleFacadeServices } from "./bootstrap-facades";

// ─── Remaining inline wiring (P2PK, cleanup, exchange rate, diagnostics) ───
import { CocoP2PKKeyManager } from "@/adapters/crypto/p2pk-key-manager.adapter";
import { getCashuKeyring } from "@/modules/cashu/cashu-runtime";
import {
  addMint as trustMintInCoco,
  removeMintFromCoco,
} from "@/modules/cashu";
import { clearMintData } from "@/adapters/storage/dexie/schema";
import { removeMintArtifacts } from "./remove-mint";
import { exchangeRateService } from "./exchange-rate";
import { readNetCounters } from "@/adapters/telemetry/net-counters";

// ─── Types ───
import type { CashuModule } from "@/modules/cashu/cashu.module";
import type { OperationMap } from "@/core/ports/driven/operation-map.port";
import type { ServiceRegistry } from "@/core/ports/driving/service-registry";
import type { NostrIncomingWatcher } from "@/adapters/nostr/nostr-incoming-watcher";

// ─── Routing types (removed once SendFlow migrates) ───
export type {
  RouteSelection,
  RouteContext,
  RouteExecutionResult,
} from "@/core/domain/routing";
import type {
  RouteSelection,
  RouteContext,
  RouteExecutionResult,
} from "@/core/domain/routing";
import type { Result } from "@/core/domain/result";
import type { BaseError } from "@/core/errors";

export type RouteResult = Result<RouteExecutionResult, BaseError>;

// ─── Bootstrap Input ───

export interface BootstrapDeps {
  /** Nostr private key (hex) — available after unlock */
  nostrPrivateKeyHex: string;
  /** BIP-39 seed — used only to derive the support key; never stored */
  bip39Seed: Uint8Array;
}

export interface BootstrapResult extends ServiceRegistry {
  // ─── Module instances ───
  readonly cashuModule: CashuModule;
  readonly operationMap: OperationMap;

  // ─── Lifecycle (MainApp only) ───
  activate(): Promise<void>;
  onResume(): Promise<void>;
  onPause(): Promise<void>;
  /** Clean up timers/subscriptions on registry swap/disposal (flusher, TLS polling, watcher, gateway) */
  dispose(): void;
  disconnectBridge(): void;
  disconnectGiftWrapSettlement(): void;

  // ─── Balance refresh (includes store update, composition-root wiring) ───
  refreshBalance(): Promise<void>;

  // ─── Cleanup ───
  // Logout wiping is owned entirely by composition/logout.ts (wipeAccountData) —
  // per-piece deletes (deleteCocoData/deleteAllContacts/clearRecoverySyncState,
  // etc.) are superseded by the clear-all-tables + DB delete + localStorage policy.
  readonly cleanup: {
    /** Clean up artifacts when removing a single mint (remove-mint flow only) */
    clearMintData(mintUrl: string): Promise<void>;
  };

  // ─── Exchange rate ───
  readonly exchangeRate: {
    loadCachedRates(): Promise<void>;
    fetchRates(): void;
    refreshIfStale(): Promise<void>;
  };

  // ─── Routing (to be removed) ───
  executeRoute(
    selection: RouteSelection,
    context: RouteContext
  ): Promise<RouteResult>;
  resolveRouteInvoice(
    selection: RouteSelection,
    context: RouteContext
  ): Promise<Result<string, BaseError>>;

  // ─── Nostr incoming watcher ───
  readonly nostrIncomingWatcher: NostrIncomingWatcher;

  // ─── P2PK, offline token ───
  readonly p2pkKeyManager: { getCurrentKey(): Promise<{ pubkey: string }> };
  storeOfflineToken(
    token: string,
    amount: number,
    mintUrl: string,
    dleqStatus: "valid" | "missing"
  ): Promise<string>;
  trustMint(mintUrl: string): Promise<void>;
}

// ─── Bootstrap ───

export function createBootstrap(deps: BootstrapDeps): BootstrapResult {
  // 1. Infrastructure
  const eventBus = createEventBus();
  const {
    txRepo,
    contactRepo,
    pendingOpRepo,
    operationMap,
    failedIncomingStore,
    processedStore,
    settingsRepo,
    receiveRequestRepo,
    balanceCache,
    trustedMintProvider,
    incomingReviewQueue,
  } = assembleStorage();

  // 2. Nostr Gateway
  // kill-switch snapshot — read once at bootstrap to branch assembly
  const killSwitches = readKillSwitches();
  const { giftwrapCursorStore, nostrGateway } = assembleNostrGateway({
    nostrPrivateKeyHex: deps.nostrPrivateKeyHex,
    killSwitches,
  });

  // 3. Cashu Module (caller invokes initialize() with the seed)
  const { cashuBackend, cashuModule, modules } = assembleCashuModule({
    pendingOpRepo,
    txRepo,
    nostrGateway,
    eventBus,
  });

  // 4. Non-module adapters
  const {
    lnurlAdapter,
    nip05Adapter,
    outgoingTransport,
    externalMnemonicRecovery,
    externalMnemonicMintDiscovery,
  } = assembleEdgeAdapters({ nostrGateway });

  // 5. TransferLifecycleService + gift-wrap settlement bridge
  const {
    pendingTransferStore,
    tokenCodec,
    transferLifecycle,
    disconnectGiftWrapSettlement,
  } = assembleTransferLifecycle({
    cashuBackend,
    outgoingTransport,
    eventBus,
    operationMap,
    nostrGateway,
  });

  // 5. Services (+ 5b RecoveryScheduler + recovery-split delegation wiring)
  const {
    payment,
    tokenReceiver,
    balance,
    swap,
    contact,
    profile,
    inputRouter,
    addressResolver,
    receiveRequest,
    recoveryScheduler,
  } = assembleCoreServices({
    modules,
    txRepo,
    contactRepo,
    pendingOpRepo,
    operationMap,
    processedStore,
    settingsRepo,
    receiveRequestRepo,
    incomingReviewQueue,
    eventBus,
    killSwitches,
    cashuBackend,
    nostrGateway,
    lnurlAdapter,
    nip05Adapter,
    transferLifecycle,
  });

  // 6. P2PK key manager
  const p2pkKeyManager = new CocoP2PKKeyManager(getCashuKeyring);

  // 7~8. Cold-start cache + EventBus→Store / Transfer→Tx bridges
  const { balanceRefresh, disconnectBridge } = connectStoreBridges({
    balanceCache,
    balance,
    eventBus,
    receiveRequest,
    txRepo,
  });

  // 8. Lifecycle (activate/onResume/onPause/dispose — definitions only, no side effects).
  // mintHealth/reclaim/nostrIncomingWatcher are created below in 9~13 — pass the
  // original TDZ-safe closure captures explicitly as lazy getter args (same deref
  // at call time).
  const { activate, onResume, onPause, dispose } = createLifecycle({
    nostrPrivateKeyHex: deps.nostrPrivateKeyHex,
    killSwitches,
    eventBus,
    operationMap,
    txRepo,
    incomingReviewQueue,
    nostrGateway,
    transferLifecycle,
    getMintHealth: () => mintHealth,
    getReclaim: () => reclaim,
    getNostrIncomingWatcher: () => nostrIncomingWatcher,
  });

  // 9~11. Shared dedup store + Nostr incoming watcher + receive services
  const { nostrIncomingWatcher, recovery, incomingPayment, pendingItems } =
    assembleIncomingPipeline({
      nostrGateway,
      pendingTransferStore,
      eventBus,
      processedStore,
      trustedMintProvider,
      incomingReviewQueue,
      tokenCodec,
      payment,
      receiveRequest,
      txRepo,
      receiveRequestRepo,
      failedIncomingStore,
      giftwrapCursorStore,
      modules,
    });

  // 13. New services
  const {
    crypto,
    inputParser,
    routing,
    mintMetadata,
    mintHealth,
    mintInfo,
    reclaim,
    transactionMgmt,
    routeExecution,
    paymentRequest,
    username,
    trustRegistry,
    nostrDirectPayment,
    externalWalletRecovery,
    support,
  } = assembleFacadeServices({
    killSwitches,
    eventBus,
    cashuBackend,
    tokenCodec,
    lnurlAdapter,
    outgoingTransport,
    txRepo,
    pendingOpRepo,
    settingsRepo,
    tokenReceiver,
    transferLifecycle,
    payment,
    addressResolver,
    externalMnemonicMintDiscovery,
    externalMnemonicRecovery,
    bip39Seed: deps.bip39Seed,
  });

  return {
    // ─── ServiceRegistry (driving ports only) ───
    eventBus,
    payment,
    balance,
    swap,
    contact,
    profile,
    inputRouter,
    addressResolver,
    recovery,
    incomingPayment,
    recoveryScheduler,
    processedStore,
    incomingReviewQueue,
    nostrGateway,
    pendingItems,
    mintMetadata,
    mintHealth,
    mintInfo,
    crypto,
    receiveRequest,
    reclaim,
    transactionMgmt,
    inputParser,
    paymentRequest,
    routing,
    username,
    trustRegistry,
    support,
    nostrDirectPayment,
    externalWalletRecovery,
    // Diagnostic counter read surface — injected here so the UI never imports the
    // net-counters adapter directly.
    diagnostics: { readNetCounters },
    transferLifecycle,

    // ─── BootstrapResult extensions (MainApp only) ───
    cashuModule,
    operationMap,

    // Lifecycle
    activate,
    onResume,
    onPause,
    dispose,
    disconnectBridge,
    disconnectGiftWrapSettlement,

    // Balance refresh (includes store update)
    refreshBalance: balanceRefresh,

    // Cleanup — full logout wiping is composition/logout.ts's responsibility
    cleanup: {
      clearMintData: (mintUrl: string) =>
        removeMintArtifacts(
          {
            txRepo,
            removeMintFromSdk: removeMintFromCoco,
            clearLocalMintData: clearMintData,
          },
          mintUrl
        ),
    },

    // Exchange rate
    exchangeRate: {
      loadCachedRates: () => exchangeRateService.loadCachedRates(),
      fetchRates: () => {
        exchangeRateService.fetchRates().catch(() => {});
      },
      refreshIfStale: () => exchangeRateService.refreshIfStale(),
    },

    // Routing
    executeRoute: (selection: RouteSelection, context: RouteContext) =>
      routeExecution.executeRoute(selection, context),
    resolveRouteInvoice: (selection: RouteSelection, context: RouteContext) =>
      routeExecution.resolveInvoice(selection, context),

    // Nostr incoming watcher
    nostrIncomingWatcher,

    // P2PK + offline token
    p2pkKeyManager,
    storeOfflineToken: (
      token: string,
      amount: number,
      mintUrl: string,
      dleqStatus: "valid" | "missing"
    ) => cashuBackend.storeOfflineToken(token, amount, mintUrl, dleqStatus),
    trustMint: trustMintInCoco,
  };
}
