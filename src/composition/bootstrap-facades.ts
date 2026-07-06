/**
 * Bootstrap 조각 10 — Phase 6 파사드/신규 서비스 조립 (bootstrap.ts 순수 이동)
 *
 * crypto/inputParser/routing, 민트 metadata·health·info 파사드(킬스위치 분기),
 * reclaim/transactionMgmt/routeExecution, paymentRequest, username,
 * trustRegistry, nostrDirectPayment, externalWalletRecovery, support.
 */

// ─── Store (composition root만 접근) ───
import { useAppStore } from "@/store";

// ─── Phase 6: New Adapters ───
import { CryptoGatewayAdapter } from "@/adapters/crypto/crypto-gateway.adapter";
import { CashuFeeEstimatorAdapter } from "@/modules/cashu/adapters/cashu-fee-estimator.adapter";
import { CashuRoutePaymentOperatorAdapter } from "@/modules/cashu/adapters/cashu-route-payment-operator.adapter";
import { CashuSendTokenOperatorAdapter } from "@/modules/cashu/adapters/cashu-send-token-operator.adapter";
import { MintHealthCheckerAdapter } from "@/adapters/health/mint-health-checker.adapter";
import { MintMetadataStoreAdapter } from "@/adapters/metadata/mint-metadata-store.adapter";
import { CrossTabSyncNotifierAdapter } from "@/adapters/runtime/cross-tab-sync-notifier.adapter";
import { isSameMintUrl } from "@/utils/url";
import { DexieRouteExecutionStore } from "@/adapters/storage/dexie/dexie-route-execution-store";
import { SettingsTrustedAccountStoreAdapter } from "@/adapters/runtime/settings-trusted-account-store.adapter";

// ─── Phase 6: New Core Services ───
import { CryptoService } from "@/core/services/crypto.service";
import { InputParserService } from "@/core/services/input-parser.service";
import { RoutingService } from "@/core/services/routing.service";
import { MintMetadataFacadeService } from "@/core/services/mint-metadata-facade.service";
import { MintHealthFacadeService } from "@/core/services/mint-health-facade.service";
import { TransactionMgmtService } from "@/core/services/transaction-mgmt.service";
import { ReclaimService } from "@/core/services/reclaim.service";
import { PaymentRequestService } from "@/core/services/payment-request.service";
import { UsernameService } from "@/core/services/username.service";
import { TrustRegistryService } from "@/core/services/trust-registry.service";
import { NostrDirectPaymentService } from "@/core/services/nostr-direct-payment.service";
import { RouteExecutionService } from "@/core/services/route-execution.service";
import { ExternalWalletRecoveryService } from "@/core/services/external-wallet-recovery.service";

// ─── Phase 6: Metadata + NUT-18 HTTP ───
import { MintMetadataService, metadataEvents } from "@/modules/cashu/metadata";
import { MintInfoService } from "@/modules/cashu/mint-info.service";
import { DexieMintMetadataRepository } from "@/adapters/storage/dexie/dexie-mint-metadata.repository";
import { createNut18HttpPollerFactory } from "./nut18-poller-factory";

// ─── Coco (composition root만 접근) ───
import {
  decodeTokenForPaymentPayload,
  getMintInfoFromCoco,
  markQuoteAsSwap,
  unmarkQuoteAsSwap,
} from "@/modules/cashu";

import { ZappiLinkAdapter } from "@/adapters/zappi-link/zappi-link.adapter";
import { finalizeEvent } from "nostr-tools";
import { hexToBytes } from "@noble/hashes/utils.js";
import { NOSTR_KINDS } from "@/core/constants";

// ─── Composition Roots ───
import { createSupportService } from "./support";
import { PaymentDelivery } from "./payment-delivery";
import { PaymentRecoveredTokenReceiver } from "./recovered-token-receiver";

