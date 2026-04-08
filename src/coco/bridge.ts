import type { Manager } from 'coco-cashu-core';
import { useAppStore } from '@/store';
import { broadcastSync } from '@/hooks/use-cross-tab-sync';
import i18n from '@/i18n';
import { satUnit } from '@/utils/format';
import { disconnectSendTokenObserver } from './sendTokenObserver';
import { connectMintQuoteObserver, disconnectMintQuoteObserver } from './mintQuoteObserver';
import { getDatabase } from '@/adapters/storage/dexie/schema';

// Coco 이벤트 구독 해제 함수들
let unsubscribers: (() => void)[] = [];

// Swap quote tracking — delegated to modules/cashu/internal
import { isSwapQuote, markQuoteAsSwap, unmarkQuoteAsSwap } from '@/modules/cashu/internal/swap-quote-tracker';
export { isSwapQuote, markQuoteAsSwap, unmarkQuoteAsSwap };

/**
 * Coco Manager 이벤트를 Zustand 스토어에 연결
 */
export function connectCocoToStore(manager: Manager): void {
  // 기존 구독 해제
  disconnectCocoFromStore();

  const { setBalance } = useAppStore.getState();

  // 잔액 업데이트 헬퍼
  const updateBalances = async () => {
    try {
      const balances = await manager.wallet.getBalances();
      const byMint = balances as Record<string, number>;
      const total = Object.values(byMint).reduce((sum, b) => sum + b, 0);
      setBalance({ total, byMint });
    } catch (error) {
      console.error('[Coco Bridge] Failed to update balances:', error);
    }
  };

  // Proof 변경 시 잔액 업데이트
  for (const event of ['proofs:saved', 'proofs:state-changed', 'proofs:deleted', 'proofs:wiped'] as const) {
    unsubscribers.push(manager.on(event, () => updateBalances()));
  }

  // Mint operation 완료 시 잔액 업데이트 + toast + store 정리
  // (거래 DB 기록은 mintQuoteObserver가 담당)
  const unsubMintOpFinalized = manager.on('mint-op:finalized', (event) => {
    updateBalances();
    const { operation, mintUrl } = event;
    if (operation.state !== 'finalized') return;
    const { removePendingQuote, addToast, setLastRedeemedQuote } = useAppStore.getState();

    removePendingQuote(operation.quoteId);

    // 스왑 quote는 토스트 억제 (use-payment.ts에서 swap 전용 토스트 표시)
    // delete는 하지 않음 — observer가 swap 여부 확인 후 정리
    if (isSwapQuote(operation.quoteId)) {
      console.log(`[Coco Bridge] Swap quote redeemed (toast suppressed): ${operation.quoteId}`);
    } else {
      addToast({
        type: 'success',
        message: i18n.t('toast.lightningReceived', { unit: satUnit(), amount: operation.amount.toLocaleString() }),
        duration: 4000,
      });
      // ReceiveQRStep이 Lightning 결제 감지할 수 있도록 store에 기록
      setLastRedeemedQuote(operation.quoteId, operation.amount);
    }

    // Mark associated ReceiveRequest as completed
    getDatabase().receiveRequests.where('quoteId').equals(operation.quoteId).first().then((req) => {
      if (req && req.status === 'pending') {
        getDatabase().receiveRequests.update(req.id, {
          status: 'completed',
          completedAt: Date.now(),
          completedMethod: 'lightning',
        }).catch((err) => console.error('[Coco Bridge] Failed to complete ReceiveRequest:', err));
      }
    }).catch((err) => console.warn('[Coco Bridge] ReceiveRequest lookup failed:', err));

    broadcastSync('balance_changed');
    console.log(`[Coco Bridge] Mint op finalized: ${operation.quoteId} (${operation.amount} sats from ${mintUrl})`);
  });
  unsubscribers.push(unsubMintOpFinalized);

  // Melt quote 결제 시 잔액 업데이트
  const unsubMeltQuotePaid = manager.on('melt-quote:paid', () => {
    updateBalances();
  });
  unsubscribers.push(unsubMeltQuotePaid);

  // 초기 잔액 로드
  updateBalances();

  // Send token observer: MainApp에서 deps 주입하여 연결 (wiring-guide 참고)

  // Mint quote observer (mint-op:finalized → Transaction DB 기록)
  connectMintQuoteObserver(manager);

  console.log('[Coco Bridge] Connected to store');
}

/**
 * Coco 이벤트 구독 해제
 */
export function disconnectCocoFromStore(): void {
  for (const unsub of unsubscribers) {
    unsub();
  }
  unsubscribers = [];
  disconnectSendTokenObserver();
  disconnectMintQuoteObserver();
  console.log('[Coco Bridge] Disconnected from store');
}
