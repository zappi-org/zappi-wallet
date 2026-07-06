/**
 * Bootstrap 조각 8 — 라이프사이클 (activate/onResume/onPause/dispose, bootstrap.ts 순수 이동)
 *
 * 조립 시점 부수효과 0 — 이 함수는 클로저 정의와 내부 가변 상태 선언만 한다.
 * (netCounterFlusherStop 등 가변 상태는 함수 스코프 — bootstrap 세대마다 신규.)
 *
 * 순방향 참조 주입: 원본은 뒤 절(9~13)에서 생성되는 mintHealth/reclaim/
 * nostrIncomingWatcher를 TDZ-안전 클로저로 캡처했다(호출 시점 역참조).
 * 절단 후에는 같은 시맨틱을 lazy getter 인자로 명시 전달한다 — 호출 시점
 * 역참조 타이밍 동일, 암묵 모듈 상태 없음.
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

// ─── Store (composition root만 접근) ───
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
  /** 순방향 참조 (조각 9~10 산출물) — 호출 시점 역참조, 원본 클로저 캡처와 동일 */
  getMintHealth: () => MintHealthFacadeService;
  getReclaim: () => ReclaimService;
  getNostrIncomingWatcher: () => NostrIncomingWatcher;
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
  } = deps;

  let netCounterFlusherStop: (() => void) | null = null;
  let mintReconnectStop: (() => void) | null = null;

  // 생존 heartbeat (설계 §6.3 resume / [F12]): 모바일 freeze/kill은
  // visibilitychange:hidden을 못 남기므로, 포그라운드 동안 60초마다 기록한
  // lastAliveAt으로 "얼마나 오래 떠나 있었나"를 판정한다. 기록 부재·손상 시
  // 5분 초과로 간주(보수적 = 전수 재확인).
  // 키는 STORAGE_KEYS 로 단일화 — 로그아웃(wipeAccountData)의 소거 대상과
  // 기록자가 같은 상수를 봐야 드리프트가 불가능하다 (Phase 1 리뷰 M-1)
  const LAST_ALIVE_KEY = STORAGE_KEYS.LAST_ALIVE;
  const RESUME_RECHECK_THRESHOLD_MS = 5 * 60 * 1000;
  const markAlive = () => {
    try {
      localStorage.setItem(LAST_ALIVE_KEY, String(Date.now()));
    } catch {
      /* storage 불가 — awayLongEnough가 true로 폴백 */
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
  // "포그라운드 생존"만 측정한다 — pause 중에도 interval이 돌면 hidden 탭의
  // 스로틀된 tick이 lastAliveAt을 계속 갱신해, 장시간 백그라운드 복귀가
  // "짧은 부재"로 오판된다 (4단계 리뷰 #5). pause에서 정지, resume에서 재개.
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
  // pause-during-activate 레이스 가드 (코드리뷰 #6): activate의 startPolling이
  // 이미 백그라운드로 간 앱에서 타이머를 켜는 것을 방지.
  let paused = false;

  // TLS 감시 모드 (설계 §7.2/§11.2 5단계): ks.tls-sweep ON이면 구경로(30s 일괄
  // 폴링 — 전송당 원격 왕복), OFF면 120s stuck-sweep(로컬 1차 + stuck에 한해
  // §7.3 매트릭스 원격 확인 1회). 두 stop을 모두 부르는 이유: 스위치 토글 후
  // 재unlock 시 이전 모드의 타이머가 세대를 넘지 않게.
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

  // 크로스탭 sweep 재개 배선 (§7.2 [F20-잔여]): pending-0으로 정지한 탭이
  // 타 탭 발생 transfer를 놓치지 않게. watcher 생성 경로(incoming:received)는
  // TLS를 거치지 않으므로 로컬 ensure도 여기서 건다.
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

    // 프로덕션 집계 카운터 flush 주기 시작 (설계 §12) — 재호출에도 1회만
    if (!netCounterFlusherStop) {
      netCounterFlusherStop = startNetCounterFlusher();
    }

    // 생존 heartbeat 시작 — resume recheck 판정의 원천 (설계 [F12])
    startAliveHeartbeat();

    // persistent relay 집합 확립 (설계 §10 B3: DEFAULT_RELAYS + settings.relays —
    // 6단계 리뷰 #1 blocker): 레거시 경로는 fetchGiftWraps/sendDM 내부의
    // connect(params.relays) 부수효과가 연결을 암묵 확립했지만, 컨트롤러 경로는
    // 그 라인에 도달하지 않는다 — 여기서 명시 확립한다. fire-and-forget이어도
    // 안전한 이유: 구독 attach 보장이 "등록 후 연결되는 relay"에 자동으로 붙는다.
    // 레거시 경로(ks ON)에도 같은 호출이 무해하다(기존 암묵 connect의 조기 실행).
    nostrGateway
      .connect([
        ...new Set([...DEFAULT_RELAYS, ...useAppStore.getState().settings.relays]),
      ])
      .catch((e) => console.warn("[Bootstrap] relay connect failed:", e));

    // review 대기열 부팅 hydrate (설계 §6.2) — 이전 세션의 미해소 review를
    // Zustand 미러로 복원해 확인 모달이 다시 뜨게 한다. store enqueue는
    // externalId 멱등이라 watcher 재수신과 겹쳐도 무해.
    incomingReviewQueue
      .listAll()
      .then((reviews) => {
        const { enqueueIncomingReview } = useAppStore.getState();
        reviews.forEach(enqueueIncomingReview);
      })
      .catch((e) => console.error("[Bootstrap] review hydrate failed:", e));

    // 재연결 시 health 갱신의 단일 소유 (설계 §5 — 기존에는 use-mint-health 훅
    // 인스턴스(3곳 마운트)마다 각자 reconnect effect를 등록했다). 스위치와 무관하게
    // mintHealth 경유라 legacy 경로에서도 동작한다.
    if (!mintReconnectStop && typeof window !== "undefined") {
      const handleOnline = () => {
        // 상태 캐시 갱신이 목적 — 구 store.mints[].isOnline 동기화는 유령 상태
        // 제거(Phase 3)로 소멸, health probe 의 metadata 역주입 부수효과만 유지
        getMintHealth()
          .checkAllMints(useAppStore.getState().settings.mints)
          .catch(() => {});
      };
      window.addEventListener("online", handleOnline);
      mintReconnectStop = () =>
        window.removeEventListener("online", handleOnline);
    }

    // mintQuoteObserver에 OperationMap + TxRepo 주입 (TX 이중 생성 방지)
    const { injectDependencies } = await import(
      "@/composition/mint-quote-observer"
    );
    injectDependencies(operationMap, txRepo);

    // Mint quote observer (mint-op:finalized → Transaction DB 기록)
    const { connectMintQuoteObserver } = await import(
      "@/composition/mint-quote-observer"
    );
    connectMintQuoteObserver(manager);

    // Send token observer 연결 (bootstrap과 동일 인스턴스 공유)
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

    // Coco → EventBus bridge
    connectCocoEventBridge(manager, eventBus);

    // Watchers
    await enableCashuWatchers();

    // Nostr incoming watcher 시작 (앱 unlock 후 한 번)
    getNostrIncomingWatcher().start(derivePublicKey(nostrPrivateKeyHex));

    // TLS: 앱 시작 시 active transfer 복구 + 감시 시작 (ks 분기 — §7.2)
    transferLifecycle.recoverTransfers().catch(console.error);
    wireTransferSweepSignals();
    if (!paused) {
      startTransferMonitor();
    }

    // Coco SDK 내부 stuck mint ops 정리 (1일 이상 → abandon, 그 외 → 복구 시도)
    import('@/modules/cashu/internal/cashu-recovery')
      .then(({ cleanAndRecoverStaleMintOps }) => cleanAndRecoverStaleMintOps().catch(console.error))
      .catch(() => {});
  };

  const onResume = async () => {
    paused = false;
    // 판정은 heartbeat 재개로 갱신되기 전에 — 이번 부재가 5분을 넘겼는지가 기준
    const shouldRecheck = awayLongEnough();
    startAliveHeartbeat();
    try {
      await resumeCashuSubscriptions();
      // 모바일 freeze 중의 online 전환은 'online' 이벤트를 남기지 않는다 —
      // resume에서 watcher 활성화를 재시도해야 §7.1-3 결함이 실제로 닫힌다
      // (watchersEnabled 가드로 idempotent, 오프라인이면 재시도 재예약. 코드리뷰 #4).
      enableCashuWatchers().catch((e) =>
        console.error("[Resume] watcher enable failed:", e)
      );
      // recheck(watcher 재기동 → pending quote 전수 재확인)는 5분 초과 부재에만
      // (설계 §6.3 resume / [F12]) — 짧은 전환마다 전수 재확인하던 버스트 제거.
      // 짧은 부재의 공백은 구독 재개 + 브리지 push가 커버한다.
      // 참고: pause를 거친 resume에서는 위 enable이 아직 flag를 못 세워
      // recheck가 no-op일 수 있다 — enable 자체가 pending 전수를 재구독하므로
      // 결과는 동등하다. recheck의 실효 경로는 pause 이벤트 없이 얼었다 깨어난
      // freeze 복귀(flag가 true로 남은 경우)다 (4단계 재검증 잔여 #1).
      if (shouldRecheck) {
        recheckCashuPendingMintQuotes().catch((e) =>
          console.error("[Resume] recheck quotes failed:", e)
        );
      }
    } catch {
      /* ignore if not initialized */
    }
    exchangeRateService.refreshIfStale().catch(() => {});

    // TLS 감시 재개 — onPause에서 정지한 타이머 (설계 §7.2). sweep 경로는
    // 즉시 1회 sweep 후 타이머 재개(pending 0이면 스스로 정지). idempotent.
    startTransferMonitor();

    // Nostr incoming watcher 재시작 (키가 바뀔 수 있으므로)
    getNostrIncomingWatcher().stop();
    getNostrIncomingWatcher().start(derivePublicKey(nostrPrivateKeyHex));
  };

  const onPause = async () => {
    paused = true;
    // 백그라운드 진입 시각을 마지막으로 기록하고 heartbeat 정지 —
    // 이후 부재 시간이 그대로 lastAliveAt과의 간격이 된다
    markAlive();
    stopAliveHeartbeat();
    try {
      await pauseCashuSubscriptions();
    } catch {
      /* ignore if not initialized */
    }
    // TLS 감시 정지 — 기존에는 백그라운드에서도 30초 폴링이 계속 돌았다 (설계 §7.2).
    stopTransferMonitor();
    // 카운터 flush — pagehide 외에 pause 시점에도 확정 저장 (설계 §12)
    void flushNetCounters();
  };

  // 등록 교체(재unlock)·잠금 시 리소스 정리 — 이전 bootstrap의 flusher/폴링/구독/
  // 헬스체크 타이머가 세대를 넘어 살아남는 누수 방지 (코드리뷰 #5).
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
    void nostrGateway.disconnect();
  };

  return { activate, onResume, onPause, dispose };
}
