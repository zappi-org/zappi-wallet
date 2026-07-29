/**
 * Lifecycle module: activate/onResume/onPause/dispose.
 *
 * Zero side effects at composition time — this function only defines closures and
 * declares internal mutable state (function-scoped, so it's fresh per bootstrap
 * generation).
 *
 * Forward references (mintHealth/reclaim/nostrIncomingWatcher, built later) are
 * passed as lazy getters and dereferenced at call time — avoiding TDZ issues and
 * implicit module state.
 */

import { exchangeRateService } from "./exchange-rate";
import { connectCocoEventBridge } from "./coco-event-bridge";

import { derivePublicKey } from "@/adapters/nostr/internal/nostr-crypto";
import {
  enableCashuWatchers,
  getCashuRuntimeManager,
  pauseCashuSubscriptions,
  recheckCashuPendingMintQuotes,
  resumeCashuSubscriptions,
} from "@/modules/cashu/cashu-runtime";
import {
  flushNetCounters,
  startNetCounterFlusher,
} from "@/adapters/telemetry/net-counters";
import { broadcastSync, getBroadcastChannel } from "@/utils/cross-tab-sync";
import { DEFAULT_RELAYS, STORAGE_KEYS } from "@/core/constants";

// ─── Store (composition-root access only) ───
import { useAppStore } from "@/store";

import type { EventBus } from "@/core/events/event-bus";
import type { KillSwitches } from "@/core/utils/kill-switch";
import type { NostrGatewayAdapter } from "@/adapters/nostr/nostr-gateway";
import type { NostrIncomingWatcher } from "@/adapters/nostr/nostr-incoming-watcher";
import type { DexieOperationMap } from "@/adapters/storage/dexie/dexie-operation-map";
import type { DexieTransactionRepository } from "@/adapters/storage/dexie/dexie-transaction.repository";
import type { DexieIncomingReviewQueue } from "@/adapters/storage/dexie/dexie-incoming-review-queue.store";
import type { TransferLifecycleService } from "@/core/services/transfer-lifecycle.service";
import type { MintHealthFacadeService } from "@/core/services/mint-health-facade.service";
import type { ReclaimService } from "@/core/services/reclaim.service";

