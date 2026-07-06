# Current Task — 감사 잔여 항목 실행 (2026-07-06 계획, 비관 리뷰 반영 v3)

근거: docs/audit/2026-07-06-non-network-refactoring-audit.md + 계획 비관 리뷰(REJECTED 3건 → 반영).
원칙: 매 Phase 커밋 분리, 매 Phase `bun run lint && bun run build && bun run test:run` 통과(`test`는 watch 모드), 자금 인접 Phase(0·1·2·**3**·4)는 비관적 리뷰 APPROVED 후 커밋(3도 resetAll·레지스트리 타입을 만지므로 포함 — 리뷰 MAJOR-11).

## Phase 0 — 안전망 선행 (S)
이후 리팩토링의 회귀 감지망. 프로덕션 코드 변경은 swallow 2곳만.
- [x] `utils/format.ts` fiatToSats 경계값 테이블 테스트 (0, 1sat 미만, 소수, NaN, 반올림 방향 — float half 미묘함 포함 문서화)
- [x] `token-codec.adapter.ts` 테스트 신설: bolt11 msat→sat floor, BTC→sat round(BIP-21), cashuA/cashuB 검사, 잘못된 입력
- [x] `direct-lnurl.adapter.ts` sat→msat 변환 테스트 (floor·경계 포함·comment 게이팅·resolvePay)
- [x] **돈 이벤트 브리지 테스트** (리뷰 MAJOR-16, R2 정정): `mint-quote-observer` 테스트 **신설** + transfer-tx-bridge refresh 발화 계약 보강(event-store-bridge 는 기존 커버 확인으로 skip) + coco-event-bridge·gift-wrap-settlement.bridge 신설
- [x] silent-swallow 수정 (리뷰 MINOR-15 정정): `swap.service.ts:333-335` console.error 표준화 + `MainApp.tsx:758` translateError·`:1362/:1365-1366` t() 키化(`token.history.deleteSuccess/deleteFailed` 5로케일). (:1338 영어 하드코딩은 병행 i18n 소관 — 이중 배정 금지)
- [x] **B-1 (Phase 0 비관 리뷰 BLOCKING, 범위 추가)**: `error-i18n.ts` getErrorI18n 의 BaseError 분기에 UNKNOWN 가드 부재 → 존재하지 않는 `errors.unknown` 리터럴 키가 토스트에 노출(SwapService 는 전 실패를 UnknownError 로 래핑). 수정: ① UNKNOWN 은 메시지 패턴 매칭으로 폴백(branch 2와 대칭) ② translateError 키-부재 강등 가드(리터럴 키 노출 원천 차단) ③ `errors.adapterNotFound` 5로케일 추가 ④ error-i18n 핀 테스트 신설(방출 키 집합 × 5로케일 존재 검증 포함) — 기존 translateError 호출부 전체(MainApp:1348/:1543, Receive/SendFlow 등)의 잠복 버그 동시 해소
- [x] 비관 리뷰 → REJECTED(B-1) → 수정 → 재리뷰 → 커밋

## Phase 1 — 로그아웃 = 계정 데이터 완전 소거 (S-M, 프라이버시 실버그)
목적 재확인: "이전 계정 데이터 잔존 제거"가 **coco DB(실제 자금)와 localStorage 앵커까지** 포함해야 함 (리뷰 BLOCKING-1·2).
- [ ] wipe 로직을 composition 함수(`composition/logout.ts` 등)로 추출 — MainApp 인라인이면 테스트가 실코드를 못 잡음 (리뷰 MINOR-5)
- [ ] **실행 순서 명문화** (리뷰 MAJOR-4): ① `support.destroy()`+`registry.dispose()` 유지(메모리 키 제로화·타이머 정지) → ② coco DB 삭제(대기형) → ③ `db.delete()`(대기형+폴백) → ④ localStorage 정책 적용 → ⑤ `broadcastSync('logout')` 신설(타 탭 즉시 reload; BroadcastChannel 부재 시 무시) → ⑥ `resetAll()` → ⑦ reload. 어느 단계든 실패 시 성공 가장 금지(에러 표면화)
- [ ] **`deleteCocoData()` 재작성** (리뷰 BLOCKING-2): 현행 onblocked/onerror→resolve()(무음 성공)를 폐기 — onsuccess까지 대기+타임아웃, blocked/실패 시 에러 표면화. coco-indexeddb는 Dexie 기반이라 타 탭은 versionchange로 자동 close됨(대기 전략이 성립)
- [ ] **zappi DB 소거 = clear-first, delete-best-effort** (리뷰 MAJOR-3 + 재심 MAJOR-R1 도치): ㉠ 살아있는 커넥션에서 `Promise.all(db.tables.map(t => t.clear()))` **선행**(버전 변경 불요 — 타 탭이 열려 있어도 블록 불가, 동적 열거로 나열-드리프트 차단) → ㉡ `db.delete()`는 타임아웃부 best-effort(성공 시 스키마까지 제거; blocked여도 데이터는 이미 소거됨). 어느 단계든 실패 시 에러 표면화. (역순은 불가 — Dexie delete()가 자기 커넥션을 먼저 닫아 타임아웃 시점엔 폴백이 커넥션을 얻지 못한다)
- [ ] localStorage 정책: 삭제 — `passkey_credential`+`passkey_encrypted_pin_v3`(removePasskey가 legacy 포함 커버), **`zappi-anchor`(리뷰 BLOCKING-1 — 남기면 다른 니모닉 재온보딩이 full replay를 생략해 자금 미발견)**, `zappi_last_alive_at`, `zappi-balance-cache`(현행이 안 지우는 실버그 동시 수정). 유지 — `lockout`·`zappi_invite_*`(브루트포스 방어), `zappi-language`(선호), `zappi.ks.*`(기기 설정)
- [ ] 죽은 `clearAllData` 삭제; `clearRecoverySyncState`는 로그아웃 경로에서 대체되므로 cleanup 표면 축소(anchor 정리가 위 localStorage 정책으로 승계됨을 커밋 메시지에 명기)
- [ ] 테스트: fake-indexeddb로 로그아웃 후 전 테이블 소멸 + localStorage 정책(anchor 포함) + blocked 폴백 경로
- [ ] 비관 리뷰 → 커밋

## Phase 2 — 민트 URL 동등성 수렴 (M, 자금-표시 버그 지뢰)
**원칙 재정의 (리뷰 BLOCKING-6 — 이전 문면은 자기모순)**: `normalizeMintUrl`(utils/url.ts)의 **의미는 동결한다**(저장·와이어 시점에 호출되므로 변경 = 저장 정규화 변경). 소문자화·기본 포트 제거는 **신설 `isSameMintUrl`/`mintUrlKey` 비교 전용 canonical 내부에만** 구현하고 export를 최소화한다.
- [ ] `utils/url.ts`에 비교 전용 canonical(`mintUrlKey`: 파싱 기반 호스트 소문자화+기본 포트 제거+trailing slash 제거) + `isSameMintUrl` 확정, 변형 표기 회귀 테스트 표(:443, 대소문자, trailing slash, 경로)
- [ ] **비교 사이트를 canonical로 교체**: remove-mint/cashu-recovery/routing/nostr-direct-payment/bootstrap(scoped fetcher)/external-mnemonic-discovery + 리뷰가 추가 발견한 비교 사이트(settings-trusted-account-store 내부 불일치, ContactsScreen:283, SendFlow:689, MainApp:1763, dexie-incoming-review-queue 자체 키)
- [ ] **byMint 조회 miss도 이번 범위** (리뷰 MAJOR-7): balance.byMint 키는 coco-canonical인데 UI 4곳이 settings raw로 조회(ConfirmStep:61, AmountStep:62, MintSelectBottomSheet:65, UsernameChangeScreen:164) — `getMintBalance`를 canonical 기반으로 확장
- [ ] 제외 확정: `customer-support-config`(민트가 아니라 서포트 릴레이 검증기 — 수렴 시 접속 파괴), `relayIdentity`(릴레이 전용 — pool과 동일 필수), wallet-cache.ts(Phase 3 삭제 예정 — 건너뜀)
- [ ] AddMintScreen raw `===` 중복검사 3곳(:122/:223/:363)을 isSameMintUrl로 (기존 저장행과의 중복 생성 방지)
- [ ] 비관 리뷰 → 커밋

