---
based_on: .pipeline/analysis.md
date: 2026-03-18
status: pending_review
---

# Plan: Coco watcher bridge — 결제 감지 위임

Trivial 아님. 하지만 방향 확정이라 후보 비교 불필요.

## Change Spec

### `src/store/slices/wallet.slice.ts`
pendingQuotes 상태 재추가 (UI 표시용 — 민트별 대기중 요청)
```pseudo
// PendingQuote 타입: { quoteId, mintUrl, amount, invoice, expiry, status }
// addPendingQuote, removePendingQuote, markQuotePaid 액션
```

### `src/store/index.ts`
PendingQuote export + resetAll에 pendingQuotes 추가

### `src/coco/bridge.ts`
mint-quote:redeemed 이벤트에 toast + store 정리 연결
```pseudo
// 기존 mint-quote:redeemed 핸들러 확장:
//   updateBalances() — 기존 유지
//   + addToast({ type: 'success', message: lightningReceived, amount })
//   + removePendingQuote(quoteId)
//   + broadcastSync('balance_changed')
```

### `src/MainApp.tsx`
subscribeToPendingQuotes 자체 폴링 제거
```pseudo
// 제거:
//   subscribeToPendingQuotes 호출 (line 307-321)
//   wsSubscriptionRef 관련 코드
//   cleanup에서 wsSubscriptionRef.current() 호출

// 유지:
//   recoverAll (앱 시작 + visibility change) — melt/send/offline token 복구용
//   handleVisibilityChange — quote 외 복구는 필요

// 추가:
//   앱 시작 시 getActivePendingQuotes() → store에 로드
//   handleCreateInvoice에서 addPendingQuote() 호출
```

### `src/services/payment/payment.service.ts`
변경 없음. subscribeToPendingQuotes는 호출 안 할 뿐 메서드 자체는 Phase 3에서 제거.
getActivePendingQuotes, checkQuoteStatus는 유지.

### `src/ui/screens/Receive/steps/ReceiveQRStep.tsx`
변경 없음. 화면 활성 시 빠른 감지용 자체 구독 유지.

## Test Plan

### Unit Tests (Vitest)
- `src/__tests__/unit/store/wallet-pending-quotes.test.ts` — 재추가. addPendingQuote, removePendingQuote, markQuotePaid CRUD 검증.

## Risk Check

- Regression: Coco watcher가 실제로 결제를 감지하는지 실기기 확인 필수. 자체 폴링 제거 후 감지 안 되면 치명적.
- Edge case: bridge.ts에서 toast 띄울 때 i18n의 t() 접근 — bridge는 React 컴포넌트 밖이라 useTranslation 못 씀. useAppStore.getState()로 직접 접근하거나 하드코딩.
- Manual QA: 인보이스 생성 → 외부 결제 → toast 확인 + 잔액 반영
