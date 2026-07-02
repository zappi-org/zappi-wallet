# 네트워크 트래픽 재설계 — Mint/Nostr 컨트롤러 모델

| | |
|---|---|
| 상태 | **v3 최종** — 3차 비관 리뷰 **APPROVED** (잔여 blocker N3-지속성 + 편집 4건 반영 완료) |
| 작성 | 2026-07-02 |
| 기준 리비전 | `main@7075aaa` |
| 선행 문서 | `reports/rate-limit-flow-audit.html` (전 경로 감사), 화면별 전수 맵(§17 부록) |
| 대상 독자 | 시니어 개발자 — 결정과 근거 중심 |

**v1→v2 변경 요지** (리뷰 findings F1~F20 대응, 본문에 `[F#]` 태깅):
- §6 recoverAll 인벤토리를 함수 단위 → **행동 단위**로 재작성 — PAID-quote import·tx 실패마킹 소유자 지정 [F1]
- §7에 **전송타입별 stuck-confirm 매트릭스** + 브리지·상태매핑·watcher 재시도 선행조건 신설 [F2][F11][F12]
- §10 cursor: deep-resync를 oldestAnchor 의존에서 분리, overlap 마진 추가, 저장 스키마·sec→ms 마이그레이션 명세 [F3][F4][F5][F7]
- 2단계 범위를 라이브 구독으로 한정 (querySync는 per-relay EOSE 불가) [F6]
- RequestGate 실패 쿨다운·stale 의미·인스턴스 수명 명세 [F8]
- **kill-switch 레지스트리** 신설 — 롤백 열의 실체화 [F9]
- NetLog에 프로덕션 집계 카운터 추가 — 5단계 게이트 측정 가능화 [F10]
- AddMint/Settings 복구 재배선 구체화, `runFullNetworkRecovery` 내용 명세 [F13]
- §5 health를 SP-1 결과 무관하게 성립하는 2-분기로 재설계, 허위 근거 삭제 [F14][F15]
- 포트 변경 목록 정직화, 구독 id 계정 스코프, nostr-tools 재연결 기능 OFF 고정, PWA freeze 시맨틱 [F17][F18][F19][F20]
- 화면 전수 맵 반영 신규 컴포넌트: **FeeEstimationService**, 타이핑-중 네트워크 정책, RelayManagement 프로브 대체, TLS pause 누수 수정, 구독 attach 레이스 [F16 + 매퍼 발견]

**v2→v3 (2차 리뷰 N1~N10)**: since 공식 재정의 — `max()` 폐기, per-relay 규칙으로 통일 [N1] · B7을 추적/비추적으로 분리, `requeuePaidMintQuotes` 재도입 [N2] · AddMint의 실제 메커니즘을 review-queue drain-on-trust로 교정 [N3] · §8.3↔§8.4 상호의존 명시 [N4] · 브리지 보강을 4단계로 이동 [N5] · 카운터 flush 정책+게이트 검증 프로토콜 [N6] · 전체복구 동시성 가드 [N7] · 파사드 교차분기 dedup [N8] · persistent∩session 규칙 [N9] · §16 과장 교정 [N10]

**v3 최종 수정 (3차 리뷰)**: review-queue **영속화+enqueue 순서 교정**을 drainReviewQueue의 선행조건으로 명시 — 현 큐는 메모리 전용이고 processed 마킹이 선행해 리로드 시 토큰 유실이 영구화되는 기존 버그 확인 · B7b의 "현행 동작" 교정(실제로는 로그만, 실패 마킹은 의도적 행동 변경) · B7→B7a 잔존 참조 정리 · drainReviewQueue를 §6.2 인터페이스·§4 포트 diff에 등재 · deep-resync 나이검사를 2단계 배포물로 명시

---

## 1. 문제 정의

민트·릴레이 rate limit의 원인은 단일 버그가 아니라 **이벤트 기반 엔진 위에 얹힌 다중 보험이 무규율로 발화하는 구조**다. 감사·화면 전수 맵으로 확정된 사실:

- 같은 mint quote를 3계층이 확인: Coco HybridTransport(20s/5s) + TLS 폴링(30s, **pause에도 미정지**) + resume 시 watcher 재기동 전수 재확인
- 같은 relay 이벤트를 3경로가 다운로드: watcher 전체 replay + syncAll fetch + anchor fetch — 전부 `since` 없음, resume마다 반복
- `recoverAll()` 트리거 6곳 — 단 그 내용물은 "순수 중복"이 아니라 중복(Coco 재실행)·로컬 정합·**Zappi 고유 네트워크 구제**(PAID-quote import, 오프라인 토큰 상환)의 혼합물 [F1]
- `/v1/info` 독립 소비자 5곳 + Coco 내부, 캐시 2계통 체인
- limiter 우회 4종 + **견적 트래픽**: 크로스민트 수수료 견적 = 민트 4왕복, my-wallet은 이중 견적으로 확인 화면 1회에 최대 8왕복
- NUT-18 `expiresAt` 배선 누락, RelayManagement의 gateway 밖 raw WS 프로브, 타이핑 중 LNURL GET 발신

## 2. Goals / Non-Goals

### Goals
1. **네트워크당 단일 chokepoint** — 민트 바이트는 Coco를, 릴레이 바이트는 NostrSessionController를 지난다
2. **push 정본, 폴링은 컨트롤러 내부의 한 겹 fallback** — 컨트롤러 밖 `setInterval` 금지
3. **복구(네트워크)와 정합(로컬 DB)의 분리** — 단, 행동 단위로 정확히 (§6)
4. relay 전체 히스토리 replay를 **바운디드 창**으로 축소, 견적·화면 트래픽의 캐시화
5. 단계별 배포 — 롤백은 **kill-switch 레지스트리**(§11.1)로 실체화 [F9]

### Non-Goals
- Nostr 토큰버킷 rate limiter 선행 도입 (§10.8 백스톱은 최후순위)
- `nostr-cs` CSClient 커넥션 풀 통합 (lifecycle 신호 공유까지만)
- 멀티탭 리더 선출 구현 (경계만 확보 — §10.9)
- Coco 포크 (upstream 요청 UP-1만)
- 수수료 견적의 keyset 기반 완전 로컬 계산 (후속 — §8.4는 캐시·이중제거까지)

## 3. 설계 원칙

1. **우회는 금지가 아니라 불가능하게.** 연결 객체·fetch 헬퍼를 컨트롤러/파사드 내부로 숨긴다. 남는 예외는 명시 목록(§5.4)으로 관리하고 NetLog 태깅을 강제한다.
2. **재료 재사용.** anchor, processedStore, `since` 파라미터 자리, DexieMintMetadataRepository, recoveryStore — 미배선 완성이 우선. 단 재사용 시 **단위·스키마 마이그레이션을 명세**한다(§10.5) [F7].
3. **계측 게이트 — 프로덕션에서 측정 가능해야 게이트다** [F10]. TLS 강등(5단계)은 필드 집계 카운터로 push 커버리지가 증명되기 전에는 하지 않는다.

## 4. 아키텍처 개요

```
┌─ Zappi 제품 레이어 ─────────────────────────────────────────────┐
│ TransferLifecycle(상태머신) · 거래DB · RecoveryScheduler(정합/구제) │
│ RecoveryService(anchor·재설치) · FeeEstimationService(견적 캐시)   │
└──────────────┬──────────────────────────────┬──────────────────┘
        ports  │                              │  ports
┌──────────────▼─────────────┐   ┌────────────▼──────────────────┐
│  Coco Manager (기존)        │   │  NostrSessionController (신설) │
│  = 민트 컨트롤러             │   │  = 노스터 컨트롤러              │
│  · limiter 20/20 per mint  │   │  ① 연결 레지스트리 (lease)      │
│  · WSS /v1/ws + 20s/5s 폴링 │   │  ② 구독 레지스트리 (attach 보장) │
│  · 복구·keyset·캐시          │   │  ③ cursor 엔진                │
│  + MintInfoService (신설)   │   │  ④ 쿼리 병합 (10019/10050 TTL) │
└──────────────┬─────────────┘   │  ⑤ lifecycle (onWake 단일화)   │
               │                 └────────────┬──────────────────┘
          Cashu Mints                    Nostr Relays
```