## Phase 3 — 죽은 코드 대청소 (S-M — Phase 4의 선행)
삭제 전 참조 0 재확인 — **`await import(` 동적 패턴 포함** grep (동적 전용 모듈 15곳 존재).
- [ ] LNURL-auth/withdraw 슬라이스: 6파일+driving 포트 2+레지스트리 타입(withdraw/lnurlAuth)+`{}` 스텁 제거. **생존 확인된 lnurl-gateway.port/direct-lnurl.adapter는 유지**(InputParser 경로). 테스트 레지스트리 스텁 3곳 동반 수정. `@noble/curves`는 같은 커밋에서 제거(유일 소비자)
- [ ] primitives 정리 (리뷰 MAJOR-9 정정): **tabs.tsx는 살아있음**(ReceiveQRStep:16) — 선-마이그레이션(공용 컴포넌트로) 후 삭제하거나 tabs+`@radix-ui/react-tabs`만 존치. `cn`은 ui/lib/utils.ts가 원본이고 primitives/utils는 shim — **21개 import 경로 재지정**. 나머지 primitives+radix(사용분 제외)+embla/cmdk/vaul/input-otp 제거
- [ ] **vite.config manualChunks 동반 수정** (리뷰 MAJOR-11): `vendor-nostr`에서 ndk 제거(직전 coco 마이그레이션의 동일 클래스 블로커 전례). 제거 후 **빌드 청크 산출 확인을 게이트에 추가**
- [ ] 미사용 패키지 제거(ndk, sonner, react-resizable-panels, @noble/ciphers), @testing-library/dom devDeps 이동, 유령 postinstall 제거
- [ ] 고아 정리 (리뷰 MINOR-12 정정): 훅 4종(use-balance/use-username/useNetworkStatus/use-recovery — **hooks/index.ts barrel 수정 동반**), common 컴포넌트 7종+barrel-only 5종(BalanceDisplay·CheckAnimation·CoinBounceAnimation·StatusBadge·UnifiedScanner — sub-barrel 수정 동반), FaceIdSettingPage, PinChangeModal. **wallet-cache.ts는 Phase 1이 로그아웃 호출부(MainApp:990-991)+bootstrap 배선을 제거한 뒤에만 삭제 가능**(순서 의존 명기). mock-store는 __tests__ 이동(테스트 2곳 import 수정). **`TokenCreate/mockData.ts`는 삭제**(importer 0), **개명 대상은 `Token/mockData.ts`**(importer 5 — token-view-model.ts로)
- [ ] 유령 상태 제거(wallet.slice mints/updateMintStatus/setMints/셀렉터 3종+호출부 4곳, store activeMintUrl 이중화)
- [ ] resetAll 재구성: 슬라이스별 고유 reset 이름 → resetAll은 호출만, 60줄 복제 삭제 (외부 `.reset()` 소비자 0 확인됨)
- [ ] hex/bytes 변환 @noble/hashes/utils 통일, truncateStr·상대시간 중복 제거, MainApp **:616-621 `//old receive` 주석 블록** 삭제 (재심 R3 정정 — :592-606은 살아있는 자동잠금 코드, 오삭제 금지)
- [ ] 묶음별 chain(+빌드 청크 확인) → **비관 리뷰** → 커밋(2~3분할)

## Phase 4 — MainApp 분해 (L, 1~3 완료 후)
순수 이동 원칙 + **예외 지점 명시** (리뷰 MAJOR-14).
- [ ] 4a. `useAppNavigation` 추출 — 가장 안전. `setHasSettingsSubPage`(SettingsScreen과 공유)의 소유를 훅으로 결정
- [ ] 4b+4c **공동 설계** (리뷰 MAJOR-14): `refreshAll`은 tx+balance 원자 갱신이고 13개+ 핸들러가 공유(3곳 await 의존) — transactions 훅이 **awaitable refresh(잔액 포함)**를 노출해 원자성 유지. 핸들러 훅 분리 순서: useSecurityHandlers → useMintHandlers → useReceiveHandlers → useSwapHandlers. 순수 이동 불가 지점(handleRejectIncomingReview의 네비+scan 상태 mutate, handleUnlock의 부트스트랩 심)은 개별 판단 기록
- [ ] 4d. 화면 switch → 라우트 테이블 — token/token-detail 결합 블록(:1283-1374)과 state 가드 3곳은 기계 변환 불가로 예외 처리
- [ ] `transitionPhase` 합법 전이 맵 (리뷰 MAJOR-13): **FinalityModel 인지 맵**으로 설계 — 현행 정당 전이(preparing→settled 즉시 melt, submitted→settled 즉시 finality, recoverable→settled reclaim)를 수용, 존재하지 않는 phase('delivered'/'expired') 도입 금지, settled→비종단 역행만 거부 — 독립 커밋
- [ ] 화면 25종 스모크 체크리스트 작성 후 분해 단계마다 수행
- [ ] 비관 리뷰(4 전체) → 커밋

## 병행 (독립 — 아무 Phase 사이에나)
- [ ] i18n 하드코딩 키化: TokenRawSheet 4곳·use-global-token-claim-toast·MainApp **:1338(영어)** — 한국어 :1362/:1365-66은 Phase 0 배정이므로 여기서 제외(이중 배정 금지), `CustomTypeOptions`(typeof en) 증강, `errors.serviceNotReady` 5로케일+고아 키 5개 삭제, support.* ja/es/id 88키 번역, PWAInstallGuard t()

## 명시적 비범위 (의도적 이월 — 리뷰 MINOR-17로 명시화)
- PBKDF2 반복수 상향(재암호화 마이그레이션 별도 설계), POS 키 반출 UX, 프로덕션 console drop
- Result 타입 2종 통일, core 원시 throw 19곳, bootstrap 내부 절단, SendInputStep 선분리, payment.service findModuleForAccount 정직화, 온보딩 배선 composition 이동, proofs 툼스톤, 커버리지 임계, ui→adapters 2건 — 이번 라운드 제외(다음 라운드 후보)
- 네트워크 개편 이월(§8.2/8.3, ks 구경로 삭제) — 검증 게이트 대기

---

# Previous Task — eCash External Claim Finalization + Token Toolbar Polish

- [x] Trace why an externally claimed generated eCash token is not reflected immediately in the app
- [x] Fix the app-side finalized send path without bypassing Coco proof-state detection
- [x] Make reclaim-vs-recipient-claim races settle through the same claimed-send path
- [x] Align Token tab create/register button height with the current bottom tab toolbar
- [x] Add focused regression coverage and run full verification

Plan
- Keep external claim detection source in Coco proof-state watchers. Do not add polling hacks or UI-side status guessing.
- Treat Coco `send:finalized` as an application-domain state transition: update transaction outcome, clear pending operation, emit semantic events, and refresh balance/transaction subscribers.
- Keep UI polish scoped to `CreateRegisterPair`, matching the existing toolbar height without changing create/register semantics.

Review
- Root cause: `connectSendTokenObserver` already received Coco `send:finalized` events, but `ReclaimService.finalizeSend()` only finalized the SDK operation by `operationId`. It did not mark the transaction as claimed, delete the pending op, or emit `send:claimed` / `transactions:changed` / `balance:changed`, so the UI could miss an external wallet claim until another recovery path ran.
- `ReclaimService.finalizeSend()` now ignores already-finalized SDK state idempotently, then settles the send transaction as `claimed`, clears the pending operation, emits `send:claimed`, refreshes transaction lists, and requests balance refresh.
- The manual reclaim path now uses the same claimed-send settlement when rollback races with a recipient claim, so it no longer leaves a partially updated state with missing semantic events.
- Token tab create/register buttons now use a 52px visual height, matching the current bottom toolbar group height, and share the same tap feedback as the other toolbar buttons.
- This fix does not force instant detection if a mint delays or does not emit proof-state subscription updates. It fixes the app-side dropped state propagation once Coco detects the external claim.
- Verification passed: focused `ReclaimService` tests (21 tests), `bun run lint`, `npx tsc --noEmit`, `bun run test:run` (97 files / 700 tests), `bun run build`, `node .claude/skills/hex-review/scripts/check-hex-violations.mjs src` (576 files, 0 violations), and `git diff --check`. Build still emits existing Vite dynamic/static import and chunk-size warnings.

# Previous Task — Coco rc50 to v1.0.1 Migration

