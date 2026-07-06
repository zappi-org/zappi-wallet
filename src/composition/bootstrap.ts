/**
 * Bootstrap — Composition Root (유일한 경계 횡단 지점)
 *
 * 조립은 도메인 묶음별 조각(bootstrap-*.ts)으로 분해되어 있다 — 이 파일은
 * 원본 실행 순서 그대로 조각을 호출하고, 조각 간 인스턴스 흐름을 인자로
 * 명시 전달하는 오케스트레이터다 (R2-C 절단, 순수 이동 원칙).
 * 조각들과 이 파일만 modules/, adapters/, core/services/ 전부 import 가능.
 *
 * 호출 시점: MainApp.tsx에서 unlock 이후 (seed + nostrPrivkey 필요)
 */

// ─── Core ───
import { createEventBus } from "@/core/events/event-bus";
import { readKillSwitches } from "@/core/utils/kill-switch";

// ─── 조립 조각 (bootstrap-*.ts — 원본 절 순서 그대로) ───
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

// ─── 잔여 인라인 배선 (P2PK·cleanup·환율·진단) ───
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

// ─── Routing types (Phase 6에서 SendFlow 전환 시 제거) ───
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
  /** Nostr 개인키 (hex) — unlock 후 사용 가능 */
  nostrPrivateKeyHex: string;
  /** BIP-39 seed — support 전용 파생키 생성에만 사용하고 저장하지 않음 */
  bip39Seed: Uint8Array;
}

export interface BootstrapResult extends ServiceRegistry {
  // ─── Module instances ───
  readonly cashuModule: CashuModule;
  readonly operationMap: OperationMap;

  // ─── Lifecycle (MainApp만 호출) ───
  activate(): Promise<void>;
  onResume(): Promise<void>;
  onPause(): Promise<void>;
  /** 레지스트리 교체·폐기 시 타이머/구독 정리 (flusher·TLS폴링·watcher·gateway) */
  dispose(): void;
  disconnectBridge(): void;
  disconnectGiftWrapSettlement(): void;

  // ─── Balance refresh (store 갱신 포함, composition root 와이어링) ───
  refreshBalance(): Promise<void>;

  // ─── Cleanup ───
  // 로그아웃 소거는 composition/logout.ts(wipeAccountData)가 전담한다 —
  // 조각별 삭제(deleteCocoData/deleteAllContacts/clearRecoverySyncState 등)는
  // 전 테이블 clear + DB delete + localStorage 정책으로 승계됨 (감사 Phase 1).
  readonly cleanup: {
    /** 민트 1곳 제거 시 관련 아티팩트 정리 (remove-mint 플로우 전용) */
    clearMintData(mintUrl: string): Promise<void>;
  };

  // ─── Exchange rate ───
  readonly exchangeRate: {
    loadCachedRates(): Promise<void>;
    fetchRates(): void;
    refreshIfStale(): Promise<void>;
  };

  // ─── Routing (Phase 6에서 제거) ───
  executeRoute(
    selection: RouteSelection,
    context: RouteContext
  ): Promise<RouteResult>;

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
  // kill-switch 스냅샷 — bootstrap 1회 읽기로 조립 분기 (설계 §11.1)
  const killSwitches = readKillSwitches();
  const { giftwrapCursorStore, nostrGateway } = assembleNostrGateway({
    nostrPrivateKeyHex: deps.nostrPrivateKeyHex,
    killSwitches,
  });

  // 3. Cashu Module (initialize()는 caller가 seed로 호출)
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

  // 5. TransferLifecycleService + gift-wrap 정산 브리지
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

  // 5. Services (+ 5b RecoveryScheduler + recovery-split 위임 배선)
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

  // 7~8. Cold start cache + EventBus→Store/Transfer→Tx 브리지
  const { balanceRefresh, disconnectBridge } = connectStoreBridges({
    balanceCache,
    balance,
    eventBus,
    receiveRequest,
    txRepo,
  });

  // 8. Lifecycle (activate/onResume/onPause/dispose — 정의만, 부수효과 없음).
  // mintHealth/reclaim/nostrIncomingWatcher는 아래 9~13에서 생성된다 — 원본의
  // TDZ-안전 클로저 캡처를 lazy getter 인자로 명시 전달 (호출 시점 역참조 동일).
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

  // 9~11. 공유 dedup store + Nostr incoming watcher + 수신 서비스
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

  // 13. Phase 6: New services
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
    // 진단 카운터 읽기 표면 — UI가 net-counters 어댑터를 직접 import하지 않도록
    // 여기서 주입 (R2-B 5번)
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

    // Balance refresh (store 갱신 포함)
    refreshBalance: balanceRefresh,

    // Cleanup — 로그아웃 전체 소거는 composition/logout.ts 소관
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