**포트 변경 목록 (정직한 diff)** [F17]: 무변경이 아니다. 아래가 전부이며, 전부 하위호환 확장이다.
- `SubscribeGiftWrapsParams` / `FetchGiftWrapsParams`: `+ cursor?: { key, overlapSec }`, `+ fullReplay?: boolean`
- `NostrGateway.queryEvents/publish`: `+ opts?: { relays?: string[] }` (기본 persistent set)
- `NostrSessionController`(신규 내부 인터페이스): `deepResync(key)` 포함 (§10.2)
- `NostrGateway.getRelayStatus()`: 계약 변경 — 현재는 연결된 relay만 `connected:true` 고정 반환(nostr-gateway.ts:95-100) → **persistent 전체 + 실제 상태** 반환으로 확장 (§10.6 RelayManagement 대체의 전제) [F17]
- `sendGiftWrap`/`sendPrivateDirectMessage`: 시그니처 불변이나 **행동 계약 변경** — 현재의 "connect가 targetRelays 교체+connectedRelays 누적" 부수효과가 session lease로 대체됨. `publishAnchor`(자기 발송, persistent 대상)도 같은 경로를 쓰므로 회귀 테스트 대상 [F17]
- 송금 플로우: resolve 결과(DM relay 목록)를 전송까지 전달 — `PaymentIntent/transportRef`에 `recipientRelays?: string[]` 추가, `MessageTransport.publish` params에 `relays?` 추가 (bootstrap.ts:284-297 래퍼가 현재 버리는 파라미터의 통로 신설)
- `PaymentUseCase`: `recoverAll()` 유지(호환)하되 내부가 RecoveryScheduler로 위임, 신규 `reconcile()`·`recoverTargeted()` 추가
- `RecoveryScheduler.drainReviewQueue(mintUrl)`: 신규 driving 표면 — AddMint/신뢰추가 UI가 호출 (§6.3, 선행조건 포함)

---

# Part A — Mint 계층

## 5. A1. MintInfoService — /v1/info 단일 facade

### 통합 대상 (화면 전수 맵 확정 — 5 소비자)
| 현재 소비자 | 트리거 | 대체 |
|---|---|---|
| MintHealthCheckerAdapter (30s 메모리 TTL) | Home mount(탭 전환마다 재마운트), MintManagement mount, 재연결, pull-refresh | `getMany(mints, {maxAgeMs:30_000})` |
| MintMetadataService (24h Dexie) | 다수 화면의 이름/아이콘/NUT | 파사드가 흡수 (저장소 재사용) |
| MintManagementScreen 행 확장 raw fetch | 사용자 확장 | `get(url)` — 24h 캐시면 네트워크 0 |
| MintInfoSheet raw fetch | 시트 열림 | `get(url)` |
| MainApp handleAddTrustedMint raw fetch | 신뢰 추가 | `get(url, {maxAgeMs:0})` 1회 — 직후 `trustMint`(Coco addMint)의 fetch와 이중이므로, **검증은 파사드 fetch로 하고 Coco addMint 결과를 캐시에 역주입** |

추가: `use-mint-health.ts:49`의 metadata 체인 삭제(같은 응답의 파생이므로 무의미), 재연결 refresh effect는 훅 인스턴스별(현재 3곳 마운트)이 아니라 **파사드가 단일 소유**.

### 인터페이스

```ts
export interface MintInfoResult {
  url: string
  info: MintInfo | null
  fetchedAt: number            // epoch ms
  ok: boolean                  // 마지막 시도 성공 여부
  probedAt: number             // 마지막 "실제 네트워크 시도" 시각 — health 판정용
  error?: string
}
export interface MintInfoPort {
  get(mintUrl: string, opts?: { maxAgeMs?: number }): Promise<MintInfoResult>
  getMany(mintUrls: string[], opts?: { maxAgeMs?: number }): Promise<MintInfoResult[]>
  peek(mintUrl: string): MintInfoResult | null      // 메모리 미러 동기 조회 (§5.3)
  supports(mintUrl: string, nut: number): Promise<boolean>
}
```

### 5.3 저장 구조
Dexie(`DexieMintMetadataRepository` 확장: `probedAt`,`ok` 컬럼 추가) + **메모리 미러**(마지막 결과 Map — `peek`의 실체. Dexie는 비동기라 UI 첫 페인트는 미러가 담당, 부팅 시 1회 hydrate).

**구현 확정 편차 (3단계, 기록)**: `probedAt/ok` 영속·부팅 hydrate·`get/getMany/peek` 포트 표면은 구현에서 단순화 — health 미러는 세션 스코프 Map으로 시작(구 어댑터와 동등, 영속 스냅샷의 필요성 미증명), 상세 조회는 `MintInfoUseCase.getInfo`(24h 캐시 `rawInfo` 필드)로 축소, `checkAllMints` 신선도는 30s 고정. 재평가 시점 = 6단계. 추가 확정: probe는 JSON 파싱 성공까지를 online으로 판정(구 어댑터는 2xx면 무조건 online — 캡티브 포털 가짜 200 대응, 의도적 변경) · fresh probe의 2xx 응답은 검증 결과와 무관하게 ingest(미추가 URL의 잔여 캐시 행 수용, 사용자 액션 바운드) · 분기 A는 **등록 민트로 스코프**(미등록 URL을 Coco repo에 등록시키지 않기 위해 — bootstrap의 scoped fetcher).

**[N8] 구현 잔여 (검증 완료, 수용)**: ① 합류는 단방향 — 분기 A가 진행 중 probe에 합류하며, 역방향(probe가 Coco fetch에 합류)은 없다. SP-1상 Coco 호출은 repo 히트일 수 있어 liveness를 증명하지 못하므로 이 방향이 옳다. ② probe가 ingest를 await하므로 IndexedDB **행(hang)** 시 health 판정이 함께 지연되는 결합이 생겼다(실패는 무영향 — catch 처리). 저확률(Safari IDB stall류)·기존 metadata 계층도 같은 세계에서 멈추므로 수용, 필요 시 ingest에 짧은 타임아웃 레이스로 완화. ③ 합류 경로는 peekCached의 Dexie 읽기 오류로 reject할 수 있다(레거시 doFetch는 절대 reject 안 함) — 현 소비자 전원이 catch/allSettled로 가드됨을 확인.

### 5.4 네트워크 경로 — SP-1 결과와 무관하게 성립하는 2-분기 [F14]
health의 의미는 "지금 살아있는가"이므로 **실제 네트워크 왕복**이 필요하다. `manager.mint.getMintInfo`가 repo 읽기일 가능성이 높다(d.ts:337이 mintRepo 옆에 위치, 강제 갱신은 info+keysets를 함께 끄는 `updateMintData` — health 용도로 과중).

- **분기 A (metadata 용도, maxAge 24h)**: 등록 민트 → `manager.mint.getMintInfo` (repo/캐시라도 무방 — 표시용). SP-1로 신선도 확인 후 확정.
- **분기 B (health 용도, maxAge 30s)**: **파사드 자체 direct fetch `/v1/info`** — 등록/미등록 불문. 이것이 §3.1의 "명시 예외 목록" 1번이다. Coco limiter를 타지 않지만, 파사드의 in-flight 공유+30s 캐시+단일 소유로 총량이 현재(5 소비자 각개)보다 감소한다. SP-1에서 `getMintInfo`가 실제 fetch임이 확인되면 분기 B를 Coco 경유로 전환한다. **SP-1이 repo-읽기로 결론나면 분기 B는 등록 민트에 대해서도 영구 우회로 남는다 — 이 경우 UP-2(coco에 강제 신선 fetch 옵션 제안)를 등록한다** [F14-잔여].
- 미등록 민트(AddMint 미리보기 등): 분기 B 경로.
- **교차분기 dedup** [N8]: in-flight 맵의 키는 **mintUrl 단일** — 분기 A/B가 같은 민트로 동시 진입하면 하나의 Promise를 공유하고, 분기 B의 신선한 성공 결과는 분기 A의 staleness 판정도 충족시킨다(같은 `MintInfoResult` 레코드 갱신).

(v1의 "Promise.all fail-fast 제거" 근거는 허위였으므로 삭제 — 기존 checkMint는 reject하지 않는다 [F15]. `getMany`는 단순 병렬 + in-flight 공유.)

### 명시 예외 목록 (파사드/컨트롤러 밖 직접 호출 — 이것이 전부여야 한다)
1. §5.4 분기 B의 `/v1/info` (파사드 내부)
2. NUT-18 폴러의 endpoint GET/POST (스펙상 HTTP transport — §8.1)
3. 외부 니모닉 복구의 restore 경로 (§8.5 — sweep 전환 전까지, 모듈 내부 격리)
4. ecash stuck-confirm의 `checkProofsStates` (§7.3 — UP-1 수용 전까지, 모듈 내부 격리)

전 항목 NetLog `caller` 태깅 필수. 이 목록 밖의 직접 호출이 NetLog에 잡히면 회귀다.

## 6. A2. Recovery 재편 — **행동 단위** 인벤토리 [F1]

### 6.1 현재 recoverAll의 실제 행동 분해 (코드 검증 완료)