- [x] Re-read root and wallet rules before implementation
- [x] Create an isolated `staging` worktree so existing dirty work is not overwritten
- [x] Replace legacy `coco-cashu-core` / `coco-cashu-indexeddb` dependencies with `@cashu/coco-core` / `@cashu/coco-indexeddb` `1.0.1`
- [x] Move SDK imports to the new scoped packages without exposing Coco types outside the Cashu module boundary
- [x] Update v1.0.1 token decode and balance API usage through Cashu module internals
- [x] Keep NUT-18/NIP-17 transports protocol-neutral by injecting a token decoder from the composition root
- [x] Run lint, typecheck, tests, build, hex-review, and `git diff --check`

Plan
- Keep all Coco SDK imports inside `modules/cashu/**`, adapter tests, or the composition root. Core/domain/services must not import SDK types.
- Decode outgoing token payloads via Cashu module internals using the Coco manager so token-version handling does not leak into Nostr/HTTP transports.
- Regenerate both tracked lockfiles so `rc50` package names are fully removed from install metadata.
- Treat new Coco IndexedDB tables as SDK-owned module internals and include them in mint-scoped cleanup when needed.

Review
- Dependency names were migrated from `coco-cashu-core@1.1.2-rc.50` and `coco-cashu-indexeddb@1.1.2-rc.50` to `@cashu/coco-core@1.0.1` and `@cashu/coco-indexeddb@1.0.1`.
- `getDecodedToken` usage from the old Coco package was removed. Token metadata comes from `@cashu/cashu-ts`, while full token decoding for payment payloads goes through `manager.wallet.decodeToken()` inside the Cashu module.
- Balance reads now use `manager.wallet.balances.byMint()` and map the SDK balance snapshots back to the existing app-facing `{ [mintUrl]: number }` shape.
- Nostr and HTTP NUT-18 delivery now receive a protocol-neutral token decoder via composition, so transport adapters do not know Coco internals or directly decode Cashu tokens.
- `coco_cashu_auth_sessions` was added to mint-scoped Coco cleanup so deleting a mint does not leave v1.0.1 auth session state behind.
- Verification passed: `npx tsc --noEmit`, `bun run lint`, `bun run test:run` (97 files / 697 tests), `bun run build`, `node .claude/skills/hex-review/scripts/check-hex-violations.mjs src` (576 files, 0 violations), `git diff --check`, and `rg` confirmed no `rc50` / `coco-cashu-*` references remain in package files, lockfiles, source, or Vite config.
- Build still emits existing Vite dynamic/static import and chunk-size warnings; the migration-specific build blocker was the old `vendor-coco` manual chunk entry and is now fixed.

# Previous Task — Wallet Recovery + npub Send + Name Limits

- [x] Re-read root/wallet rules and current lessons before implementation
- [x] Change address-book name limit to 30 and mint custom name limit to 20 via shared constants
- [x] Remove onboarding wallet import/recovery so a fresh install only creates a new wallet
- [x] Split settings wallet recovery into current-wallet recovery and external-mnemonic ecash import
- [x] Implement external-mnemonic recovery without mutating the current Coco seed/cache
- [x] Enable address-book npub send and manual npub/nprofile send input
- [x] Enforce npub send policy: common mint required, recipient DM relay required, P2PK applied when advertised
- [x] Run lint, typecheck, tests, build, hex-review, hardcoding/security scans, and `git diff --check`

Plan
- Keep UI outside the hexagon by using `ServiceRegistry` driving ports. Do not import Coco internals from UI.
- Recovering another mnemonic must restore proofs with an isolated cashu-ts wallet, encode recovered unspent proofs as Cashu tokens, and redeem those tokens through the current wallet. Never swap the global Coco seed getter or current encrypted wallet mnemonic.
- Direct npub/nprofile sending is modeled as a same-mint-only NUT-18/NIP-17 payment target. It reuses the existing route executor and P2PK locking path, but disables cross-mint fallback for this entry point.
- Address-book entry starts with no source mint, so it shows only common mints. Mint-card entry preserves the selected source mint and asks the user before switching if the recipient cannot receive from that mint.

Review
- Address-book names now use `LIMITS.MAX_CONTACT_NAME_LENGTH = 30`; mint custom names use `LIMITS.MAX_MINT_NAME_LENGTH = 20` in mint info editing and the reusable mint card edit path.
- Fresh onboarding no longer offers mnemonic import/recovery. It only creates a new wallet, fetches ZS config/default settings, and publishes the new wallet profile.
- Settings wallet recovery now starts with a choice: recover missing ecash for the current wallet, or scan another mnemonic and import recovered ecash into the current wallet.
- External mnemonic recovery uses an isolated `cashu-ts` wallet with `batchRestore` per registered mint/keyset, filters unspent proofs, encodes them as Cashu tokens, and redeems through the current `PaymentUseCase`. It does not swap or mutate the current Coco seed/cache.
- Address-book npub/nprofile send and manual send input are enabled. Sending requires recipient `10019` mint info, a common mint, and recipient `10050` DM relay info. `nprofile` relay hints and local default relays are not used for actual sending.
- P2PK is applied only when the recipient advertises it in `10019`; otherwise the same-mint NUT-18 delivery path remains unlocked because current wallet P2PK locking is optional for this scope.
- Same-mint-only direct npub sends cannot fall back to Lightning/cross-mint routes. If the selected mint is unsupported but another common mint exists, the user must explicitly select one of the common mints.
- Verification passed: `npx tsc --noEmit`, `bun run lint`, `bun run test` (93 files / 687 tests), `bun run build`, `node .claude/skills/hex-review/scripts/check-hex-violations.mjs src` (551 files, 0 violations), and `git diff --check`.
- Manual security/hardcoding scan found no new private keys, nsec values, production relay constants, `hex-ignore`, TODO/FIXME workaround markers, or UI-to-adapter/module/composition boundary violations in the new implementation. Sensitive-looking matches were test fixtures only.
- Root `verify-implementation` still references a missing `verify-ecash` skill, and wallet-local `verify-*` skills are absent, so that authored verify pipeline remains non-executable in the current workspace.

# Previous Task — Customer Support Inbox Unread UX

- [x] Re-check root and wallet rules before changing support UX
- [x] Add protocol-neutral local archive support for customer-side inquiry deletion
- [x] Add global support unread summary state and reply toast watcher
- [x] Propagate unread badges from root settings navigation to profile, support history, and ticket cards
- [x] Preserve agent-side resolved/closed status after restart when the original ticket event replays
- [x] Rework support history cards to remove card status/chevron, show compact date next to title, show terminal copy in preview, and keep unread reply count
- [x] Add a vertical action menu for pin/unpin, mark read, and local leave/archive actions
- [x] Polish support card details: pinned icon next to the date, centered larger action button, outside-click menu dismissal, unread badge overlay, and support UI radius aligned to `rounded-card`
- [x] Polish support conversation details: support-agent messages show the Zappi logo and `Zappi team`, and the support page no longer reserves excessive bottom padding
- [x] Persist pin/read/archive state in the support history store without sending unsupported customer-side resolve/close events
- [x] Run focused support tests, typecheck, lint, hex-review, full tests/build, security/hardcoding scans, and `git diff --check`

Review
- Customer-side deletion is implemented as local archive/hide only. It does not send a forged customer-side resolve/close event to the support agent.
- Agent-side resolved/closed status is persisted in Dexie and no longer downgrades to `open` if the original ticket event is replayed after restart.
- Unread counts are calculated from support-agent messages newer than each ticket's `readAt`; customer messages do not count as unread.
- The global support watcher suppresses toasts during initial cache/relay hydration, then shows a toast only for newly observed support-agent replies.
- Opening a ticket still marks it read through the support use case, clearing the global badge path.
- Support history cards no longer display a status badge or right chevron. The title row shows the compact date (`M.D`), resolved/closed tickets show terminal copy in the preview line, and the card action menu exposes pin/unpin, read, and leave.
- Pinned tickets show a pin icon next to the compact date. The three-dot action button is vertically centered and larger, the menu closes on outside click or Escape, and unread counts are rendered as an overlay badge instead of reserving separate card space.
- Support-agent conversation bubbles now render like a messenger thread with the Zappi logo avatar and `Zappi team` label; customer messages remain right-aligned.
- The support page bottom padding was reduced from `pb-28` to `pb-6` because this full-screen settings overlay does not need to reserve bottom-tab space.
- Support page cards, forms, inputs, menus, attachment controls, and message bubbles now use the same `rounded-card` radius as the app's registration buttons; numeric unread badges keep the existing rounded badge shape.
- Pinning, marking read, and leaving are implemented through protocol-neutral support use case methods backed by the support adapter/history store. No UI code mutates Dexie directly.
- Verification passed: focused support tests (4 files / 16 tests), support notification hook tests (3 tests), `npx tsc --noEmit`, `bun run lint`, `node .claude/skills/hex-review/scripts/check-hex-violations.mjs src`, `bun run test -- --run` (89 files / 649 tests), `bun run build`, and `git diff --check`. Build still emits the existing Vite dynamic-import/chunk-size warnings.
- Manual audit found no new hardcoded support agent/relay/secret values, no unsafe HTML rendering, no hack/workaround markers in touched support paths, and no core/adapter hex-boundary violation in touched paths. The remaining sensitive-word matches are existing support privacy copy warning users not to enter private keys/recovery words.
- Skill discovery confirmed wallet-local `hex-review` exists and root `verify-implementation` exists under `../.claude/skills`; wallet-local `verify-*` skills still do not exist.