import type { MintInfoUseCase } from "@/core/ports/driving/mint-info.usecase";
import type { MintInfoData } from "@/core/types";
import type { KillSwitches } from "@/core/utils/kill-switch";
import type { EventBus } from "@/core/events/event-bus";
import type { CashuModuleBackend } from "@/modules/cashu/cashu.module";
import type { TokenCodecAdapter } from "@/adapters/codec/token-codec.adapter";
import type { DirectLnurlAdapter } from "@/adapters/lnurl/direct-lnurl.adapter";
import type { NostrPaymentTransport } from "@/adapters/nostr/nostr-payment-transport";
import type { NostrExternalMnemonicMintDiscoveryAdapter } from "@/adapters/nostr/external-mnemonic-mint-discovery.adapter";
import type { ExternalMnemonicRecoveryPort } from "@/core/ports/driven/external-mnemonic-recovery.port";
import type { DexieTransactionRepository } from "@/adapters/storage/dexie/dexie-transaction.repository";
import type { DexiePendingOperationRepository } from "@/adapters/storage/dexie/dexie-pending-operation.repository";
import type { DexieSettingsRepository } from "@/adapters/storage/dexie/dexie-settings.repository";
import type { TransferLifecycleService } from "@/core/services/transfer-lifecycle.service";
import type { PaymentService } from "@/core/services/payment.service";
import type { AddressResolverUseCase } from "@/core/ports/driving/address-resolver.usecase";
import type { TokenReceiverAdapter } from "./token-receiver.adapter";