| # | 행동 | 위치 | 성격 | 새 소유자 |
|---|---|---|---|---|
| B1 | `sendOps.runRecovery()` — Coco send 복구 재실행 | cashu-recovery.ts:108 | 네트워크 · **init 중복** | 삭제 (Coco init + 수동 전체복구에만) |
| B2 | melt `listInFlight()`→`refresh()`→실패 시 reclaim | cashu-recovery.ts:64-77 | 네트워크 · init 중복이나 **melt 실패의 유일한 UI 도달 경로**(§7.2 참조) | 삭제하되 §7 stuck-sweep이 대체 (브리지 보강 선행) [F2] |
| B3 | send op 로컬 상태 → 거래DB settle/reclaim 마킹 | cashu-recovery.ts:129-160 | **로컬 정합** | `reconcile()` |
| B4 | legacy(무operationId) send 토큰 self-receive | cashu-recovery.ts:162-255 | 네트워크 · Zappi 고유(레거시) | `recoverTargeted()` — legacy 존재 시에만 |
| B5 | 만료/제거민트 mint-quote → 거래DB 실패 마킹 | cashu-recovery.ts:283-300 | **로컬 정합** | `reconcile()` |
| B6 | 미만료 quote 원격 확인 → ISSUED settle | cashu-recovery.ts:302-306 | 네트워크 · Coco watcher 중복(**Coco가 추적 중인 quote 한정**) | 원격확인 삭제. settle은 이중 안전망: ① push(observer) ② **`reconcile()`이 로컬 Coco op 상태를 스캔해 observer 유실분 settle** (앱 킬로 이벤트를 놓친 경우 — 로컬 읽기라 reconcile 소관이 맞음) |
| B7a | **Coco 추적 중이나 stuck된 PAID quote 강제 실행** — 현행 `mintAndReceive`가 실제로 구제하는 모집단 (checkMintQuote는 `getByQuote()===null`이면 throw하므로 비추적 quote는 이 경로에 **도달 불가** — cashu-backend.ts:753-756) [N2] | cashu-recovery.ts:307-309 | 네트워크 · Zappi 고유, 돈 걸림 | `recoverTargeted()` → **`requeuePaidMintQuotes()`** (공개 API, d.ts:3711 — v1 §A6 후보의 재도입). stuck-sweep의 `checkPayment`도 자체 reconcile(d.ts:3400 "Paid or issued quotes are reconciled immediately")로 이중 안전망 |
| B7b | **Coco 비추적 quote** (pendingOpRepo에만 존재) — 현행 동작: checkMintQuote throw → catch → **로그+failed 카운트만, tx 기록 없음** (cashu-recovery.ts:322-325) → 영원히 pending으로 남아 매 recoverAll마다 재시도 | 동일 | **로컬** (throw가 네트워크 이전에 발생) | `reconcile()`에서 실패 마킹 — **의도적 행동 변경**(현행은 무한 재시도, 신규는 종결). 판별(`getByQuote()===null`)도 로컬. `importQuote` 기반 구제는 상태 오염·abandon 수술 비용 때문에 **명시적 범위 외**. (참고: 추적 op의 원격 터미널 상태 실패 마킹 :313-315의 소유자는 B7a가 Coco op 상태에 반영한 뒤의 **reconcile 로컬 스캔** — B6 이중망과 동일 경로) |
| B8 | legacy pendingOpRepo `deleteExpired` | cashu-recovery.ts:90-94 | 로컬 | `reconcile()` |
| B9 | 오프라인 수신 토큰 상환 (`redeemPendingReceivedTokens`) | offline-token-recovery.ts:15-57 | 네트워크 · **Zappi 고유 큐** | `recoverTargeted()` |

### 6.2 신규 API

```ts
interface RecoveryScheduler {
  /** 로컬 전용(B3+B5+B8 + Coco 로컬 op 상태 기반 거래DB 정합). 네트워크 0. */
  reconcile(): Promise<ReconcileReport>
  /** Zappi 고유 네트워크 구제(B7a+B9+B4). RequestGate('recovery:targeted', 5분). */
  recoverTargeted(): Promise<RecoveryReport>
  /** 민트 신뢰 시점의 review-queue 상환(§6.3 AddMint). 신규 driving 표면 — AddMint UI가 호출. */
  drainReviewQueue(mintUrl: string): Promise<{ redeemed: number; amount: number }>
  /** Settings 복구 버튼 전용. gate 미적용. 내용: Coco ops.send/melt/receive.recovery.run()
   *  + recoverPendingMintOperations() + recoverTargeted(gate 우회 — B7a의 requeuePaidMintQuotes 포함,
   *  직접 재호출 금지: 중복 방지) + reconcile().
   *  현재지갑 restore(민트별 wallet.restore)는 기존대로 recoverAccounts가 담당 — 별도 버튼.
   *  동시성 [N7]: Coco recovery는 진행 중 재호출 시 throw("Recovery is already in progress",
   *  dist:4082) — 각 recovery API의 inProgress()(d.ts:3104-3106) 확인 후 skip-and-report,
   *  버튼 연타·unlock 직후 충돌 방지. */
  runFullNetworkRecovery(): Promise<RecoveryReport>
}
```

기존 `PaymentUseCase.recoverAll()`은 시그니처 유지, 구현을 `reconcile()+recoverTargeted()`로 위임 (SettingsScreen:391 등 기존 호출부의 `RecoveryReport[]` 반환 계약 유지 — 마이그레이션 중 파손 방지) [F13].

### 6.3 트리거 재배선

| 트리거 | 현재 | 목표 |
|---|---|---|
| unlock | recoverAll | `reconcile()` + `recoverTargeted()` — B1/B2/B6은 initializeCoco·watcher가 수행 중 |
| resume | recoverAll + **watcher 재기동 전수 재확인** | `reconcile()`; `recoverTargeted()`는 gate(5분)에 맡김. **Coco recheck 처분** [F12]: `recheckPendingMintQuotes`(무조건 disable→enable)를 조건부로 — 기준은 **영속 heartbeat**: 포그라운드 동안 60s마다 `lastAliveAt`을 localStorage에 기록, resume 시 `now − lastAliveAt > 5분`이면 재기동(모바일 freeze/kill은 `visibilitychange:hidden`을 못 남기므로 pausedAt 단독은 불충분 — **기록 부재·손상 시 >5분으로 간주**) |
| 당김 새로고침 | recoverAll + checkAllMints | `recoverTargeted()`(gate 통과 시 실행, 아니면 즉시 stale 반환 — §6.4) + `getMany(30s)` |
| Token 탭 | recoverAll(30s 스로틀) | `reconcile()`만 — 원격 정산 감지는 watcher/sweep 소관 |
| AddMint 완료 / 신뢰 추가 | recoverAll ("복원" UI와 불일치 — 실제 복구액 항상 0) [F13] | **`drainReviewQueue(mintUrl)` 신설** [N3]: 비신뢰 민트에서 온 토큰은 offline store가 아니라 **`incomingReviewQueue`** 에 쌓인다 — 민트를 명시적으로 신뢰하는 순간이 곧 사용자 승인이므로 해당 민트의 큐 항목을 자동 redeem하고, **"복구액" UI는 이 drain의 실제 상환 합계로 교체**(잔액 diff 방식 폐기). **선행조건(blocker — 3차 리뷰)**: 현 큐는 **메모리 전용 Zustand**(sync.slice, persist 없음)이고 두 enqueue 경로 모두 **processed 마킹이 durable-enqueue보다 먼저**라(nostr-incoming-watcher.ts:89-93 · recovery.service.ts:199-204) 리로드 시 큐 증발 + 재수신 영구 차단 = **기존 잠재 토큰 유실 버그**. 따라서 ① 큐를 Dexie로 영속화 ② **durable enqueue → mark-processed 순서로 교정** ③ (대안) drain 시 processedStore의 pending 레코드에서 재유도 — 이 중 ①+②가 §11.2 4단계 배포물이다. 추가로 `recoverTargeted()`(gate 우회 1회 — offline-DLEQ 토큰용, B9). 과거 잔액 시드 복구는 별도 "이 민트 복원" 액션으로 `recoverAccounts([url])` — 자동 실행 금지 |
| Settings 현재지갑 복구 | recoverAll + recoverAccounts | `runFullNetworkRecovery()` + 기존 recoverAccounts 순차 유지 |