# Previous Task — Customer Support UX, Sync, and Attachments

- [x] Remove customer-facing technical relay wording from support loading/sending states
- [x] Treat resolved/closed support tickets as terminal in the core support flow, not only in the UI
- [x] Show a terminal conversation notice after a ticket is resolved or closed and disable follow-up sends
- [x] Add real support file attachment send/download support with encryption, hash verification, and configured Blossom storage
- [x] Make support synchronization explicit on connect, focus/online resume, and manual refresh-capable use case seams
- [x] Update focused tests for terminal-ticket behavior, attachment metadata/download, config validation, and sync refresh
- [x] Re-run hex-review, lint, typecheck, focused tests, full tests/build, and `git diff --check`

Review
- Support loading state no longer renders the "relay" connection notice in the customer UI. Submit copy now says `문의 등록 중입니다.` and reply copy says `메시지를 보내는 중입니다.`.
- Follow-up QA fixed the submit loading state to render a spinner next to `문의 등록 중입니다.`.
- Follow-up QA fixed restart inbox hydration: the support adapter now derives the customer support pubkey and restores Dexie-cached tickets/messages before waiting for the SDK network connection, so the local 문의 내역 appears immediately and relay sync updates it afterward.
- Resolved/closed tickets are now terminal at both layers: `SupportService` blocks customer follow-up before calling the channel, and `NostrCsCustomerSupportAdapter` also refuses to send if the current ticket status is resolved or closed. The conversation UI replaces the input with `문의가 해결되었습니다.` or `문의가 종료되었습니다.`.
- Attachment support is now actual file transfer, not metadata-only UI. The wallet converts selected files to protocol-neutral attachment inputs, encrypts them with AES-GCM, uploads ciphertext to configured Blossom storage, sends the validated `nostr-cs` envelope attachment, downloads ciphertext by Blossom hint, decrypts it, and verifies both ciphertext/plaintext hashes before saving.
- Blossom storage is configured via `VITE_ZAPPI_SUPPORT_BLOSSOM_SERVERS`; no code fallback server was added. Local QA `.env.local` was updated with `https://blossom.primal.net`.
- Support sync is explicit on initial connect and on online/visible resume. The refresh seam reconnects the SDK so relay subscriptions can backfill history/status while Dexie remains only a local display cache.
- Verification passed: focused support tests, `npx tsc --noEmit`, `bun run lint`, `node .claude/skills/hex-review/scripts/check-hex-violations.mjs src`, `bun run test -- --run` (88 files / 645 tests after follow-up), `bun run build`, and `git diff --check`. Build still emits the existing Vite dynamic-import/chunk-size warnings.

# Previous Task — Customer Support via nostr-cs

- [x] Re-read root `CLAUDE.md`, root `AGENTS.md`, wallet `AGENTS.md`, and `tasks/lessons.md`
- [x] Create a fresh dedicated branch from latest `origin/staging`
- [x] Confirm stale pre-release CS implementation is only in stash and will not be applied
- [x] Design the CS integration around `nostr-cs@0.0.4`, a dedicated derived customer-support key, and env-provided support agent config
- [x] Validate the design with specialist agents before implementation
- [x] Add protocol-neutral core support use case and isolate `nostr-cs` in an adapter/composition layer
- [x] Add a settings/support UI entry and customer ticket/message flow
- [x] Add focused tests for key isolation, config validation, and support use-case behavior
- [x] Run `hex-review`, verify skill discovery, manual architecture/security scans, lint, typecheck, tests, build, and `git diff --check`
- [x] Document final review results here before treating the work as complete

Review
- Active branch is `feat/customer-support-nostr-cs-sdk-0.0.4`, created from latest `origin/staging`.
- The old pre-release CS attempt remains only in `stash@{0}` and must not be applied; implementation started from current code and the released `nostr-cs@0.0.4`.
- Support agent/relay config is deploy-time public config, not source-code constants. The support agent is configured as `VITE_ZAPPI_SUPPORT_AGENT_NPUB` and must be `npub`; raw 64-hex input is rejected to avoid accidentally publishing private-key-shaped values in a public `VITE_` variable.
- The SDK-side hardcoded discovery concern was fixed upstream in `nostr-cs@0.0.4`; wallet integration injects an explicit configured NIP-66 relay index so SDK default monitor relays are not used. The SDK pool is not shared because the current dependency tree has separate `nostr-tools` instances, and importing nested package internals would be a brittle workaround.
- Core support types/ports/services are protocol-neutral. `nostr-cs` imports are isolated under `src/adapters/customer-support`, with composition as the only boundary-crossing wiring layer.
- Settings now exposes Profile → Customer Support. The first scope supports connect, pull own history, create ticket, list tickets/messages, and send follow-up messages. Ticket metadata is kept in memory for this first scope; no support private key/seed is stored in Zustand, Dexie, localStorage, settings, or env.
- The CS identity is derived from the unlocked wallet seed using a dedicated support-only path and kept in adapter memory only. Logout now calls the support use case `destroy()` path, which disconnects and zeroizes the long-lived support private key; derivation `HDKey` private material and per-call NIP-44 conversation keys are also wiped after use.
- Inbound support events are not trusted just because the SDK emitted them. Tickets must match the local CS pubkey and configured support agent pubkey; replies, DMs, and status updates must come from the configured support agent or local customer identity and must match a known ticket thread before UI state is mutated.
- Final specialist audit reported no blockers and no non-blocking findings after the security fixes. `hex-review` passed with 0 violations; manual scans found no nested `node_modules` imports, no support-specific storage of secrets, no unsafe HTML rendering, no hardcoded support agent/relay values, and no hex-boundary violations.
- Verification passed: focused support tests, focused Send input regression tests, `bun run lint`, `npx tsc --noEmit`, `bun run test -- --run` (87 files / 636 tests), `bun run build`, `node .claude/skills/hex-review/scripts/check-hex-violations.mjs src`, and `git diff --check`.
- Manual QA found a dev-time support connection race: if `disconnect()` runs while `connect()` is still awaiting the SDK, `this.client` can become `null` before listener attachment. `NostrCsCustomerSupportAdapter` now uses a connection generation guard and local client/pool references, and a regression test covers the disconnect-wins-connect race.
- Manual QA also found the initial support UI too form-like and exposed low-value category/priority choices. The page was simplified to a customer-support inbox pattern: title/body only, privacy reminder, card-based request list, selected conversation thread, clearer status pills, and relay-send progress copy.
- Replies from the `nostr-cs` example agent arrived as raw envelope JSON (`{"v":1,"text":...}`). The adapter now sends with `encodeEnvelope()` and displays incoming ticket/reply/DM bodies through `decodeEnvelope()`, while retaining plain-text fallback compatibility.
- Follow-up UX review restored SDK-required category/priority selection in the compose step, but moved it out of the entry screen. The support page is now "Support history" first: token-paste-style top-right "contact us" action → card-style request list with Zappi logo/date/title/status/unread reply badge → dedicated compose/conversation screens, so the first screen no longer mixes a form with existing requests.
- Support history is now cached in Dexie under a customer-support-specific history store scoped by the derived CS pubkey and configured support agent. Relays remain the protocol source of truth, but restart/offline UX can show the local inbox cache first and then refresh from `pullOwnHistory()`. The cache also stores read state for unread support-reply badges.
- `nostr-cs` envelope attachments are not treated as fully implemented file transfer yet. The wallet now preserves and displays validated attachment metadata from `decodeEnvelope()`, but actual upload/download/decrypt/sha256 verification remains a separate Blossom-backed implementation step.
- Verify-skill discovery: `zappi-wallet/.claude/skills` has no `verify-*` skill. The root `../.claude/skills/verify-implementation/SKILL.md` exists but still references missing `verify-ecash`, matching the existing `.pipeline/verify-implementation-report.md`; therefore the authored verify pipeline cannot be executed until that missing skill is restored or removed.
# Current Task — Header Typography Unification

