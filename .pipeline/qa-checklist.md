---
based_on: .pipeline/plan.md
date: 2026-03-18
branch: alpha (staging...HEAD)
status: pending
---

# QA Checklist: Coco watcher bridge — 결제 감지 위임

## 1. 기본 결제 감지 (Coco bridge)

- [ ] **1-1. Lightning 결제 감지 — 홈 화면에서 수신**
  앱이 홈 화면에 있을 때, 외부 지갑에서 기존에 생성된 인보이스로 결제 전송.
  `[Coco Bridge] Quote redeemed` 콘솔 로그 확인. 성공 토스트(`lightningReceived`)가 1회만 표시되는지 확인.

- [ ] **1-2. Lightning 결제 감지 — 잔액 업데이트**
  1-1 이후 홈 화면 잔액이 결제 금액만큼 증가했는지 확인. `refreshAll` 호출로 balance가 반영되는지.

- [ ] **1-3. 크로스탭 동기화**
  두 탭을 열어놓고 한쪽에서 결제 수신 시, 다른 탭도 `balance_changed` broadcastSync로 잔액이 갱신되는지 확인.

## 2. ReceiveQR 화면에서 결제 수신 — 중복 토스트 방지

- [ ] **2-1. ReceiveQR 활성 상태에서 Lightning 결제 수신**
  ReceiveQR 화면(인보이스 QR 표시 중)에서 외부 결제.
  **두 가지 토스트가 동시에 뜨는지 확인:**
  - `bridge.ts` → `toast.lightningReceived` (Coco watcher)
  - `handlePaymentReceived` → `toast.lightningPaymentComplete` (ReceiveFlow 콜백)
  **현재 구현상 두 토스트가 동시에 뜰 가능성이 높음. 이것이 의도된 동작인지 판단 필요.**
  만약 중복이라면 `handlePaymentReceived`의 Lightning 토스트 제거 또는 bridge 토스트를 조건부로 변경해야 함.

- [ ] **2-2. ReceiveQR → 성공 화면 전환**
  결제 수신 후 ReceiveQRStep이 `onPaymentDetected` → `step: 'complete'`로 정상 전환되는지 확인.
  성공 화면에 수신 금액이 올바르게 표시되는지.

## 3. PendingQuote store 관리

- [ ] **3-1. 인보이스 생성 시 pendingQuotes에 추가**
  `handleCreateInvoice` 호출 후 `useAppStore.getState().pendingQuotes`에 해당 quoteId가 존재하는지. devtools 또는 콘솔에서 확인.

- [ ] **3-2. 결제 완료 시 pendingQuotes에서 제거**
  bridge.ts의 `mint-quote:redeemed` 핸들러에서 `removePendingQuote(event.quoteId)` 호출 후 store에서 제거되었는지 확인.

- [ ] **3-3. 앱 재시작 시 기존 pending quotes 로드**
  결제 대기중인 인보이스가 있는 상태에서 앱 새로고침. `getPendingQuotes()` 결과 중 만료 안 된 것만 store에 로드되는지.
  만료된 quote(expiresAt < now) 또는 24시간 초과 quote가 필터링되는지.

- [ ] **3-4. 동일 quoteId 중복 추가 방지**
  같은 quoteId로 `addPendingQuote` 두 번 호출 시 배열에 1개만 존재하는지. (단위 테스트 `wallet-pending-quotes.test.ts`에서 커버됨 — `vitest run` 확인.)

## 4. 이전 폴링 제거 확인

- [ ] **4-1. subscribeToPendingQuotes 미호출 확인**
  MainApp.tsx에서 `subscribeToPendingQuotes`가 더 이상 호출되지 않는지 코드 검색으로 확인 완료.
  런타임에서 `[WSS]` 접두어 콘솔 로그가 나오지 않는지 확인.

- [ ] **4-2. wsSubscriptionRef 제거 확인**
  `wsSubscriptionRef` 관련 코드가 MainApp.tsx에서 완전히 제거되었는지. cleanup에서 `wsSubscriptionRef.current()` 호출이 없는지.

## 5. 엣지 케이스

- [ ] **5-1. 앱 백그라운드 → 포그라운드 복귀 시 결제 반영**
  인보이스 생성 후 앱을 백그라운드로 보냄 → 외부에서 결제 → 앱 복귀.
  Coco watcher가 백그라운드에서도 이벤트를 수신했는지, 또는 복귀 시 `recoverAll`/`refreshAll`로 잔액이 갱신되는지.

- [ ] **5-2. bridge.ts에서 i18n 접근**
  bridge.ts는 React 컴포넌트 외부. `i18n.t()` 직접 호출이 정상 작동하는지 — 언어 변경 후에도 올바른 번역이 나오는지 실기기 확인.

- [ ] **5-3. 단위 테스트 통과**
  `npx vitest run src/__tests__/unit/store/wallet-pending-quotes.test.ts` — 4개 테스트 모두 통과.

## Known Issue (확인 필요)

**중복 토스트 (항목 2-1):** ReceiveQR 화면 활성 상태에서 결제 수신 시, bridge.ts의 `lightningReceived` 토스트와 `handlePaymentReceived`의 `lightningPaymentComplete` 토스트가 동시에 표시된다. `addToast`에 중복 방지 로직이 없으므로 두 개가 모두 뜬다. ReceiveQR 화면에서는 성공 화면으로 전환되므로 bridge 토스트만으로 충분할 수 있음 — 의도적 설계인지 확인 후 조치.
