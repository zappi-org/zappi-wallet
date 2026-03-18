---
based_on: .pipeline/implement-report.md
date: 2026-03-18
verdict: APPROVE with notes
---

# Review: Coco watcher bridge

## Verdict

APPROVE. 구현이 plan과 일치하며, 핵심 로직에 결함 없음. 아래 notes는 개선 사항이지 blocker가 아님.

## Checklist

### 1. bridge.ts event handler — store 접근

OK. `useAppStore.getState()`로 이벤트 시점의 최신 state를 가져옴. Zustand의 `getState()`는 React 외부에서 사용하도록 설계된 API이므로 정확한 패턴. `setBalance`만 `connectCocoToStore` 시점에 캡처하고, `removePendingQuote`/`addToast`는 이벤트 발생 시점에 `getState()`로 가져오는 혼용이 있지만, `setBalance`는 함수 참조가 불변이라 문제 없음.

### 2. subscribeToPendingQuotes 제거

**완전함.** `src/MainApp.tsx`에서:
- `subscribeToPendingQuotes` 호출 제거
- `wsSubscriptionRef` 선언 + cleanup 제거
- 메서드 자체(`payment.service.ts:1080`)는 plan대로 잔존 (Phase 3 제거 예정)

코드 내 `subscribeToPendingQuotes` 참조는 `payment.service.ts` 메서드 정의 + `.pipeline/` 문서뿐. **dangling 호출 없음.**

### 3. i18n.t() 사용 — bridge.ts에서 안전한가

**안전함.** `i18n`은 i18next 싱글톤 인스턴스이며 `@/i18n/index.ts`에서 모듈 로드 시 `.init()` 완료 후 export. React 컴포넌트 밖에서 `i18n.t()` 직접 호출은 i18next 공식 지원 패턴. `useTranslation()` hook이 필요한 건 React 리렌더링 연동일 때뿐이고, toast 메시지는 일회성이라 문제 없음.

`satUnit()` 역시 `useAppStore.getState().settings.unitDisplay`를 읽는 순수 함수이므로 React 외부에서 안전.

### 4. Race condition: bridge toast + ReceiveQRStep 중복 감지

**실질적 문제 없음, 단 toast가 2번 뜰 수 있음.**

경로 분석:
- **Coco watcher** → `mint-quote:redeemed` → bridge.ts → `addToast` (success toast)
- **ReceiveQRStep의 `subscribeToQuote`** → polling/WS → `claimPayment()` → `onPaid` callback → `handlePaid` → `onPaymentDetected(amount)` → 화면 전환 (success 화면으로 이동)

`claimPayment()`에는 `claimInFlight` guard + 이미 claimed된 tx 체크가 있어서 Coco가 먼저 redeem하면 `claimPayment`가 `cocoRedeemMintQuote`를 호출할 때 이미 처리된 quote에 대해 동작함. 하지만 `pollQuoteStatus`의 `checkPaymentStatus`에서 quote not found → `claimPayment` 시도 → `cocoRedeemMintQuote`가 no-op이면 ok return → `guardedOnPaid` 호출 → `onPaymentDetected` → 화면 전환.

**결과**: ReceiveQR 화면이 열린 상태에서 결제 시:
1. Coco bridge → toast 1회
2. ReceiveQRStep → `onPaymentDetected` → success 화면 전환 (toast 없음, 화면 전환만)

이건 의도된 동작에 가까움. ReceiveQR은 화면 전환용이고, bridge는 백그라운드 toast용. **중복 toast는 발생하지 않음.** ReceiveQRStep의 `handlePaid`는 `onPaymentDetected(amount)`만 호출하고 toast를 띄우지 않으므로.

단, `handleSubscribeToQuote`(MainApp:451)에서 `refreshAll()`이 호출되고, bridge에서도 `updateBalances()`가 호출되어 잔액 갱신이 2회 발생함. 이건 멱등 연산이라 UX 영향 없음.

### 5. getPendingQuotes 인라인 필터

**경미한 논리 차이 있음 (non-blocking).**

현재 코드 (MainApp:308-309):
```typescript
const activeQuotes = allQuotes.filter((q) =>
  (!q.expiresAt || q.expiresAt > now) && (!q.createdAt || (now - q.createdAt) < 24 * 60 * 60 * 1000)
)
```

원본 `subscribeToPendingQuotes` (payment.service.ts:1092-1105):
```typescript
// expired 제거: q.expiresAt && q.expiresAt < now → removePendingQuote
// 24h 초과: !q.expiresAt && q.createdAt && (now - q.createdAt) > maxAge → removePendingQuote
```

**차이점:**
1. 원본은 24h 체크가 `!q.expiresAt` 조건 하에서만 적용됨 (expiry 없는 quote만). 새 코드는 `createdAt` 기준 24h를 모든 quote에 적용. 즉 `expiresAt`가 48시간 후인데 `createdAt`이 25시간 전인 quote가 새 필터에서는 탈락함.
2. 원본은 만료된 quote를 DB에서 `removePendingQuote`로 삭제했지만, 새 코드는 필터만 하고 삭제하지 않음. DB에 stale quote가 누적될 수 있으나, `recoverPendingQuotes`가 앱 시작 시 정리하므로 실질적 문제 아님.

**심각도: low.** 현실적으로 Cashu mint quote expiry는 대부분 10분~1시간이라 24시간 이상 살아있는 quote 자체가 거의 없음. 하지만 논리적 정합성을 위해 원본과 동일하게 수정하면 깔끔함.

## Issues Summary

| # | Severity | Issue |
|---|----------|-------|
| 1 | low | 인라인 필터: 24h 체크가 `expiresAt` 유무와 무관하게 적용됨 (원본은 `!expiresAt` 조건 하에서만) |
| 2 | info | 인라인 필터: 만료 quote DB 삭제 안 함 (recoverPendingQuotes가 커버하므로 OK) |
| 3 | info | ReceiveQR 활성 시 `updateBalances` + `refreshAll` 이중 호출 (멱등, UX 영향 없음) |
| 4 | info | `subscribeToPendingQuotes` 메서드가 payment.service.ts에 잔존 (plan대로 Phase 3 제거 예정) |