- [x] Use the Token tab `이캐시` title typography (`text-heading font-bold`) for other screen headers
- [x] Preserve existing header layout/positioning; only the title text style changes
- [x] Remove duplicate safe-area offset from floating bottom navigation and Token toolbar
- [x] Apply ZAP-266 current-month per-day timeline grouping to Token and History timelines
- [x] Verify lint/typecheck/test/build before completion

Plan
- Do not convert centered navigation headers into Token tab's left-aligned tab header. Back buttons and right actions should stay where they are.
- Update common header components first, then screen-local full-screen headers that do not go through the shared component.
- Add truncation/padding only to centered absolute titles so the larger typography cannot overlap header actions.

Review
- Screen headers now use the Token tab title typography (`text-heading font-bold text-foreground`) while preserving their existing left/center/right layout.
- Centered absolute headers keep action-safe horizontal padding and truncation so longer localized titles do not overlap back/action buttons.
- Modal/body section titles were intentionally left alone; this pass only targets screen-level headers and full-screen scanner/processing headers.
- Home itself did not have bottom `pb-safe`; the visible bottom gap came from floating nav/toolbars adding `env(safe-area-inset-bottom)` to their `bottom` position. Both now use the same fixed 4px bottom offset.
- ZAP-266 grouping now splits current-month items after yesterday into `dayThisMonth` day groups, while prior months in the current year remain monthly groups. Token and History rows both show `HH:MM` for those day groups.
- Date boundaries are computed from local calendar day starts (`new Date(Y, M, D)` and `new Date(Y, M, D - 1)`), not fixed 24h subtraction, so yesterday still starts correctly across DST transitions.
- History keeps virtualization for long lists, but now positions virtualized date groups with `top` instead of `transform` and matches the Token tab group wrapper, so sticky date anchors start at the same row boundary.
- History date groups include measured bottom spacing between groups so a newly changing date is visually separated from the previous day's last row while keeping virtualization accurate.
- Verification passed: `bun run lint`, `npx tsc --noEmit`, `bun run test`, `bun run build`, `node .claude/skills/hex-review/scripts/check-hex-violations.mjs src`, and `git diff --check`.

# Current Task — History Timeline Polish + PWA Update Check

- [x] Change non-CJK timeline month anchors from long month names to localized short month names
- [x] Add a manual PWA update check entry point in Settings without auto-installing updates
- [x] Verify lint/typecheck/test/build before completion

Plan
- Keep Korean/Japanese/Chinese month anchors as numeric month labels, and use `Intl.DateTimeFormat(..., { month: 'short' })` only for languages that previously rendered long month names.
- Place manual update check near the app version/logout area in Settings, matching OS-style app maintenance placement rather than mixing it into wallet settings categories.
- Manual check must not call `updateSW()` directly. It should only detect a waiting service worker, mark `updateAvailable`, and let the existing explicit update action install the new version.

Review
- History and Token timeline month anchors now use localized short month names for non-CJK languages (`Mar`, `dic`, `Des`, etc.), while Korean/Japanese/Chinese keep the numeric month format.
- Settings now has a manual `업데이트 확인` action in the app maintenance/version area. The button checks the registered service worker and shows a spinner while checking.
- Manual update check does not immediately install or reload. If an update is found, it only marks `updateAvailable`; Settings then replaces the check button with one explicit `새 업데이트가 있습니다` install action in the same app maintenance area.
- The old top-of-settings update banner was removed so manual check, update-available state, and update install action all live in one consistent location.
- Verification passed: `bun run lint`, `npx tsc --noEmit`, `bun run test`, `bun run build`, `node .claude/skills/hex-review/scripts/check-hex-violations.mjs src`, and `git diff --check`.

# Current Task — History Timeline Design

- [x] Reproduce and fix current `bun run lint` hook dependency warnings before UI work
- [x] Compare Token tab timeline design with current History transaction list structure
- [x] Add a History-specific timeline card row that reuses existing transaction title/subtitle/amount semantics
- [x] Rework History screen grouping to use the Token tab date-anchor visual language while preserving filters, mint names, export, and transaction detail navigation
- [x] Align transaction wording with the eCash terminology pass and make history icons represent money direction rather than protocol
- [x] Verify lint/build/typecheck and document remaining build-only bundle warnings separately

Plan
- Do not copy Token row semantics directly. Token history has token-specific states (`registered`, `consumed`, `reclaimed`), while wallet history must preserve Lightning/eCash/swap titles, sources, mint routes, pending/failed styling, and fiat snapshots.
- Use the existing `groupTransactionsForTimeline` date grouping helper so History and Token share the same date grouping model.
- Keep virtualization at the group level to avoid replacing the current scalable list with a fully unvirtualized list.
- Keep all changes in UI/hooks only; no domain, service, adapter, or storage behavior should change for this design update.

Review
- The original two ESLint warnings in `SendInputStep.tsx` were fixed by correcting hook dependency arrays; `bun run lint` now reports no warnings.
- `HistoryTimelineRow` was added as a history-specific card row instead of reusing the token row directly, so wallet-history semantics still preserve Lightning/eCash/swap titles, source/destination details, amount signs, fiat snapshots, pending/failed indicators, and linked swap route metadata.
- `HistoryScreen` now renders filtered transactions through `groupTransactionsForTimeline`, using a Token-tab-style left date anchor with right-side rounded transaction cards. Filters, search, mint filtering, export, and transaction detail navigation remain wired to the existing History screen state.
- Transaction wording now prioritizes the money action: `수신 (라이트닝)`, `전송 (라이트닝)`, `수신 (이캐시)`, `전송 (이캐시)`, with Cashu-token lifecycle entries shown as `생성 (이캐시)`, `등록 (이캐시)`, and `되찾기 (이캐시)`. These labels flow through Home and Mint Detail transaction lists because they share `transactionHelpers`.
- Transaction rows now put date/time first in subtitles, omit the repeated type label when the title is already the same label, and keep route/source/destination context after the date/time for metadata-rich rows.
- History timeline icons now represent direction/action: receive arrow, send arrow, swap, and reclaim. Normal icon color follows the displayed amount sign (`+` uses primary, `-` uses foreground), while pending/failed states keep their status colors. Lightning/eCash protocol is kept in text only to avoid confusing the primary money movement.
- Tab screens no longer reserve large blank bottom padding; the fixed bottom navigation/Token toolbar owns the safe-area offset, while Home/Token/Contacts/Settings content keeps only minimal end padding.
- Verification passed: `npx tsc --noEmit`, `bun run lint`, focused timeline tests (`29` tests), `bun run build`, `node .claude/skills/hex-review/scripts/check-hex-violations.mjs src`, `git diff --check`, and manual hack/hardcoding/unsafe-HTML search in touched UI paths.
- Build still emits pre-existing Vite bundle warnings about mixed dynamic/static imports and large chunks. Those are bundling optimization issues and were not mixed into this UI design patch.

# Current Task — ZAP-81