export function assembleFacadeServices(deps: {
  killSwitches: KillSwitches;
  eventBus: EventBus;
  cashuBackend: CashuModuleBackend;
  tokenCodec: TokenCodecAdapter;
  lnurlAdapter: DirectLnurlAdapter;
  outgoingTransport: NostrPaymentTransport;
  txRepo: DexieTransactionRepository;
  pendingOpRepo: DexiePendingOperationRepository;
  settingsRepo: DexieSettingsRepository;
  tokenReceiver: TokenReceiverAdapter;
  transferLifecycle: TransferLifecycleService;
  payment: PaymentService;
  addressResolver: AddressResolverUseCase;
  externalMnemonicMintDiscovery: NostrExternalMnemonicMintDiscoveryAdapter;
  externalMnemonicRecovery: ExternalMnemonicRecoveryPort;
  /** BIP-39 seed — support 전용 파생키 생성에만 사용하고 저장하지 않음 */
  bip39Seed: Uint8Array;
}) {
  const {
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
    bip39Seed,
  } = deps;

  const cryptoGateway = new CryptoGatewayAdapter();
  const crypto = new CryptoService(cryptoGateway);

  const inputParser = new InputParserService(tokenCodec, lnurlAdapter);

  const feeEstimator = new CashuFeeEstimatorAdapter(cashuBackend);
  const routing = new RoutingService(feeEstimator);

  const stripTrailingSlash = (url: string) => url.replace(/\/+$/, "");
  // 분기 A 스코프 가드 (설계 §5.4 / 구현 리뷰 #7): Coco getMintInfo는 미등록
  // URL도 repo에 등록하고 keyset까지 내려받는다 — metadata 경로는 등록 민트로
  // 한정한다. 미등록 URL 검증은 fresh probe(분기 B)의 몫.
  const scopedCocoMintInfoFetcher = async (mintUrl: string) => {
    const registered = useAppStore
      .getState()
      .settings.mints.some((m) => isSameMintUrl(m, mintUrl));
    if (!registered) return null;
    return getMintInfoFromCoco(mintUrl);
  };

  const mintMetadataServiceInstance = new MintMetadataService(
    new DexieMintMetadataRepository(),
    // 분기 A (설계 §5.4 / SP-1): 24h 캐시 미스 시 Coco 경유 — repo+5분 TTL
    // 하이브리드, limiter 보호. ks.mint-info-facade ON이면 레거시 직접 fetch로 복귀.
    killSwitches["mint-info-facade"] ? undefined : scopedCocoMintInfoFetcher
  );
  const mintMetadataStore = new MintMetadataStoreAdapter(
    mintMetadataServiceInstance,
    metadataEvents
  );
  const mintMetadata = new MintMetadataFacadeService(mintMetadataStore);

  // /v1/info 단일 소유자 (설계 §5): health probe(30s, 분기 B — 유일한 직접 fetch)
  // + 상세 화면 raw info(24h 캐시) + probe→metadata 역주입(이중 타격 제거)
  const mintInfoService = new MintInfoService(mintMetadataServiceInstance);
  const mintHealthChecker = killSwitches["mint-info-facade"]
    ? new MintHealthCheckerAdapter()
    : mintInfoService;
  const mintHealth = new MintHealthFacadeService(mintHealthChecker);

  // ks.mint-info-facade ON일 때의 registry.mintInfo — 구동작 복원 (구현 리뷰 #2):
  // 화면별 개별 raw fetch와 동일한 시맨틱(ingest/미러/캐시 없음). 스위치는 신경로
  // 전체를 꺼야 롤백 수단으로 성립한다.
  const legacyMintInfo: MintInfoUseCase = {
    async getInfo(mintUrl: string) {
      try {
        const res = await fetch(`${stripTrailingSlash(mintUrl)}/v1/info`);
        if (!res.ok) return null;
        return (await res.json()) as MintInfoData;
      } catch {
        return null;
      }
    },
  };
  const mintInfo = killSwitches["mint-info-facade"]
    ? legacyMintInfo
    : mintInfoService;

  const sendTokenOperator = new CashuSendTokenOperatorAdapter();
  const reclaim = new ReclaimService(
    txRepo,
    sendTokenOperator,
    tokenReceiver,
    pendingOpRepo,
    eventBus
  );
  const transactionMgmt = new TransactionMgmtService(txRepo);
  const routePaymentOperator = new CashuRoutePaymentOperatorAdapter(
    cashuBackend,
    {
      markQuoteAsSwap,
      unmarkQuoteAsSwap,
    }
  );
  const routeExecution = new RouteExecutionService(
    routePaymentOperator,
    txRepo,
    new DexieRouteExecutionStore(),
    new PaymentDelivery(outgoingTransport, decodeTokenForPaymentPayload),
    tokenCodec,
    lnurlAdapter,
    eventBus,
    transferLifecycle,
    new CrossTabSyncNotifierAdapter()
  );

  // NUT-18 poller factory — expiresAt 전달이 계약의 일부다 (설계 §8.1).
  // 인라인 람다 시절 expiresAt 유실로 만료 후 30분 폴링 결함이 있었고,
  // nut18-poller-factory.test.ts가 필드 전수 전달을 회귀 감시한다.
  const paymentRequest = new PaymentRequestService(
    tokenCodec,
    createNut18HttpPollerFactory(),
  );

  const zappiLinkProvider = new ZappiLinkAdapter(
    (privateKeyHex, url, method) => {
      const event = finalizeEvent(
        {
          kind: NOSTR_KINDS.NIP98_AUTH,
          content: "",
          tags: [
            ["u", url],
            ["method", method.toUpperCase()],
          ],
          created_at: Math.floor(Date.now() / 1000),
        },
        hexToBytes(privateKeyHex)
      );
      return btoa(JSON.stringify(event));
    }
  );
  const username = new UsernameService(zappiLinkProvider);

  const trustRegistry = new TrustRegistryService(settingsRepo);
  const nostrDirectPayment = new NostrDirectPaymentService(addressResolver);
  const externalWalletRecovery = new ExternalWalletRecoveryService(
    externalMnemonicMintDiscovery,
    externalMnemonicRecovery,
    new PaymentRecoveredTokenReceiver(payment),
    new SettingsTrustedAccountStoreAdapter(settingsRepo, (mints) =>
      useAppStore.getState().updateSettings({ mints })
    ),
    eventBus
  );
  const support = createSupportService({ bip39Seed });

  return {
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
  };
}
