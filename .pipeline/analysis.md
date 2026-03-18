---
type: feature
date: 2026-03-18
input: "feat: Coco watcher로 결제 감지 위임"
---

# Analysis: Coco Watcher Bridge — 결제 감지 위임

## Summary

현재 Lightning 결제 감지가 PaymentService의 자체 폴링(`subscribeToPendingQuotes`)과 Coco watcher(`enableMintQuoteWatcher`) 두 경로로 중복 실행됨. Coco watcher가 이미 결제 감지 + 잔액 반영을 하므로, PaymentService 폴링을 제거하고 bridge.ts에서 `mint-quote:redeemed` 이벤트에 toast + store 정리를 연결하면 됨.

## Classification
- Type: feature
- Severity: medium
- Affected flow: Lightning 수신

## Current Payment Detection Paths

1. **Coco watcher** (이미 동작 중):
   - `manager.enableMintQuoteWatcher()` — `src/coco/manager.ts:46`
   - `mint-quote:redeemed` 이벤트 → `bridge.ts:53` → `updateBalances()` (잔액만)
   - toast 없음, store.pendingQuotes 없음

2. **PaymentService 자체 폴링** (제거 대상):
   - `subscribeToPendingQuotes()` — `src/MainApp.tsx:307`
   - 10초 간격 폴링 + WS → 결제 감지 시 toast + refreshAll
   - `src/services/payment/payment.service.ts:1080-1140`

3. **recoverAll on visibility change** (유지, quote 부분 단순화):
   - `src/MainApp.tsx:336-366`
   - 앱 포그라운드 시 DB pending quotes 체크 → claim

4. **ReceiveQRStep 자체 구독** (유지):
   - `src/ui/screens/Receive/steps/ReceiveQRStep.tsx:78-115`
   - 화면 활성 시 빠른 감지용 (2초 폴링)

## mint-quote:redeemed Event Payload

```typescript
{
  mintUrl: string;
  quoteId: string;
  quote: MintQuoteBolt11Response; // { quote, request, state, expiry, amount, ... }
}
```

amount 포함 — toast 표시에 충분.

## Affected Files

- `src/coco/bridge.ts` — `mint-quote:redeemed`에 toast + removePendingQuote 추가
- `src/store/slices/wallet.slice.ts` — pendingQuotes 상태 추가 (store에서 제거됨, 재추가)
- `src/store/index.ts` — PendingQuote export + resetAll 추가
- `src/MainApp.tsx` — `subscribeToPendingQuotes` 호출 제거, wsSubscriptionRef 관련 코드 제거, handleCreateInvoice에서 store 추가
- `src/services/payment/payment.service.ts` — getActivePendingQuotes 유지 (store 초기 로드용)