- [x] Confirm wallet repo rules (`CLAUDE.md`, root `AGENTS.md`, `zappi-wallet/AGENTS.md`) and review `tasks/lessons.md`
- [x] Re-check current branch / worktree status and session diff
- [x] Commit ZAP-52/ZAP-253 follow-up work (`f6273ab`, `fix: harden incoming review resolution`)
- [x] Commit ZAP-235 follow-up work (`8d22262`, `fix: prevent duplicate mint names`)
- [x] Commit ZAP-44 follow-up work (`a97cb52`, `feat: support mint and relay ordering`)
- [x] Commit ZAP-233 follow-up work (`069acb1`, `feat: allow force deleting mints`)
- [x] Re-prioritize remaining `월렛 알파 준비` issues again and pick the next concrete item (`ZAP-81`)
- [x] Inspect `SwapService` drain retry flow and confirm where abandoned mint quotes remain pending in Coco
- [x] Add a swap-quote cleanup hook so composition can abandon orphan target quotes through the Cashu layer
- [x] Update drain retry flow to abandon replaced quotes and cancel their receive-completion waits before re-quoting
- [x] Cover both successful drain retry cleanup and early drain budget failure cleanup with focused regression tests
- [x] Run targeted validation for ZAP-81 changes
- [x] Re-plan the ZAP-81 corrective rework after the rule review flagged the old `'ISSUED'` workaround as non-root-cause
- [x] Re-audit the corrected implementation against `CLAUDE.md`, root `AGENTS.md`, wallet `AGENTS.md`, and `tasks/lessons.md`
- [x] Re-run full wallet verification before moving on: `bun run lint`, `bun run build`, `bun run test`, `npx tsc --noEmit`, `git diff --check`, and `verify-*` status check

Review
- Current implementation branch is `fix/zap-81-drain-quote-cleanup`, stacked on top of committed ZAP-233 work from `fix/zap-233-force-delete-mint`.
- `ZAP-81` is the next low-risk wallet-alpha cleanup item because the issue is tightly scoped to drain retry behavior inside `SwapService`, and the existing `SwapQuoteMarker` port already provided the correct composition seam.
- The root problem was that drain mode only called `unmark()` when replacing the first receive quote, so Coco still kept the old mint quote and mint operation pending until invoice expiry.
- `SwapQuoteMarker` still provides `abandon(accountId, quoteId)`, but the Cashu composition now maps that to an atomic Coco cleanup helper that directly deletes the abandoned mint quote row and its linked mint operations instead of overloading the quote state with `ISSUED`.
- `SwapService` now treats cleanup as part of the drain retry contract: it abandons the superseded quote before creating a replacement quote, cancels the stale `onReceiveCompleted` subscription/timeout, and fails fast if cleanup cannot complete.
- Early drain-budget exits preserve their original failure reason and append cleanup detail only when abandonment itself fails, so the retry path no longer hides the underlying balance/drain cause.
- Quote cleanup tracking is now quote-scoped, so if a later replacement quote fails before `executeSend`, the newest quote is still cleaned up rather than being left marked/pending.
- Full verification is now documented per `tasks/lessons.md`: `bun run lint`, `bun run build`, `bun run test`, `npx tsc --noEmit`, rule audit against `CLAUDE.md` + both `AGENTS.md` files + `tasks/lessons.md`, `git diff --check`, and `verify-*` status check (`rg --files | rg '(^|/)verify-'` returned no matches in this workspace).
- Design and review were both re-run with specialist agents after the rework; the final rule-audit review found no remaining rule violations in the touched files.
- Full build passed after fixing a `swap.service.test.ts` mock typing regression caught by `tsc -b`; build still emits the existing Vite chunk-size warnings, but no new build failures were introduced by the ZAP-81 changes.
- Next likely investigation track remains `ZAP-238`, unless fresh local repro points to a more urgent wallet-alpha blocker.

# Current Task — ZAP-238

- [x] Freeze new implementation until the prior ZAP-81 rule audit is fully rerun and documented
- [x] Re-read Linear `ZAP-238` scope and inspect the current pending-recovery paths (`App.tsx`, `MainApp.tsx`, `payment.service.ts`, `cashu-recovery.ts`, `coco-sdk.ts`)
- [x] Confirm the likely bottleneck order: stale pending quote cleanup first, queue separation only if delay remains after cleanup
- [x] Align onboarding recovery wiring with the active-mint filtering already used by the normal Cashu backend path
- [x] Replace mint-quote recovery expiry handling so it prefers real `expiresAt`, keeps the 24h fallback only for legacy records, and reports `expired` separately from `failed`
- [x] Add regression coverage for inactive/deleted mint filtering, real-expiry cleanup, legacy fallback expiry, and onboarding recovery wiring
- [x] Run focused verification for ZAP-238 changes and then a separate review-agent pass before calling it done

Review
- `composition/recover-pending-quotes.ts` now forwards an authoritative mint list from onboarding recovery, so the pre-bootstrap recovery path matches the active-mint filtering already used by the normal Cashu backend flow.
- `cashu-recovery.ts` now distinguishes `activeMintUrls === undefined` from an explicit `[]`, treats `expiresAt` as the primary expiry signal, keeps the 24h age fallback only for legacy records without expiry metadata, and reports `expired` separately from `failed` while still moving expired transactions out of pending.
- `create-cashu-backend.ts` is covered by a dedicated unit test so the `undefined` vs `[]` semantics stay locked at the factory seam.
- Queue separation remains intentionally out of scope for this patch; the current fix addresses stale pending quote cleanup first, and unlock/resume contention should only be split further if it still reproduces after this change lands.
- Validation rerun for this patch: targeted recovery/composition/backend tests, `bun run test` (67 files / 503 tests), `bun run build`, `npx tsc --noEmit`, code-file `bun run lint -- ...`, and `git diff --check`.

# Current Task — Wallet Alpha QA Follow-up

- [x] Reconfirm rules and current branch/worktree before touching QA fixes
- [x] Fix cross-mint token receive so failed swaps only claim/add a source mint when funds actually landed there
- [x] Fix swap transaction row subtitles so they never show an empty or dangling mint route
- [x] Keep BIP-321 request receive classification as-is if Lightning was the actual paid rail, and document that expectation
- [x] Replace mint/relay ordering controls with a production-grade reorder interaction: visible drag handle plus keyboard/button fallback
- [x] Add focused regression coverage for the above behavior
- [x] Rework QA feedback after manual testing: remove duplicate swap-failure toast, stop implicit source-mint additions, and replace misleading recovery copy
- [x] Fix review-blocker: keep Coco receive/redeem trust operation-scoped for source mints outside user settings, and only persist trust after explicit mint-add action
- [x] Remove the old visible up/down reorder buttons while preserving keyboard reordering on the drag handle
- [x] Simplify unknown-mint token receive UX to only allow explicit mint add-and-receive or reject, removing receive-to-my-mint swap from that branch
- [x] Run verification and a final rule audit before considering the QA follow-up complete
- [x] Reflect completed manual QA confirmation in `tasks/phase6-7-qa-checklist.md`

Review
- QA item 1 was a display fallback bug: swap rows with incomplete metadata could render a dangling `source mint →` route. `TransactionRow` now only renders `from → to` when both mints are known and otherwise falls back to the swap label.
- Swap transaction rows now use the same `source mint → target mint` title for both the source-side send transaction and the target-side receive transaction; the subtitle carries the generic swap type.
- Source-side swap rows were still falling back to `swap` after settlement because fee updates replaced transaction metadata and dropped `fromMintUrl/toMintUrl`. `DexieTransactionRepository.update()` now merges metadata, and rows can recover route metadata from the linked counterpart for already-written transactions.
- QA item 2 is expected behavior: the generated BIP-321 request exposes both Lightning and eCash options, so if Cashume pays the Lightning invoice, the wallet should record it as a Lightning receive.
- QA item 3 was simplified at the product level: unknown-mint token receive no longer offers `receive to my mint` swap, because the convenience path creates confusing failure/recovery states for tiny tokens and can turn a simple reject/add decision into an already-redeemed recovery problem. Unknown-mint tokens now only offer explicit mint add-and-receive or reject. The lower-level cross-mint token swap path remains for already-configured mints.
- Coco's direct receive fee shortfall (`Receive amount is not sufficient after fees`) is now classified as `REDEEM_FEE_TOO_HIGH` at the Cashu boundary, preserved by `PaymentService`, and translated by Receive UI instead of leaking raw SDK English.
- Registered-mint token confirmation now exposes only `original mint receive` or `do not receive` before redeeming. Unconfigured mint tokens expose `add mint and receive` or `do not receive`; both paths use the same reject wording.
- `SwapService.estimateSwap()` now abandons its temporary target quote after fee estimation, including failure cleanup, so the new preflight path does not reintroduce stale quote debt.
- Swap route estimation failures now use `SWAP_ESTIMATE_FAILED` instead of pretending every estimate failure is a fee-too-high case.
- Coco receive/redeem still uses the trust state Coco requires internally, but now scopes that trust to the operation when the token source mint is outside `settings.mints`; the source mint is restored to untrusted state after estimate/redeem and only becomes persistent trusted state through explicit user mint-add confirmation.
- QA item 4 now uses a visible drag handle for mint/relay ordering. The original up/down buttons were removed; keyboard users can focus the handle and use the up/down arrow keys. Save failures roll back the local order and show an error toast.
- Focused verification passed after the QA rework: `bun run test:run` for swap receive, unknown-mint receive UI, event-store bridge, receive-flow swap recovery, and mint/relay settings tests.
- Full verification passed after the final QA rework: `bun run lint`, `npx tsc --noEmit`, `bun run test -- --run` (72 files / 548 tests), `bun run build`, and `git diff --check`. Build still emits the existing Vite chunk/dynamic import warnings.
- Final specialist review found three completion blockers and they were fixed before this task was treated as complete: source-mint trust restoration failures now fail loudly instead of being logged as best-effort cleanup, swap estimate quote cleanup keeps/report its quote id until abandonment succeeds, and the new Cashu internal tests were moved inside `src/modules/cashu/internal` so the new tests no longer import `internal/` from outside.
- Final rule audit included untracked new files, architecture import-boundary searches, sensitive-term searches, hack/workaround searches, `.js` import-extension checks, and `verify-*` discovery. `verify-*` files remain absent in this workspace.