export function createLifecycle(deps: {
  nostrPrivateKeyHex: string;
  killSwitches: KillSwitches;
  eventBus: EventBus;
  operationMap: DexieOperationMap;
  txRepo: DexieTransactionRepository;
  incomingReviewQueue: DexieIncomingReviewQueue;
  nostrGateway: NostrGatewayAdapter;
  transferLifecycle: TransferLifecycleService;
  /** Forward reference — dereferenced at call time */
  getMintHealth: () => MintHealthFacadeService;
  getReclaim: () => ReclaimService;
  getNostrIncomingWatcher: () => NostrIncomingWatcher;
  getNpubcashQuoteWatcher: () => { start(): Promise<void>; stop(): void; syncNow(): Promise<void> };
  getClaimStoragePoller: () => { start(): void; stop(): void };
}) {
  const {
    nostrPrivateKeyHex,
    killSwitches,
    eventBus,
    operationMap,
    txRepo,
    incomingReviewQueue,
    nostrGateway,
    transferLifecycle,
    getMintHealth,
    getReclaim,
    getNostrIncomingWatcher,
    getNpubcashQuoteWatcher,
    getClaimStoragePoller,
  } = deps;

  let netCounterFlusherStop: (() => void) | null = null;
  let mintReconnectStop: (() => void) | null = null;

  // Liveness heartbeat: mobile freeze/kill never emits visibilitychange:hidden,
  // so we record lastAliveAt every 60s while foregrounded to judge how long we
  // were away. A missing/corrupt record is treated as >5min (conservative = full
  // recheck). The key comes from STORAGE_KEYS so the logout wipe (wipeAccountData)
  // and the writer share one constant — drift is impossible.
  const LAST_ALIVE_KEY = STORAGE_KEYS.LAST_ALIVE;
  const RESUME_RECHECK_THRESHOLD_MS = 5 * 60 * 1000;
  const markAlive = () => {
    try {
      localStorage.setItem(LAST_ALIVE_KEY, String(Date.now()));
    } catch {
      /* storage unavailable — awayLongEnough falls back to true */
    }
  };
  const awayLongEnough = (): boolean => {
    try {
      const raw = localStorage.getItem(LAST_ALIVE_KEY);
      const at = raw ? Number(raw) : NaN;
      if (!Number.isFinite(at) || at <= 0) return true;
      return Date.now() - at > RESUME_RECHECK_THRESHOLD_MS;
    } catch {
      return true;
    }
  };
  // Measure foreground liveness only: if the interval kept running during pause,
  // a hidden tab's throttled tick would keep updating lastAliveAt, making a long
  // background return look like a short absence. Stopped on pause, resumed on resume.
  let aliveHeartbeatStop: (() => void) | null = null;
  const startAliveHeartbeat = () => {
    if (aliveHeartbeatStop) return;
    markAlive();
    const timer = setInterval(markAlive, 60_000);
    aliveHeartbeatStop = () => clearInterval(timer);
  };
  const stopAliveHeartbeat = () => {
    if (aliveHeartbeatStop) {
      aliveHeartbeatStop();
      aliveHeartbeatStop = null;
    }
  };
  // pause-during-activate race guard: prevents activate's startPolling from
  // starting a timer after the app has already gone to the background.
  let paused = false;

  // TLS monitor mode: with ks.tls-sweep ON, the legacy path bulk-polls every 30s
  // (a remote round-trip per transfer); OFF runs a 120s stuck-sweep (local first
  // pass, one remote matrix check only for stuck transfers). Both stops are called
  // so a previous mode's timer can't survive a switch toggle + re-unlock.
  const startTransferMonitor = () => {
    if (killSwitches["tls-sweep"]) {
      transferLifecycle.startPolling(30000);
    } else {
      transferLifecycle.startStuckSweep(120_000);
    }
  };
  const stopTransferMonitor = () => {
    transferLifecycle.stopPolling();
    transferLifecycle.stopStuckSweep();
  };

  // Cross-tab sweep resume wiring: a tab that stopped at pending-0 must not miss a
  // transfer created in another tab. The watcher path (incoming:received) bypasses
  // TLS, so its local ensure is wired here too.
  let transferSweepWiringStop: (() => void) | null = null;
  const wireTransferSweepSignals = () => {
    if (transferSweepWiringStop) return;
    const unsubs: Array<() => void> = [];
    unsubs.push(
      eventBus.on("transfer:submitted", () => {
        broadcastSync("transfer_created");
      })
    );
    unsubs.push(
      eventBus.on("incoming:received", () => {
        transferLifecycle.ensureSweepScheduled();
        broadcastSync("transfer_created");
      })
    );
    const channel = getBroadcastChannel();
    if (channel) {
      const onMessage = (event: MessageEvent) => {
        if ((event.data as { type?: string })?.type === "transfer_created") {
          transferLifecycle.ensureSweepScheduled();
        }
      };
      channel.addEventListener("message", onMessage);
      unsubs.push(() => channel.removeEventListener("message", onMessage));
    }
    transferSweepWiringStop = () => {
      unsubs.forEach((u) => u());
      transferSweepWiringStop = null;
    };
  };
  const activate = async () => {
    const manager = await getCashuRuntimeManager();

    // Start the aggregate-counter flush interval — once only, even on re-invocation
    if (!netCounterFlusherStop) {
      netCounterFlusherStop = startNetCounterFlusher();
    }

    // Start the liveness heartbeat — the source for the resume recheck decision
    startAliveHeartbeat();

    // Establish the persistent relay set (DEFAULT_RELAYS + settings.relays). The
    // legacy path connected implicitly via the connect(params.relays) side effect
    // inside fetchGiftWraps/sendDM, but the controller path never reaches that line,
    // so connect explicitly here. Safe as fire-and-forget: the subscription-attach
    // guarantee binds automatically to relays that connect after registration.
    // Harmless on the legacy path (ks ON) too — it just runs the implicit connect early.
    nostrGateway
      .connect([
        ...new Set([...DEFAULT_RELAYS, ...useAppStore.getState().settings.relays]),
      ])
      .catch((e) => console.warn("[Bootstrap] relay connect failed:", e));

    // Hydrate the review queue at boot: restore the previous session's unresolved
    // reviews into the Zustand mirror so the confirmation modal reappears. store
    // enqueue is idempotent on externalId, so overlap with watcher re-receipt is harmless.
    incomingReviewQueue
      .listAll()
      .then((reviews) => {
        const { enqueueIncomingReview } = useAppStore.getState();
        reviews.forEach(enqueueIncomingReview);
      })
      .catch((e) => console.error("[Bootstrap] review hydrate failed:", e));

    // Single owner of health refresh on reconnect (previously each use-mint-health
    // hook instance registered its own reconnect effect). Routed through mintHealth
    // regardless of the switch, so it works on the legacy path too.
    if (!mintReconnectStop && typeof window !== "undefined") {
      const handleOnline = () => {
        // Refresh the status cache — the old store.mints[].isOnline sync is gone
        // (ghost-state removal); only the health probe's metadata back-injection remains.
        getMintHealth()
          .checkAllMints(useAppStore.getState().settings.mints)
          .catch(() => {});
      };
      window.addEventListener("online", handleOnline);
      mintReconnectStop = () =>
        window.removeEventListener("online", handleOnline);
    }

    // Inject OperationMap + TxRepo into mintQuoteObserver (prevents duplicate TX creation)
    const { injectDependencies } = await import(
      "@/composition/mint-quote-observer"
    );
    injectDependencies(operationMap, txRepo);

    // Mint quote observer (mint-op:finalized → Transaction DB record)
    const { connectMintQuoteObserver } = await import(
      "@/composition/mint-quote-observer"
    );
    connectMintQuoteObserver(manager);

    // Connect the send token observer (shares bootstrap's manager instance)
    const { connectSendTokenObserver } = await import(
      "@/composition/send-token-observer"
    );
    connectSendTokenObserver(manager, {
      operationMap,
      lifecycle: getReclaim(),
    });

    // Transfer SDK Bridge: Coco push events → TLS transfer resolution
    const { connectTransferSdkBridge } = await import(
      "@/composition/transfer-sdk-bridge"
    );
    connectTransferSdkBridge(manager, transferLifecycle);

    connectCocoEventBridge(manager, eventBus);

    await enableCashuWatchers();

    // Start the Nostr incoming watcher (once, after app unlock)
    getNostrIncomingWatcher().start(derivePublicKey(nostrPrivateKeyHex));

    // Start the Npubcash quote watcher (WS push + HTTP catch-up)
    getNpubcashQuoteWatcher().start();

    // Start the claim storage poller (auto-claims stored ecash)
    getClaimStoragePoller().start();

    // TLS: on app start, recover active transfers and start monitoring
    transferLifecycle.recoverTransfers().catch(console.error);
    wireTransferSweepSignals();
    if (!paused) {
      startTransferMonitor();
    }

    // Clean up stuck mint ops inside the Coco SDK (>1 day → abandon, else → attempt recovery)
    import('@/modules/cashu/internal/cashu-recovery')
      .then(({ cleanAndRecoverStaleMintOps }) => cleanAndRecoverStaleMintOps().catch(console.error))
      .catch(() => {});
  };

  const onResume = async () => {
    paused = false;
    // Decide before startAliveHeartbeat refreshes lastAliveAt — the criterion is whether this absence exceeded 5 min
    const shouldRecheck = awayLongEnough();
    startAliveHeartbeat();
    try {
      await resumeCashuSubscriptions();
      // An online transition during mobile freeze emits no 'online' event, so we
      // must retry watcher enable on resume to actually close the gap (idempotent
      // via the watchersEnabled guard; re-schedules a retry if still offline).
      enableCashuWatchers().catch((e) =>
        console.error("[Resume] watcher enable failed:", e)
      );
      // recheck (restart watcher → re-verify all pending quotes) runs only on an
      // absence >5min: this drops the burst of full rechecks on every short
      // transition; short-absence gaps are covered by subscription resume + bridge
      // push. Note: on a resume that went through pause, the enable above may not
      // have set the flag yet, so recheck can be a no-op — but enable itself
      // re-subscribes all pending, so the result is equivalent. recheck's real path
      // is a freeze return that woke without a pause event (flag left true).
      if (shouldRecheck) {
        recheckCashuPendingMintQuotes().catch((e) =>
          console.error("[Resume] recheck quotes failed:", e)
        );
      }
    } catch {
      /* ignore if not initialized */
    }
    exchangeRateService.refreshIfStale().catch(() => {});

    // Resume TLS monitoring — the timer stopped in onPause. The sweep path does one
    // immediate sweep then restarts the timer (self-stops at pending 0). Idempotent.
    startTransferMonitor();

    // Restart the Nostr incoming watcher (the key may have changed)
    getNostrIncomingWatcher().stop();
    getNostrIncomingWatcher().start(derivePublicKey(nostrPrivateKeyHex));

    // Restart the Npubcash quote watcher
    getNpubcashQuoteWatcher().stop();
    getNpubcashQuoteWatcher().start();

    // Restart the claim storage poller
    getClaimStoragePoller().stop();
    getClaimStoragePoller().start();
  };

  const onPause = async () => {
    paused = true;
    // Record the background-entry time as the final mark, then stop the heartbeat —
    // the ensuing absence becomes exactly the gap from lastAliveAt.
    markAlive();
    stopAliveHeartbeat();
    try {
      await pauseCashuSubscriptions();
    } catch {
      /* ignore if not initialized */
    }
    // Stop TLS monitoring — previously the 30s polling kept running in the background.
    stopTransferMonitor();
    // Flush counters — persist at pause too, not just on pagehide
    void flushNetCounters();
  };

  // Clean up resources on registration swap (re-unlock) or lock — prevents the
  // previous bootstrap's flusher/polling/subscription/health-check timers from
  // leaking across generations.
  const dispose = () => {
    if (netCounterFlusherStop) {
      netCounterFlusherStop();
      netCounterFlusherStop = null;
    }
    if (mintReconnectStop) {
      mintReconnectStop();
      mintReconnectStop = null;
    }
    stopAliveHeartbeat();
    stopTransferMonitor();
    if (transferSweepWiringStop) {
      transferSweepWiringStop();
    }
    getNostrIncomingWatcher().stop();
    getNpubcashQuoteWatcher().stop();
    getClaimStoragePoller().stop();
    void nostrGateway.disconnect();
  };

  return { activate, onResume, onPause, dispose };
}
