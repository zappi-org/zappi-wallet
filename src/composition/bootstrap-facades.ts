/**
 * Facade / new-service assembly: crypto/inputParser/routing, the mint
 * metadata·health·info facades (kill-switch branches), reclaim/transactionMgmt/
 * routeExecution, paymentRequest, paymentAlias, trustRegistry, nostrDirectPayment,
 * externalWalletRecovery, support.
 */

// ─── Store (composition root access only) ───
import { useAppStore } from "@/store";

// ─── New Adapters ───
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

// ─── New Core Services ───
import { CryptoService } from "@/core/services/crypto.service";
import { InputParserService } from "@/core/services/input-parser.service";
import { RoutingService } from "@/core/services/routing.service";
import { MintMetadataFacadeService } from "@/core/services/mint-metadata-facade.service";
import { MintHealthFacadeService } from "@/core/services/mint-health-facade.service";
import { TransactionMgmtService } from "@/core/services/transaction-mgmt.service";
import { ReclaimService } from "@/core/services/reclaim.service";
import { PaymentRequestService } from "@/core/services/payment-request.service";
import { PaymentAliasService } from "@/core/services/payment-alias.service";
import { TrustRegistryService } from "@/core/services/trust-registry.service";
import { NostrDirectPaymentService } from "@/core/services/nostr-direct-payment.service";
import { RouteExecutionService } from "@/core/services/route-execution.service";
import { ExternalWalletRecoveryService } from "@/core/services/external-wallet-recovery.service";

// ─── Metadata + NUT-18 HTTP ───
import { MintMetadataService, metadataEvents } from "@/modules/cashu/metadata";
import { MintInfoService } from "@/modules/cashu/mint-info.service";
import { DexieMintMetadataRepository } from "@/adapters/storage/dexie/dexie-mint-metadata.repository";
import { createNut18HttpPollerFactory } from "./nut18-poller-factory";

// ─── Coco (composition root access only) ───
import {
  decodeTokenForPaymentPayload,
  getMintInfoFromCoco,
  markQuoteAsSwap,
  unmarkQuoteAsSwap,
} from "@/modules/cashu";

import { NpubcashAdapter } from "@/adapters/npubcash/npubcash.adapter";
import { Secp256k1NostrSignerAdapter } from "@/adapters/crypto/secp256k1-nostr-signer";
import { NPUBCASH_URL, NPUBCASH_DOMAIN } from "@/core/constants";

// ─── Composition Roots ───
import { createSupportService } from "./support";
import { PaymentDelivery } from "./payment-delivery";
import { PaymentRecoveredTokenReceiver } from "./recovered-token-receiver";
import { assembleNpubcashWatcher } from "./bootstrap-npubcash";

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
  /** BIP-39 seed — used only to derive support-specific keys; never stored */
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
  // Branch A scope guard: Coco getMintInfo registers even an unregistered URL in
  // the repo and downloads its keyset — so keep the metadata path limited to
  // registered mints. Validating an unregistered URL is the fresh probe's job
  // (branch B).
  const scopedCocoMintInfoFetcher = async (mintUrl: string) => {
    const registered = useAppStore
      .getState()
      .settings.mints.some((m) => isSameMintUrl(m, mintUrl));
    if (!registered) return null;
    return getMintInfoFromCoco(mintUrl);
  };

  const mintMetadataServiceInstance = new MintMetadataService(
    new DexieMintMetadataRepository(),
    // Branch A: on a 24h cache miss, go via Coco — repo + 5-min TTL hybrid,
    // limiter-protected. With ks.mint-info-facade ON, fall back to legacy direct fetch.
    killSwitches["mint-info-facade"] ? undefined : scopedCocoMintInfoFetcher
  );
  const mintMetadataStore = new MintMetadataStoreAdapter(
    mintMetadataServiceInstance,
    metadataEvents
  );
  const mintMetadata = new MintMetadataFacadeService(mintMetadataStore);

  // Single owner of /v1/info: health probe (30s, branch B — the only direct
  // fetch) + detail-screen raw info (24h cache) + probe→metadata back-feed
  // (removes the double hit).
  const mintInfoService = new MintInfoService(mintMetadataServiceInstance);
  const mintHealthChecker = killSwitches["mint-info-facade"]
    ? new MintHealthCheckerAdapter()
    : mintInfoService;
  const mintHealth = new MintHealthFacadeService(mintHealthChecker);

  // registry.mintInfo when ks.mint-info-facade is ON — restores old behavior:
  // same semantics as per-screen raw fetch (no ingest/mirror/cache). The switch
  // only works as a rollback if it disables the entire new path.
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

  // NUT-18 poller factory — passing expiresAt is part of the contract. The
  // inline-lambda version dropped expiresAt, causing a 30-min post-expiry polling
  // bug; nut18-poller-factory.test.ts guards field pass-through against regression.
  const paymentRequest = new PaymentRequestService(
    tokenCodec,
    createNut18HttpPollerFactory(),
  );

  const npubcashAdapter = new NpubcashAdapter(NPUBCASH_URL);
  const paymentAlias = new PaymentAliasService(
    npubcashAdapter,
    routePaymentOperator,
    (privkey: string) => new Secp256k1NostrSignerAdapter(privkey),
    txRepo,
    routePaymentOperator,
    eventBus,
    NPUBCASH_DOMAIN,
  );

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

  const { npubcashQuoteWatcher } = assembleNpubcashWatcher({
    npubcashAdapter,
    routePaymentOperator,
    eventBus,
  });

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
    paymentAlias,
    trustRegistry,
    nostrDirectPayment,
    externalWalletRecovery,
    support,
    npubcashAdapter,
    routePaymentOperator,
    npubcashQuoteWatcher,
  };
}