# Current Task — External Mnemonic Recovery Discovery

- [x] Add a hex-safe design for restoring another mnemonic's eCash without changing the current wallet seed
- [x] Discover candidate mints from the external mnemonic's public `kind:10019` profile and encrypted `kind:30078 d=mint-list` backup
- [x] Keep Cashu scanning isolated in the existing Cashu recovery adapter and keep Nostr discovery isolated in a Nostr adapter
- [x] Scan the union of current wallet mints and discovered mints, then redeem only into the current wallet
- [x] Return recovered mint URLs from the use case so the UI can persist only successful new mints
- [x] Verify no UI imports adapters/modules and no core service imports external SDKs

Design notes
- The current wallet seed must never be replaced during this flow. The external mnemonic is only used as a recovery source to derive old deterministic Cashu proofs and old mint-list discovery keys.
- `kind:10019` is a public receiving profile. It can suggest active public mints, but it is not a complete wallet backup.
- `kind:30078` with `d=mint-list` is the encrypted mint-list backup used by Cashu.me/Macadamia style wallets. It is queried through a driven Nostr port and decrypted in an adapter.
- Discovered mints are candidates only. A mint is added to the visible wallet settings only after the recovery scan finds spendable proofs and the current wallet successfully redeems them.
- The UI may orchestrate settings persistence, but it must only call driving ports and app settings callbacks. It must not parse Nostr events, decrypt backups, or call Cashu SDKs.

Review
- Added `ExternalMnemonicMintDiscoveryPort` and a Nostr adapter that derives Cashu.me/Macadamia-compatible mint-backup keys from the external mnemonic, queries public receiving mints and encrypted mint-list backups, and returns normalized candidate mint URLs.
- `ExternalWalletRecoveryService.recoverFromMnemonic()` now scans the union of current configured mints and discovered candidate mints, then returns only successfully redeemed mint URLs. It does not change the active wallet seed.
- `SettingsScreen` calls the external-wallet recovery use case; recovered new mint URLs are persisted through the settings/trust port only after successful redemption, so a discovered-but-empty mint is not added to the visible wallet.
- Cashu restore scanning remains isolated in `modules/cashu/internal/external-mnemonic-recovery.ts`; Nostr discovery/decryption remains isolated in `adapters/nostr/external-mnemonic-mint-discovery.adapter.ts`; UI does not import adapters/modules/composition.
- Build was initially blocked by a pre-existing strict build type issue in `gift-wrap-token`; it was fixed with an explicit direct-token rumor type guard.
- Verification passed: `bun run lint`, `npx tsc --noEmit`, `bun run test` (95 files / 695 tests), `bun run build`, `git diff --check`, and manual touched-file hex-boundary import scans.

# Current Task — Send/Recovery Architecture Hardening

- [x] Move npub/nprofile direct-payment validation out of UI helpers and into a core driving use case
- [x] Replace legacy composition route execution with a core service that depends on driven ports
- [x] Move external mnemonic recovery orchestration out of `PaymentService`
- [x] Let the recovery use case persist only successfully recovered mints through a trust/settings port
- [x] Verify each step with focused tests before moving to the next step
- [x] Run final lint, typecheck, test, build, diff, and hex-boundary checks

Design notes
- `npub` send validation should be reusable by manual send, contacts, and future chat payments. UI should only call `ServiceRegistry.nostrDirectPayment`.
- Route execution should no longer be a composition helper that directly reaches into Cashu primitives, Dexie, HTTP transport, and cross-tab sync. Core should own orchestration; adapters/modules should own SDK/network/storage details behind ports.
- External mnemonic recovery should be a wallet-recovery use case, not a payment-service responsibility. The current wallet seed must remain unchanged.

Review
- `NostrDirectPaymentService` now owns npub/nprofile direct-payment resolution behind `ServiceRegistry.nostrDirectPayment`. Manual send and address-book send both call the same driving use case; the old UI helper was removed.
- `RouteExecutionService` now owns route execution orchestration in core. Cashu operations, pending-route storage, token delivery, and cross-tab sync are injected through driven ports/adapters instead of being reached from a composition helper.
- External mnemonic recovery orchestration was removed from `PaymentService` and moved to `ExternalWalletRecoveryService`. Recovered tokens are redeemed through the current wallet via a `RecoveredTokenReceiver` port, not by mutating the active wallet seed.
- Successfully recovered mint URLs are persisted through `TrustedAccountStore` backed by settings; discovered-only or failed mints are not added.
- Build initially caught a strict backend/port mismatch for melt execution. The port was corrected to use the prepared melt amount and not require a nonexistent backend `amount` field.
- Verification passed: focused tests for direct npub send/route execution/external recovery/bootstrap, `bun run lint`, `npx tsc --noEmit`, `bun run test` (97 files / 694 tests), `bun run build`, `node .claude/skills/hex-review/scripts/check-hex-violations.mjs src` (571 files, 0 violations), `git diff --check`, and manual boundary/security/hardcoding scans.

# Zappi Wallet — Design Overhaul

Design Principles: 신뢰 · 세련 · 편안
References: Toss + Apple Wallet

## Phase 1: Normalize (일관성) ✅
- [x] ScreenHeader: aria-label i18n
- [x] bg-black/[0.04] → bg-foreground/[0.04] (4 files)
- [x] aria-label "Back"/"Close" 하드코딩 → i18n
- [x] bounce-slow → float-slow (smooth easing)

## Phase 2: Arrange (Home 위계) ✅
- [x] 잔액 영역 — "Total" 라벨 축소, 숫자 주인공, baseline 정렬
- [x] 카루셀 간격 축소 (pt-10 pb-8 → pt-6 pb-6)
- [x] 액션 버튼 그림자 정리

## Phase 3: Distill (Settings 구조) ✅
- [x] PIN 변경: 모달 → 풀스크린 페이지 전환
- [x] auto-submit useEffect로 수정
- [x] LockScreen PIN dots transition 추가

## Phase 4: Delight + Animate ✅
- [x] SendCompleteStep: confetti 추가
- [x] ReceiveCompleteStep: spring 이미지 모션 + confetti 추가

## Phase 5: 전체 디자인 감사 ✅
- [x] strokeWidth 통일 (2 → 1.8, 차트 제외)
- [x] 터치 타겟 < 44px 수정 (MintMgmt, RelayMgmt, AddMint)
- [x] active:scale-90 → 95 (5 files)
- [x] active:scale-[0.97] → [0.98] (3 files)
- [x] 모든 화면 헤더 패턴 통일 (ScreenHeader 기준: px-5, h-14, w-10 h-10 back button, text-subtitle title)
  - [x] SettingsScreen
  - [x] SettingsDetailPage (Language, Fiat, AutoLock 등)
  - [x] HistoryScreen
  - [x] TransferScreen
  - [x] PendingItemsScreen
  - [x] MintManagementScreen
  - [x] RelayManagementScreen
  - [x] AddMintScreen
  - [x] AnalyticsScreen
  - [x] NotificationsScreen
  - [x] UsernameChangeScreen
  - [x] OnboardingScreen (mnemonic + pin steps)