**구현 확정 편차 (4단계, 기록 — 구현 리뷰 #1~#10 반영)**:
- **B7b/B6이중망/로컬 failed의 종결 = tx status 갱신 그 자체** — mint-quote는 `pendingOpRepo`의 실제 행이 아니라 transactions(status=pending)의 가상 뷰(dexie-pending-operation.repository.ts)라, failed/settled 마킹이 곧 다음 스캔에서의 제거다. `pendingOpRepo.delete`는 mint-quote에 no-op이므로 호출하지 않는다(리뷰 #9). mint op state `'failed'`(d.ts:794 — melt와 달리 mint op에는 존재)도 동일 종결.
- **drain의 큐 종결 판정은 토큰 소비 코드 화이트리스트**(`TOKEN_SPENT`/`INVALID_TOKEN`/`INVALID_PROOF` — B9 offline-token-recovery와 동일 정책), `isRetryable=false` 전체가 아님 — UNTRUSTED_MINT처럼 토큰은 유효한데 환경이 원인인 비재시도 오류가 사용자 결정 전의 review를 폐기하는 자금 손실 방지.
- **신뢰 추가 경로의 drain 시점 = review 해소 직후**(MainApp `handleResolveIncomingReview` 말미, trusted 민트 가드 — mints는 **store에서 최신 조회**: "신뢰하고 받기"는 신뢰 추가와 해소가 같은 렌더 클로저에서 이어져 prop 캡처본이 stale이다, 리뷰 #3) — `handleAddTrustedMint` 내부에서 걸면 모달의 자체 redeem과 race하여 활성 review가 TOKEN_SPENT 오류로 표면화된다. AddMint 화면은 §6.3대로 `drainReviewQueue`+`recoverTargeted(bypass)` 직접 호출, "복구액"=drain 합계(잔액 diff 폐기). `listByMint`는 인덱스 일치가 아니라 **정규화 비교 스캔**(기본 포트·대소문자·slash 흡수 — 발신자 지갑의 raw URL 표기 편차, 리뷰 #6).
- **recoverAll 위임의 계수 계약 = 구경로 보존**(리뷰 #7): `recovered`에는 **targeted(네트워크 구제 실건수)만** — 구경로에서 B3 settle 마킹은 recorded, quote 만료는 expired로 recovered/failed 밖이었다. reconcile 수치는 콘솔 로그만. 위임은 **단계별 try/catch로 절대 reject하지 않는다**(리뷰 #10 — 구경로의 어댑터별 격리와 동등). PaymentService의 30s 외곽 gate는 위임 경로에 미적용 — 게이팅은 위임 내부(reconcile 10s/targeted 5m)가 소유(이중 gate면 unlock 직후 Token 탭 reconcile까지 stale로 삼켜진다). 구경로(ks ON)는 기존 30s gate 유지.
- **runFullNetworkRecovery는 RequestGate(cooldown 0)로 in-flight 공유만** — 연타는 같은 실행에 합류, 종료 후 재호출은 즉시 재실행(사용자 명시 의도). targeted gate와 분리라 full 직후 unlock의 targeted가 막히지 않는다.
- **review-queue 영속화는 kill-switch 미대상** — 메모리 큐로의 복귀는 3차 리뷰 blocker(토큰 유실)를 재개방하므로 스위치로 되돌릴 수 있게 하지 않는다. `ks.recovery-split`은 recoverAll 위임(트리거 6곳의 행동 변화)만 구경로로 되돌린다. **로그아웃(`clearRecoverySyncState`)이 `incomingReviews`를 삭제한다**(리뷰 #1 blocker) — 남기면 다음 계정의 부팅 hydrate가 이전 계정 review를 부활시켜 타 계정 토큰이 오상환된다(구 메모리 큐는 reload에 소멸했으므로 영속화가 만든 신규 회귀였다).
- **pause가 watcher 플래그를 리셋한다**(`suspendWatchers`, 리뷰 #2): Coco `pauseSubscriptions()`는 mintOperationWatcher를 disable하지만 Zappi가 init 시 `disabled:true`라 `resumeSubscriptions()`가 되살리지 않는다 — 플래그 리셋으로 resume의 `enableCashuWatchers()`가 재활성(비용 = 로컬 repo 읽기 + WSS 재구독뿐, 원격 버스트 없음). recheck(>5분)의 잔여 가치 = Coco측 구독 부패에 대한 강제 재구독.
- heartbeat 키 = localStorage `zappi_last_alive_at` — **포그라운드 전용 측정**(리뷰 #5): 60s 간격, onPause에서 마지막 기록 후 interval 정지, onResume에서 판정 후 재개. pause 중에도 돌리면 hidden 탭의 스로틀된 tick이 장시간 부재를 "짧은 부재"로 오판시킨다. 부재·손상·storage 불가 ⇒ >5분 간주.
- **멜트 브리지의 카운터 계수는 `melt-quote:paid`·`melt-op:rolled-back`만**(리뷰 #8) — `melt-op:finalized`는 같은 정산의 이중망이라 계수하면 §12 카운터(5단계 게이트 근거)가 인플레이션된다.

```ts
export class RequestGate {
  constructor(private readonly opts: {
    cooldownMs: number          // 성공 쿨다운
    failureCooldownMs?: number  // 실패 쿨다운 (기본 30_000) — 실패 폭주 방지
  }) {}
  /** 반환: { value, stale } — cooldown 내 재호출은 stale:true로 직전 성공값.
   *  실패 시: failureCooldown 내 재호출은 같은 rejection을 재-throw (오류도 쿨다운). */
  run<T>(key: string, task: () => Promise<T>): Promise<{ value: T; stale: boolean }>
}
```

- **수명**: bootstrap 인스턴스 스코프 (계정 전환 = 새 bootstrap = gate 초기화. 모듈 싱글턴 금지 — 계정 간 결과 누출 방지)
- **stale 의미 문서화**: pull-refresh가 cooldown 내면 UI는 stale 표시 없이 직전 결과를 쓴다 — recovery는 멱등이고 watcher가 실시간을 담당하므로 UX 손실 없음. 단 `runFullNetworkRecovery`는 gate 밖(사용자 명시 의도)
- 키: `recovery:targeted`(5m/30s), `support:connect`(0/10s — in-flight 공유 목적), `reconcile`(10s/10s)

## 7. A3. TLS 폴링 강등 — 선행조건과 stuck-confirm 매트릭스 [F2]

### 7.1 5단계 진입 선행조건 (전부 코드 확정 필요)
1. **브리지 보강**: `transfer-sdk-bridge`에 `melt-op:finalized` + `melt-op:rolled-back` 구독 추가 (d.ts:1293·1298 존재 확인). **배포 시점: 4단계** [N5] — B2(melt refresh 루프) 삭제와 같은 단계여야 함. 4단계에서 B2를 지우면서 브리지가 5단계에 남으면, 그 사이 세션 중 melt 실패는 로컬 op 상태 갱신에만 의존하게 되는 공백이 생긴다(WS 죽은 상태의 실패는 다음 앱 시작까지 미도달). 브리지 추가는 additive라 4단계 선반영에 위험 없음
2. **상태 매핑 수정**: `cashu-bolt11.adapter.poll()`의 `state === 'FAILED'` 분기는 도달 불가(Coco melt 상태는 finalized/rolled_back/…) — `rolled_back`/`rolling_back` → `failed` 매핑으로 교체. **이 수정은 1단계에서 선반영** (현재도 melt 실패가 in_transit으로 새는 활성 버그)
3. **watcher 오프라인 복구** [F11]: `enableWatchers()`가 오프라인 unlock 시 영구 no-op — `onWake`/`online`에서 `!watchersEnabled`면 재시도. 5단계 이전에 1단계로 선반영 (현재는 30s 폴링이 가려주는 결함)
4. **프로덕션 커버리지 카운터**(§12) 7일: `transfer:stuck` 감지 건수·push 이벤트 수신율

### 7.2 변경 내용
- 주기: 30s → **120s stuck-sweep**. pending 0건이면 타이머 정지, transfer 생성/수신 시 재개
- **pause 누수 수정**: `onPause()`에 `stopPolling()` 추가(현재 부재 — 화면 맵 확인), `onResume`/`onWake`에서 pending>0이면 즉시 1회 sweep 후 타이머 재개 [F20]
- **크로스탭**: 타 탭에서 생성된 transfer는 기존 `CrossTabSyncNotifier` 알림에 sweep 타이머 재개를 배선 — pending-0 정지 상태의 탭이 타 탭 발생 transfer를 놓치지 않게 [F20-잔여]
- sweep의 판정: **로컬 상태만** 읽어 stuck(비종단 & lastTransitionAt > 120s) 검출 → stuck에 한해 아래 매트릭스로 원격 확인 1회

### 7.3 stuck-confirm 매트릭스 (전송타입별 원격 확인 수단)

| 전송타입 | 로컬 1차 판정 | stuck 시 원격 확인 | 경로 |
|---|---|---|---|
| bolt11 incoming (mint quote) | Coco mint op 상태 | `ops.mint.checkPayment(opId)` | Coco 공개 API ✓ |
| bolt11 outgoing (melt) | `ops.melt.get` (로컬) | `ops.melt.refresh(opId)` — **sweep이 직접 호출** (감지만 하고 확인 안 하는 설계 금지) | Coco 공개 API ✓ |
| ecash send | `ops.send.get` 상태 | op가 여전히 pending이면 **`checkProofsStates` (격리된 raw 호출)** — §5.4 예외 4. reclaim 화면 전용이 아니라 **stuck 경로에서 도달 가능**해야 함. UP-1(coco에 공개 API 제안) 수용 시 교체 | 우회(격리·태깅) |
| ecash incoming (수동 수령 대기) | 로컬 만료 체크만 | 없음 (원격 상태 개념 없음) | — |

### 7.4 수수료·확인 화면 등 온디맨드 원격 확인
PendingItemDetail의 `checkAlive`/expiry probe, 수동 새로고침은 사용자 액션 1:1이므로 유지 (§17-e). 단 전부 Coco 경유임을 확인 완료.

## 8. A4~A6 + 신규 A7·A8

**8.1 NUT-18** — `bootstrap.ts:569`에 `expiresAt: opts.expiresAt,` 추가 + **bootstrap 배선 스냅샷 테스트**(어댑터 테스트는 배선 누락을 못 잡음이 증명됨). 폴러 자체(3s, 화면 mount~unmount, 정리 존재)는 스펙상 정당 — 유지.

**8.2 외부 니모닉 복구** — SP-2(sweep 동등성) 통과 시 `wallet.sweep`로 교체. 실패 시 현행 유지 + ① discovery 병합 상한(설정 민트 + 발견 5) ② `AbortSignal` 취소 ③ 민트 간 순차 유지. 어느 쪽이든 §5.4 예외 3으로 격리.

**8.3 cleanAndRecoverStaleMintOps** — 2주 계측(실 복구/abandon 건수). 0이면 제거. >0이면 B7a(`requeuePaidMintQuotes`)로 흡수. `abandonMintQuote`의 Coco 테이블 직접 수술은 coco-core 버전 고정 전제로 격리 유지, 제거가 최종 목표 — **단 §8.4의 견적 경로가 같은 수술을 매 견적마다 사용하므로, 이 제거 목표는 8.4의 대안이 확정되기 전까지 '복구 경로 한정'이다** [N4].

**8.4 FeeEstimationService (신규 — 화면 맵 발견)** [F16]
현재: LN 견적 = prepareMelt+rollback(민트 2왕복), 크로스민트/my-wallet = +createMintQuote+abandon(4왕복), **my-wallet은 SendFlow와 SendConfirmStep이 각각 견적 → 확인 화면 1회에 최대 8왕복**. TokenScreen `useReclaimFees`는 pending 토큰 N건×(receive.prepare+cancel)을 탭 방문마다 재실행.
- `estimate(route, mintUrl, amount)` — 키 `(routeType, source, target, amount)`, TTL 60s 세션 캐시 + in-flight 공유
- **이중 견적 제거**: SendConfirmStep은 재견적 대신 SendFlow의 견적 결과를 prop으로 수신 — 채널은 이미 존재(`initialFee`를 my-wallet에서 의도적으로 버리는 현행 로직 삭제, SendConfirmStep.tsx:43-107)
- `useReclaimFees`: txId 키 캐시, 거래 변화 이벤트에만 무효화
- **효과의 정직한 범위** [N4][N10]: 키에 amount가 포함되므로 **금액을 바꿔가며 편집하면 매번 4왕복이 유지**된다 — 확실한 이득은 my-wallet 이중 견적 제거(8→4)와 동일 금액 재진입 캐시. 그 이상(금액 편집 중 왕복 감소)은 keyset 로컬 계산(Non-Goal, 후속)의 몫
- **§8.3 상호의존** [N4]: my-wallet/크로스민트 견적은 타겟 민트에 실제 quote를 생성하고 `abandonMintQuote`(Coco 테이블 수술)로 지운다(cashu-fee-estimator.adapter.ts:65-95). 즉 **§8.3의 수술 제거 목표는 이 견적 메커니즘이 살아있는 한 완결 불가** — 매 견적이 민트 서버에 가시적 quote 상태를 남긴다는 사실 포함해 수용하고 문서화한다. 대안(견적 전용 melt-estimate 프로브 등)은 UP-1과 함께 coco 업스트림 논의 대상

**8.5 타이핑-중 네트워크 정책 (신규)** — SendInputStep의 500ms 디바운스 LNURL 검증이 부분 입력 도메인으로 실 GET 발신(`a@gmail.co` → gmail.co). 정책: **원격 검증은 제출·붙여넣기·스캔 시점에만**. 타이핑 중에는 문법 검사(형태 판정)까지만. UsernameChangeScreen(현재 플래그 off)도 동일 정책 적용 시점에 수정.

---

# Part B — NostrSessionController

## 9. B1. 책임 경계

**소유**: relay 연결 수명, 구독, cursor, 쿼리/발행 스코프, onWake lifecycle.
**비소유**: gift wrap 해석(watcher), anchor 의미론(RecoveryService), 거래 생성(TLS), support 채팅 로직.
위치: `adapters/nostr/internal/session-controller.ts`. `NostrGatewayAdapter`는 위임층으로 축소. 포트 diff는 §4 목록이 전부.

## 10. B2~B9. 핵심 설계

### B2. 인터페이스

```ts
type RelayScope = 'persistent' | 'session'
interface RelayLease { readonly urls: string[]; release(): void }

interface CursorSpec {
  key: string                  // 반드시 계정 스코프: 'giftwrap:<pubkey8>' [F18]
  overlapSec: number           // GIFTWRAP_OVERLAP_SEC (§10.4)
  fullReplay?: boolean
}
interface SubscriptionSpec {
  id: string                   // 반드시 계정 스코프 접미사. 동일 id+동일 필터해시 = no-op,
                               // 동일 id+다른 필터해시 = replace(기존 close 후 재개). 병합 금지 [F18]
  filters: NostrFilter[]
  relays?: string[]            // 미지정 = persistent set
  cursor?: CursorSpec
  onEvent(ev: NostrEvent): void
  onCaughtUp?(relay: string): void
}
interface NostrSessionController {
  acquire(urls: string[], scope: RelayScope, ttlMs?: number): Promise<RelayLease>
  subscribe(spec: SubscriptionSpec): () => void
  query(filters: NostrFilter[], opts?: { relays?: string[]; coalesceKey?: string; ttlMs?: number }): Promise<NostrEvent[]>
  publish(ev: SignedNostrEvent, opts?: { relays?: string[] }): Promise<{ ok: string[]; failed: string[] }>
  deepResync(key: string): Promise<void>       // §10.4 [F17]
  onWake(cb: () => void): () => void           // visibility/online 디바운스 3s
  dispose(): void
}
```

### B3. 연결 레지스트리
- **persistent** = `DEFAULT_RELAYS + settings.relays`. 헬스체크·자동 재연결 대상은 이 집합만.
- **session** = 수신자 DM relay 등. refcount + TTL. **TTL 기본 120s** (publish OK 대기 포함 여유 — 60s는 느린 relay에서 lease 만료 후 publish 확인 유실 위험). `release()`는 publish confirm 후 호출.
- **persistent∩session 중첩 규칙** [N9]: 수신자 DM relay가 persistent 집합에도 속하면 session refcount·TTL은 무시된다 — lease 만료/release가 persistent 연결을 닫지 않는다. 구독 attach 보장(아래)은 **persistent 연결에만** 적용 — session relay는 단명 발행/조회 전용이며 구독을 받지 않는다.
- **구독 attach 보장 (신규 — 화면 맵 발견 레이스)**: 현재 subscribe는 그 시점 연결된 relay에만 붙고 이후 connect는 재구독하지 않는다. 레지스트리는 relay가 (신규/재)연결될 때 **그 relay를 대상으로 하는 모든 등록 구독을 attach**한다.
- **nostr-tools 자체 재연결 기능은 OFF 고정** [F19]: `AbstractRelay.enablePing/enableReconnect`는 기본 false — 컨트롤러가 재연결을 소유하며, 라이브러리 업그레이드 시 이 기본값을 pin하는 단위 테스트를 둔다(이중 재구독 방지).

### B4. 구독 레지스트리
- 재연결 시 **해당 relay만** 재개 (현행 전 구독×전 relay 재오픈 폐기)
- `relay.subscribe`에 `oneose` 배선 (현 구현 `onevent`만)
- resume: 구독 재시작 금지. `onWake` → 소켓 생존 확인 → 죽은 relay만 cursor since로 재개. 계정 전환 시에만 전체 재시작(id가 pubkey 스코프라 잔존 구독 없음)

### B5. Cursor 엔진 [F3][F4][F5][F6][F7]

**상수** — 의미가 다른 두 상수를 분리한다 [F5]:
```ts
const NIP59_RANDOMIZATION_SEC = 172_800          // 프로토콜 상한 (nostr-tools nip59 randomNow)
const GIFTWRAP_OVERLAP_SEC = NIP59_RANDOMIZATION_SEC + 21_600   // +6h 송신자 시계오차 마진
// ANCHOR_VALIDITY_SECONDS(재발행 주기)와 수치가 달라짐 — 혼용 금지
```

**저장 스키마 v2 (신규 테이블 — 기존 recoveryStore 행은 PK가 `id:'current'`라 in-place 확장 불가, 읽기 마이그레이션 후 신규 `cursor_v2` 테이블 사용)** [F4][F7]:
```ts
interface CursorRecord {
  key: string                   // PK — 'giftwrap:<pubkey8>'
  v: 2
  lastAttemptAtMs: number       // 마지막 catch-up 시도 시각 — UI 표시·진단 전용, since 계산에 사용 금지 [N1]
  lastFullSyncAtMs: number      // 모든 대상 relay가 EOSE한 마지막 시각 — 단일 since의 유일한 원천
  relayEoseAtMs: Record<string, number>   // relay별 마지막 EOSE — per-relay since의 원천, 영속
  deepResyncAtMs: number        // 마지막 deep-resync 완료 시각
}
```
**레거시 마이그레이션 (2단계 리뷰 #5로 확정)**: 레거시 `syncAnchor.timestamp`는 **seed하지 않는다** — 그 값은 부분/빈 fetch에도 매 reconstruct 말미에 갱신되던 값이라 "여기까지 전부 받았다" 불변식이 없고, since 하한으로 쓰면 업그레이드 직전 부분 동기화의 미수신 이벤트가 영구 제외된다. 신규 레코드는 `lastFullSyncAtMs=0`으로 생성 → **업그레이드 사용자는 1회 전체 replay 후 진짜 全EOSE로만 확립**(본 문서 "최초(null) cursor" 조항의 원래 약속). 구 행은 보존(anchor 표시용). 혼합 기록 금지.

**2단계 구현 확정 사항 (구현 리뷰 3건 BLOCKING 반영)**:
- **합성 EOSE 차단** [리뷰 #1]: nostr-tools는 relay가 EOSE를 안 주면 `baseEoseTimeout`(4.4초) 뒤 합성 EOSE를 같은 콜백으로 발화한다 — cursor 구독은 `CURSOR_EOSE_TIMEOUT_MS`(24h)로 덮고, 라이브러리 기본값은 pin 테스트로 감시. 진짜 EOSE만 cursor를 전진시킨다.
- **全EOSE 판정 = 설정된 persistent 집합** [리뷰 #2]: `GiftwrapCursorSpec.fullSyncTargets`로 전달(연결 스냅샷 금지 — 다운 relay가 조용히 빠지면 사실상 quorum 제외). 미연결 target은 EOSE가 없으므로 cursor를 붙든다(안전). 미지정 시 full-sync 마크 비활성.
- **deep 마커는 오류 없는 실행에만 전진** [리뷰 #3]: `errors.length===0` 게이트(isSyncing 단락 'Sync already in progress' 포함) + full/deep fetch는 `maxWaitMs=30s`(기본 5초 부분 fetch의 완료 위장 방지) + fullResync UI는 오류 시 실패 토스트.
- **markFullSync는 handler settle 후** [리뷰 #4]: EOSE까지 도착한 이벤트의 처리 Promise가 전부 끝난 뒤 마크 — 처리 중 크래시 시 다음 세션 창이 재전달을 보장.
- **로그아웃 정리** [리뷰 #6]: `cleanup.clearRecoverySyncState()`가 giftwrapCursors + anchor 캐시를 지운다 — 같은 니모닉 복원이 재설치 full replay로 시작.
- deep 결과는 syncAll 결과에 합산(토스트 과소보고 방지) [리뷰 #7]. `window.confirm`은 프로젝트 모달 관례와 다름 — 6단계 UI 정리 시 교체(수용된 minor #9).

**since 규칙 — 단 하나** [N1]:
```
since(relay) = floor((relayEoseAtMs[relay] ?? lastFullSyncAtMs) / 1000) − GIFTWRAP_OVERLAP_SEC
```
- 이것이 구독·backfill·재연결 **모든 경로의 유일한 공식**이다. "그 relay가 마지막으로 나에게 전부 줬던 시점"만이 그 relay에 대한 안전한 하한이며, 다른 relay들의 진행(`cursorAtMs`류)은 **절대 since에 넣지 않는다**.
- 반례로 고정(단위 테스트 필수): D0 전체동기 → relay C 다운 → D1에 C에만 존재하는 이벤트 발생 → D10 C 복귀. 규칙대로면 `since(C)=D0−Ω`로 회수. `max(전역커서, ...)`류 공식은 D7.75부터 조회해 **유실** — v2의 공식이 이 결함이었다.
- 전진: relay r EOSE → `relayEoseAtMs[r]=T0`(즉시 영속). **전(全) 대상 relay가 EOSE했을 때만** `lastFullSyncAtMs=T0`. timeout은 `lastAttemptAtMs`만 갱신 — **어떤 since 원천도 timeout으로 전진하지 않는다.**
- 최초(null) cursor: since 미적용 1회 — 기존 사용자 업그레이드 시 1회 전체 replay 후 확립(명시 수용).
- 장기 다운 relay가 `lastFullSyncAtMs`를 붙드는 문제: 단일 since 창이 커질 뿐 유실은 없다(중복은 processedStore가 폐기). **quorum 제외 최적화는 6단계의 per-relay 엔진과 함께만 도입** — per-relay backfill 없이 제외하면 유실이 생기므로 2단계에서는 도입 금지.

**2단계(단일 since)의 잔여 리스크 명시** [F6]: 2단계의 catch-up은 `lastFullSyncAtMs` 기반 단일 since라 유실은 없지만, relay 장기 다운 시 창이 커져 재다운로드가 늘어난다. per-relay 최적화·backfill은 6단계 배포물이다.

**deep-resync (oldestAnchor 의존 제거)** [F3]:
```
deepResync(key): since = floor(deepResyncAtMs/1000) − OVERLAP 로 1회 fetch,
                 완료 시 deepResyncAtMs = now. 초기값 = cursor 레코드 생성 시각.
트리거: ① 수동 "전체 재동기화" 버튼(이건 fullReplay — 재설치급 복원)
        ② unlock 시 나이 검사: now − deepResyncAtMs > 30일이면 1회 실행
           (PWA에 백그라운드 스케줄러가 없으므로 "월 1회"의 실체는 unlock-시 나이 검사다 [F3-잔여])
```
per-relay `relayEoseAtMs`가 영속되므로, deep-resync는 relay 장애가 아니라 **지연 발행**(relay가 이벤트를 뒤늦게 수령한 경우) 전용 안전망이다.

**단위 규칙**: Nostr 필터 `since`는 초. 저장은 전부 ms(`*AtMs` 접미사 강제). 변환은 컨트롤러의 `toSince(ms)` 헬퍼 한 곳 — 단위 테스트 필수.

**2단계 범위 한정** [F6]: `fetchGiftWraps`(querySync)는 per-relay EOSE를 노출하지 않는다. 따라서:
- **2단계** = 라이브 구독(`subscribeGiftWraps`) cursor만 — 기존 `since` 파라미터 자리에 배선, oneose는 구독 경로에 추가 (relay.subscribe 옵션으로 지원됨). catch-up(syncAll)은 이 단계에서 `since = lastFullSyncAtMs − OVERLAP` **단일값**만 적용(querySync 유지 — timeout으로 전진하지 않는 원천이므로 유실 없음)
- **6단계** = catch-up을 컨트롤러 구독 엔진(per-relay EOSE)으로 이관, per-relay since·backfill·quorum 최적화 완성
- 이 순서로 "고churn 작업 2회" 문제를 회피: 2단계는 파라미터 배선(저churn), EOSE 엔진은 6단계에 1회만 작성

### B6. 쿼리 병합·발행 스코프
- 10019/10050: `coalesceKey='10050:<pubkey>'` TTL 10분 + **resolve 결과를 send 플로우로 전달**(포트 diff §4) — transport의 2차 조회 삭제. 무캐시 콜사이트 3곳(스캔·SendInput·Contacts) 공통 적용
- profile publish: persistent set만. **relay 순서변경은 재발행 생략**(집합 동등성 비교 — 현재 드래그 커밋마다 3건 발행)
- RelayManagementScreen 생존 표시: raw WS 프로브 폐기 → 컨트롤러 `getRelayStatus()` 구독 (화면 맵 발견)

### B7. Lifecycle + Support
- 컨트롤러 `onWake`(3s 디바운스)가 유일한 visibility/online 소유자. gateway 헬스체크 즉시실행·support 훅·SupportPage의 자체 리스너 3계통 삭제 → onWake 구독으로 통일 (support의 15s 자체 스로틀은 유지 — onWake 위에 얹힘)
- support `connect()`: `RequestGate('support:connect')` in-flight 공유. `refresh()`(=풀 재구축)는 onWake 경유 1곳
- SupportPage와 전역 훅의 이중 refresh 제거 (같은 onWake 소스 공유)

### B8. 백스톱 (최후)
relay당 동시 REQ 상한 4, publish 직렬 큐 — §10 전체 적용 후 프로덕션 카운터에 relay rate-limit notice가 남을 때만.

### B9. 멀티탭
현 설계는 단일 활성 탭 가정(현행과 동일). 컨트롤러가 구독의 단일 소유자이므로 후속 Web Locks 리더 선출을 controller 생성 지점 한 곳에 끼울 수 있다 — 이번 범위 아님. cross-tab 알림은 기존 CrossTabSyncNotifier 유지 [F20-크로스탭].

---

# 공통

## 11. 마이그레이션 플랜

### 11.1 kill-switch 레지스트리 (1단계 선행 배포물) [F9]
피처 플래그 인프라가 없음을 확인했다(grep 0건). 최소 구현:
```ts
// core/utils/kill-switch.ts — localStorage 'zappi.ks.<name>' = '1' 이면 신경로 OFF
killSwitch('cursor')        // ON이면 since 미적용 (구동작)
killSwitch('tls-sweep')     // ON이면 30s 폴링 복귀
killSwitch('mint-info-facade')
killSwitch('recovery-split')
killSwitch('nostr-controller')
```
bootstrap에서 1회 읽어 조립 분기. 원격 제어 없음. **정직한 범위** [F9-잔여]: 스위치는 **개별 기기 지원 대응·개발 검증용**이다 — 코호트 단위 fleet 롤백은 여전히 revert+재배포이며 PWA SW 업데이트 지연(수 시간~수 일)을 수반한다. 표의 "롤백" 열은 이 한계를 포함해 읽는다. 부수 비용: 스위치가 살아있는 동안 구경로가 번들에 공존(이중 유지보수) — **각 스위치는 해당 단계 안정화 다음 릴리스에서 제거**를 원칙으로 한다.

### 11.2 단계

| # | 작업 | 게이트(진입 조건) | 롤백 |
|---|---|---|---|
| 0 | NetLog(dev 링버퍼) + **프로덕션 집계 카운터**(§12) [F10] | — | 카운터 플래그 off |
| 1 | **지혈 묶음**: NUT-18 expiresAt + 배선 테스트 · RequestGate(recoverAll/checkAllMints/support.connect) · onWake 디바운스 유틸 · **melt poll 상태매핑 수정(§7.1-2)** · **watcher 온라인 재시도(§7.1-3)** · **TLS pause 정지/재개** · kill-switch 레지스트리 | 0 배포 | 항목별 revert(스위치 불요 — 전부 결함 수정) |
| 2 | **Cursor(라이브 구독 한정)**: 스키마 v2+마이그레이션, subscribeGiftWraps since 배선, oneose, syncAll에 단일 since, deepResync 수동 버튼 + **unlock 나이검사(30d) 트리거** | 1 배포 + replay 총량 baseline | `ks.cursor` |
| 3 | **MintInfoService**: 파사드+메모리 미러, 5 소비자 이관, health 파생(분기 B), 재연결 refresh 단일화 | SP-1 완료(분기 A 확정용 — 분기 B는 무관하게 진행 가능) | `ks.mint-info-facade` |
| 4 | **Recovery 재편**: 행동 단위 분해(§6.1 표), 트리거 재배선, resume recheck 조건부화, **브리지 보강(§7.1-1 — B2 삭제와 동일 단계 필수 [N5])**, **review-queue 영속화+enqueue 순서 교정+drainReviewQueue(§6.3 선행조건 포함)** | 2·3 안정 1주 — **미준수 기록: 사용자 명시 지시로 2·3 배포 직후 착수**(안정화 관찰은 배포 후 ks.recovery-split OFF 상태에서 병행) | `ks.recovery-split` (recoverAll 구현이 구경로로) |
| 5 | **TLS 강등**: 120s stuck-sweep + 매트릭스(§7.3) | **카운터 7일 검증 프로토콜(§12) 통과** | `ks.tls-sweep` |
| 6 | **Controller 통합**: 연결/구독 레지스트리, attach 보장, catch-up EOSE 엔진, partial 보정, 쿼리 병합, publish 스코프, RelayMgmt 프로브 대체 | 2 안정 | `ks.nostr-controller` |
| 7 | **정리**: FeeEstimationService(8.4) · 타이핑 정책(8.5) · 외부복구 sweep(SP-2) · cleanAndRecover 처분(8.3) · 백스톱(필요시) | 각 게이트 | 항목별 |

(7의 FeeEstimation·타이핑 정책은 다른 단계와 독립 — 병렬 진행 가능. 순서 강제는 0→1→{2,3}→4→5, 6은 2 이후 아무 때나.)

## 12. 계측 [F10]

- **dev**: NetLog 링버퍼 1000건 + `__netlog.duplicates(ms)` (v1과 동일)
- **프로덕션 집계 카운터**: PII 없는 카운터만 — `{coco_push_received, tls_stuck_detected, tls_stuck_confirmed_settled, giftwrap_events_received, giftwrap_events_deduped, relay_notice_rate_limited}`. **쓰기 정책** [N6]: 이벤트당 Dexie 쓰기 금지 — 메모리 누적 후 30s 주기 + `pagehide`/`onPause`에 flush (catch-up replay 핫패스는 NIP-44 복호화와 같은 스레드다). 설정 "진단" 페이지 열람, 원격 전송 없음
- **5단계 검증 프로토콜(정직한 정의)** [N6][F10-잔여]: "증명"이 아니라 **표본 검증**이다 — ① 팀 상시 사용 기기 최소 3대(iOS Safari·Android Chrome·데스크톱) 7일 ② 각 기기에서 결제 시나리오(수신·송금·백그라운드 정산) 주 5회 이상 ③ 판정: 전 기기 `tls_stuck_detected = 0` AND `coco_push_received > 0`(푸시 실동작 확인). 실패 시 5단계 보류·원인 규명(주기 단축이 아니라 — §3.3)
- 단계별 판정 예: 1단계 후 unlock에 `recovery:*` 중복 0 / 2단계 후 resume의 `giftwrap_events_deduped`가 overlap 창 기대치로 하락
- **분기 A는 NetLog 밖** (3단계 기록): Coco 경유 fetch는 이 계층에서 네트워크 발생 여부를 알 수 없어 계측하지 않는다 — `duplicates()`만으로는 분기 A 중복을 못 본다. 3단계 게이트 판정은 probe(`caller:'mint-info'`) + Coco 요청 로그(수동)로 보완한다.
- **배선 현황 (1단계 구현 시점 — 코드리뷰 #8)**: `giftwrap_*`는 라이브 구독 경로만 계수한다 — syncAll/anchor 캐치업 경로 계측은 **2단계에서 gateway 경계에 추가**해야 before/after 비교가 완전해진다(core 서비스에서의 직접 계수는 헥사고날 위반). `tls_stuck_*`·`relay_notice_rate_limited`는 5단계 sweep/컨트롤러 배선 전까지 0이 정상 — **게이트 판정에 쓰려면 해당 배선이 선행 조건**이다. `coco_push_received`는 전송 수단(WSS/Coco 내부 폴링)을 구분하지 않는 "이벤트 파이프라인 생존" 지표다. 진단 열람 UI(`readNetCounters` 소비자)는 미구현 — 5단계 게이트 전 필수 후속.

## 13. 테스트 전략

| 계층 | 대상 |
|---|---|
| 단위 | RequestGate(동시성·성공/실패 쿨다운 분리·인스턴스 스코프), cursor(`toSince` ms→s, overlap 경계, **v1 초단위 레코드 마이그레이션**, null cursor 1회 full, **N1 반례 타임라인: D0 전체동기→C 다운→D1 C-단독 이벤트→D10 복귀 시 회수**, timeout 비전진), 레지스트리(refcount·TTL 120s·attach 보장·persistent∩session·id replace 규칙), kill-switch 분기, drainReviewQueue(민트 신뢰 시 해당 민트 큐만 상환) |
| 통합(fake relay) | since 적용 시 과거 이벤트 미수신 / oneose→전진 / relay 1개 다운 중 catch-up→재연결 시 그 relay만 backfill / **kill 후 재기동 시 relayEoseAtMs 영속 확인** [F4] |
| 배선 회귀 | bootstrap 조립 스냅샷(NUT-18 opts 필드 전수), transfer-sdk-bridge 이벤트 목록 스냅샷(melt-op:* 포함) |
| 계측 어서션 | dev E2E: unlock에서 `duplicates(5000)` 빈 배열, my-wallet confirm 1회에 견적 왕복 ≤4 |

## 14. 리스크 레지스터

| # | 리스크 | 완화 |
|---|---|---|
| R1 | Coco getMintInfo가 repo 읽기 → health 부적합 | §5.4가 SP-1 무관하게 성립하는 2-분기로 재설계됨 [F14] |
| R2 | wallet.sweep 결과 비동등 | SP-2 게이트, 실패 시 현행+상한+취소 (§8.2) |
| R3 | relay-고유 이벤트 유실 | relayEoseAtMs 영속(v1부터) + 월간 bounded deep-resync + 수동 fullReplay [F3][F4] |
| R4 | Coco push 커버리지 불완전 | 프로덕션 카운터 7일 게이트 + stuck-sweep은 감지+확인까지 수행 (§7.3) [F2][F10] |
| R5 | abandonMintQuote 스키마 수술 | 버전 고정, §8.3 게이트로 제거 지향 |
| R6 | resume 시 소켓 좀비 미감지 | onWake에서 ensureRelay/ping 확인 후 선별 재개, 실패 시 그 relay만 재구독 |
| R7 | gate가 정당한 재시도 흡수 | 실패 쿨다운 30s 분리, 수동 버튼 gate 미적용 [F8] |
| R8 | 송신자 시계 오차 | overlap에 +6h 마진 [F5] |
| R9 | 견적 캐시로 수수료 표시가 실제와 어긋남 | TTL 60s + 실행 직전 재검증은 기존 execute 경로가 수행(견적≠실행) |
| R10 | kill-switch 조합 폭발 | 스위치는 5개 고정, 조립 분기 지점은 bootstrap 1곳, 조합 테스트는 개별 on/off만 |
| R11 | 오프라인 unlock 후 watcher 미기동 | §7.1-3에서 1단계 선반영 [F11] |

## 15. 스파이크 / 오픈 퀘스천

- **SP-1**: `manager.mint.getMintInfo` — repo 읽기 여부·미등록 민트 동작·강제 갱신 수단 (반나절, §5.4 분기 A 확정용)
- **SP-2**: `wallet.sweep` 동등성 (1일, 테스트 민트)
- **UP-1**: coco-core에 `checkProofStates` 공개 API 제안
- **UP-2**: (SP-1이 repo-읽기로 결론 시) 강제 신선 `getMintInfo` 옵션 제안 — §5.4 분기 B의 영구 우회 해소용
- **OQ-1**: deep-resync 월 1회의 적정성 — 카운터로 지연 발행 실측 후 조정
- **OQ-2**: nostr-cs 풀 통합 가치 재평가 (컨트롤러 안정 후)

## 16. 트리거별 Before/After (화면 맵 반영판)

| 트리거 | Before | After |
|---|---|---|
| unlock | Coco복구4종 + recoverAll(B1~B9 전부) + watcher전수 + stale정리 + /v1/info×2N + 1059 전체 + syncAll×2 | Coco복구4종 + watcher전수 + `reconcile`+`recoverTargeted`(B7a·B9만 네트워크) + /v1/info×N(30s 캐시) + 1059 **overlap 창** |
| resume | watcher 재기동 전수 + recoverAll + 1059 전체 재수신 + support 재구축 | 소켓 확인·죽은 relay만 cursor 재개 + `reconcile`(로컬) + recheck는 5분 초과 백그라운드시만 + support는 onWake 1곳 |
| 30초마다 | TLS: quote원격 + raw proofs원격 (pause에도) | 없음 — 120s 로컬 stuck 검사(pending 있을 때만·pause 정지), stuck시만 매트릭스 확인 |
| 탭 전환→Home 재마운트 | checkAllMints + metadata 체인 (30s 캐시 완충) | 트래픽 자체는 유사 — **실 이득은 체인 제거(민트당 2→1회)와 단일 소유** [N10] |
| 송금 확인(my-wallet) | 견적 4왕복 ×2(이중) = 8 | 견적 4왕복 ×1 · 동일 금액 재진입 캐시 0 · **금액 편집마다는 여전히 4왕복** [N4] |
| Token 탭 | recoverAll + 토큰 N×(prepare+cancel) | `reconcile`(로컬) + 견적 캐시 |
| 토큰 전송(연락처) | 10050×2 + relay 영구 누적 | 10050×1(전달) + session lease(TTL 후 해제) |
| 프로필/릴레이 저장 | 3종 publish×누적 전체(순서변경 포함) | 3종×persistent, 집합 불변 시 생략 |
| 릴레이 관리 화면 | 전 relay raw WS 프로브(순서변경마다) | 컨트롤러 상태 구독 — 신규 연결 0 |
| pending 상세 열기 | checkAlive+expiry probe 1~2왕복 | 유지 (사용자 액션 1:1, Coco 경유) |

## 17. 부록 — 화면·유스케이스 전수 맵 (통합 대상 지정)

경로: **Coco**=limiter 내 / **우회**=limiter 밖 / **relay** / **외부API**. "→" 뒤가 통합 후 소유자.

### 전역 (MainApp/bootstrap)
| 시점 | 동작 | 이유 | 경로 | → 소유자 |
|---|---|---|---|---|
| unlock | initializeCoco+잔액 | 즉시 잔액 표시 | Coco(로컬 위주) | 유지 |
| unlock | syncAll(anchor+1059 전체) | 타기기·오프라인 수신 복구 | relay+Coco | Controller cursor(§10.5) |
| unlock | watcher enable+1059 구독+TLS 30s+stale정리 | 실시간 수신·미완료 복구 | Coco+relay | watcher 유지 / 구독 cursor / TLS→sweep / stale→§8.3 |
| unlock 직후 | recoverAll | pending 정리 | Coco | reconcile+targeted(§6) |
| resume | 구독재개+recheck전수+recoverAll+1059 재구독+환율 | 백그라운드 공백 메우기 | Coco+relay+외부API | §6.3 resume 행 |
| 30s 상시 | TLS 폴링(ecash raw proofs 포함, pause 미정지) | 수령/결제 감지 | Coco+**우회** | §7 sweep |
| 30s 상시 | gateway 헬스체크(+무디바운스 visibility) | relay 유지 | relay | Controller onWake+선별 재구독 |
| pull-refresh | recoverAll+checkAllMints+환율 | 수동 동기화 | 복합 | targeted(gate)+getMany(30s) |
| 스캔 | 10019/10050 resolve 또는 LNURL GET | 목적지 검증 | relay/외부API | 쿼리 병합(§10.6)+§8.5 정책 |
| 신뢰 민트 추가 | raw /v1/info + Coco addMint + 프로필 3종 publish | 검증·등록·공표 | 우회+Coco+relay | 파사드 get + addMint 역주입 + persistent publish |

### 화면별
| 화면 | 시점 | 동작 | 이유 | → 소유자 |
|---|---|---|---|---|
| Home | mount(탭 전환마다) | checkAllMints→metadata 체인 | 민트 온라인 배지 | MintInfoService(§5) — 체인 삭제 |
| Token | mount(30s 스로틀) | recoverAll | 상대 수령 반영 | reconcile(로컬) |
| Token | mount/ids 변경 | 토큰 N×quoteReclaim(prepare+cancel) | 회수 수수료 표시 | FeeEstimationService 캐시(§8.4) |
| Token | 회수 버튼 | proof 확인+rollback/receive | 되찾기 | 유지(액션 1:1) |
| Settings | 현재지갑 복구 | recoverAll+민트별 restore | 시드 복구 | runFullNetworkRecovery+recoverAccounts(§6.2) |
| Settings | 외부 니모닉 복구 | discovery+raw batchRestore | 자금 이관 | sweep(SP-2) 또는 상한+취소(§8.2) |
| MintManagement | mount / 행 확장 | checkAllMints / raw /v1/info | 상태·상세 표시 | MintInfoService — 확장은 캐시 히트 |
| RelayManagement | mount·순서변경마다 | 전 relay raw WS 프로브 | 생존 점 표시 | 컨트롤러 상태 구독(§10.6) |
| RelayManagement | 저장 | (relays 변경 시) 프로필 3종 publish | NIP-65 갱신 | 집합 불변 시 생략(§10.6) |
| MintDetail/InfoSheet | 시트 열림 | raw /v1/info | NUTs/contact 표시 | MintInfoService 캐시 |
| PendingItemDetail | mount | checkAlive+expiry probe | 만료 판정·정리 | 유지(Coco 경유 확인) |
| AddMint | mount / 추가 | 디렉터리 GET / fetchAndCache+publish+recoverAll | 추천·검증·"복원" | 디렉터리 세션캐시 / **drainReviewQueue(민트 신뢰 시 큐 상환)** + targeted(gate우회) — restore는 별도 명시 액션(§6.3) |
| Receive | QR 표시 | quote 생성 1회+NUT-18 3s 폴러 | 수신 대기 | 유지+expiresAt 수정(§8.1) |
| Send | 타이핑 중 | LNURL GET(부분 도메인 발신) | 사전 검증 | §8.5 — 제출 시점으로 한정 |
| Send | 목적지 확정 | 10019/10050 resolve | 수신 민트 파악 | 쿼리 병합+결과 전달(§10.6) |
| Send | amount→confirm / confirm 민트 변경 / **my-wallet confirm mount** | 견적 2~4왕복 (+이중 견적) | 수수료 표시 | FeeEstimationService — 이중 제거·캐시(§8.4) |
| Contacts | 보내기 | resolve(무캐시) | 반복 상대 송금 | 쿼리 병합 TTL — 이득 최대 지점 |
| Support(전역 훅+페이지) | mount·visibility×2계통 | connect/refresh(풀 재구축) | 문의 동기화 | RequestGate+onWake 단일화(§10.7) |
| TokenCreate/Register | confirm 진입 | 견적 1회 | 수수료 표시 | 유지(진입당 1회 — 양호), Register의 신규민트는 addMint 경유 |
| Transfer/History/Analytics 등 | — | 네트워크 없음 | — | — |

### 버킷 외 확인 사항 (leak/불일치 — 화면 맵 발견, 전부 본문에 반영됨)
- TLS `stopPolling` 호출부 전무(pause/lock/logout) → §7.2
- 구독 attach 레이스(연결 후 attach 누락) → §10 B3
- AddMint "복원" UI와 recoverAll 불일치 → §6.3
- SendInputStep 타이핑-중 발신 → §8.5
- my-wallet 이중 견적 → §8.4