- [x] 타이포 적절성 검사
  - [x] AnalyticsScreen: text-body → text-subtitle, text-overline → text-label
  - [x] NotificationsScreen: text-body → text-subtitle, text-label → text-body
  - [x] MintDetailScreen: text-label → text-caption (section headings)

## Onboarding 개선 ✅
- [x] "지갑 복구" 밑줄 텍스트 → outline 버튼
- [x] Mnemonic 워드 그리드: 가로 순서 → 세로 순서 (grid-flow-col)

## 남은 작업
- [ ] 투명도 표기 통일 (/[0.1] → /10 등)
- [ ] border-radius 정리 (후순위)
- [ ] 그림자 패턴 정리 (후순위)
- [ ] Phase 5 최종 Polish

# Current Task — ZAP-173

- [x] Re-read root `CLAUDE.md`, root `AGENTS.md`, wallet `AGENTS.md`, and `tasks/lessons.md`
- [x] Re-read Linear `ZAP-173` and confirm the current code only has a single ReceiveRequest status model
- [x] Create dedicated branch `fix/zap-173-receive-request-lifecycle` from clean `staging`
- [x] Ask specialist agents for implementation design and security/hexagonal-rule risk review before coding
- [x] Replace single ReceiveRequest status with domain-level `fulfillmentStatus` and per-method `status`
- [x] Add pure domain transitions: fulfill by method, expire method/request, cancel request, receive additional method
- [x] Update receive request ports/services/repository so state transitions go through the domain, not UI/store/Dexie shortcuts
- [x] Preserve legacy Dexie compatibility while making `paymentMethods` the canonical persisted method state
- [x] Stop `PaymentService.receive()` from creating premature pending receive transactions
- [x] Normalize ReceiveRequest lifecycle method identifiers to `bolt11` / `ecash` while preserving BIP-321 `lightning` URI naming
- [x] Hide fulfilled ReceiveRequests from pending UI without deleting method state or cancelling transactions
- [x] Cover duplicate settlement, additional-method settlement, expiry, legacy mapping, and no-premature-TX behavior with tests
- [x] Run full verification: focused tests, `bun run lint`, `npx tsc --noEmit`, `bun run test -- --run`, `bun run build`, and `git diff --check`
- [x] Run final specialist audit and only complete Linear if no security, rule, hardcoding, workaround, or hexagonal-boundary issue remains

Review
- ZAP-173 must not be solved by setting `status = completed` and hiding symptoms. The root fix is a domain lifecycle split: request fulfillment is UI-level completion, method status tracks each payment method independently.
- Core must stay pure/inward-only; Dexie, Coco, Zustand, i18n, and UI logic remain outside the hexagon.
- Transaction deletion/cancellation is not the primary fix. Fulfilled requests are hidden by ReceiveRequest fulfillment state while method state is retained for duplicate/additional settlement handling.
- Implementation now stores canonical `paymentMethods` with method-level status in Dexie while still reading legacy flat records (`status`, `quoteId`, `ecashRequestId`, `completedMethod`).
- `EventStoreBridge` no longer performs raw Dexie ReceiveRequest lifecycle writes; it forwards settlement signals to `ReceiveRequestUseCase.settleByPaymentRef`.
- `PaymentService.receive()` no longer writes pending receive transactions before settlement. Actual receive transactions continue to be recorded by settlement paths.
- Trusted gift-wrap receive now records ReceiveRequest lifecycle before marking the event processed. If redeem succeeds but lifecycle persistence fails, the failed-incoming queue keeps the ReceiveRequest ref/method so recovery can retry the lifecycle write without re-redeeming an already-spent token.
- Receive QR creation now persists the canonical ReceiveRequest before adding the legacy pending quote or showing a payable QR. If persistence fails, the flow shows an error and does not expose the request.
- Verification passed: focused ZAP-173 tests, `bun run test -- --run` (78 files / 577 tests), `bun run lint`, `npx tsc --noEmit`, `bun run build`, and `git diff --check`.
- Final specialist audit found no blockers and no security, rule, hexagonal-boundary, hardcoding, or workaround violations. The audit included untracked new files, `verify-*` discovery, core import-boundary search, raw ReceiveRequest Dexie write search outside the adapter, `modules/cashu/internal` diff additions, TODO/HACK/workaround/hardcoding/sensitive diff search, and `tasks/lessons.md` review.

# Current Task — Hex Boundary Cleanup

- [x] Create dedicated branch `refactor/hex-boundary-cleanup` from clean `staging`
- [x] Re-read root `CLAUDE.md`, wallet `AGENTS.md`, and `tasks/lessons.md`
- [x] Confirm `hex-review` skill location and execute it via subagent, not inline
- [x] Design a root-cause refactor for all known import-boundary violations, including manual `AGENTS.md` findings
- [x] Validate the design with a specialist agent before implementation
- [x] Remove UI → composition and composition → UI/service violations without `hex-ignore`
- [x] Remove adapter → store, adapter → modules, and adapter → composition violations through ports/dependency injection
- [x] Re-check `modules/cashu/internal` imports and either move tests inside the boundary or route production code through public seams
- [x] Run `hex-review`, manual architecture searches, sensitive/hack/hardcoding searches, lint, typecheck, test, build, and `git diff --check`
- [x] Fix manual-QA token reclaim regressions: observer/UI race false failure and reclaim success toast wording
- [x] Run final specialist audit and only then decide whether the branch is complete

Review
- `hex-review` reports 3 import violations, but they collapse to 2 implementation tasks: `use-cross-tab-sync` imports composition from UI, and `bootstrap` imports `ui/services/balance-cache`.
- Manual `AGENTS.md` review adds stricter adapter-boundary work that the script does not currently check: adapters must not import store, UI, services, or hooks, and should depend inward through core ports or be wired from composition.
- `cross-tab-sync` now lives in `utils/` as a cross-cutting browser primitive, so UI no longer imports composition.
- `balance-cache` now has a core port and localStorage adapter; bootstrap wires the adapter instead of importing a UI service.
- Cashu fee estimation and send-token SDK operations now live under `modules/cashu/adapters` with `cashuBackend` injection. Proof-state checks were also moved behind the backend seam after specialist review. Transaction finalization/reclaim state changes moved into `TransactionMgmtService` using repositories and domain events.
- Runtime adapters no longer import Zustand; bootstrap injects settings/review queue closures.
- `recover-pending-quotes` now routes through `createCashuBackend()` rather than importing Cashu internals, and internal Cashu tests were moved inside `src/modules/cashu/internal`.
- Verification passed: `hex-review`, manual architecture import searches, `bun run lint`, `npx tsc --noEmit`, `bun run test -- --run` (79 files / 582 tests), `bun run build`, and `git diff --check`. After the proof-state seam follow-up, `bun run lint`, `npx tsc --noEmit`, `hex-review`, focused regression tests, manual boundary searches, and `git diff --check` were rerun. Build still emits existing Vite chunk/dynamic import warnings.
- Final specialist reviews reported no blockers and approved the requested scope. One non-blocking backend-injection concern was addressed before this task was considered complete.
- Manual QA found two token reclaim regressions. The detail-screen failure toast was caused by a real observer/UI race: the Coco rollback event could mark the send as reclaimed before the button path recorded the same state. `TransactionMgmtService.reclaimSendToken()` now validates the source tx before any SDK side effect, handles already-reclaimed races idempotently, and does not hide local record failures.
- Token-created screen no longer routes reclaim through `PaymentService.reclaim()`/`payment:completed`; it uses the send-token lifecycle path and shows `{{amount}} 회수 완료`.
- Follow-up audits found and fixed deeper reclaim issues before completion: token-only legacy reclaim now actually reclaims proofs through the Cashu backend receive path before recording history, records the backend net amount/fee/accountId, refuses missing/non-send/non-reclaimable source txs without mutating wallet state, and hides the detail reclaim action after successful/already-reclaimed state.
- Reclaim follow-up verification passed: focused reclaim tests (3 files / 16 tests), `npx tsc --noEmit`, `hex-review`, `bun run lint`, `bun run test -- --run` (81 files / 593 tests), `bun run build`, and `git diff --check`. Build still emits the existing Vite chunk/dynamic import warnings.
- Final specialist audit reported no blockers for the token reclaim path and confirmed no security, hardcoding/workaround, or hex-boundary issues in the touched files.
