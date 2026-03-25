import type { Manager } from 'coco-cashu-core';
import { useAppStore } from '@/store';
import { broadcastSync } from '@/hooks/use-cross-tab-sync';
import i18n from '@/i18n';
import { satUnit } from '@/utils/format';
import { connectSendTokenObserver, disconnectSendTokenObserver } from './sendTokenObserver';
import { connectMintQuoteObserver, disconnectMintQuoteObserver } from './mintQuoteObserver';
import { findByQuoteId, completeReceiveRequest } from '@/services/receive-request';

// Coco 이벤트 구독 해제 함수들
let unsubscribers: (() => void)[] = [];

// 스왑 quote 필터링 — bridge 토스트 억제용
const swapQuoteIds = new Set<string>();

export function markQuoteAsSwap(quoteId: string): void {
  swapQuoteIds.add(quoteId);
}

export function unmarkQuoteAsSwap(quoteId: string): void {
  swapQuoteIds.delete(quoteId);
}

export function isSwapQuote(quoteId: string): boolean {
  return swapQuoteIds.has(quoteId);
}

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

  // Mint quote 상환 시 잔액 업데이트 + toast + store 정리
  const unsubMintQuoteRedeemed = manager.on('mint-quote:redeemed', (event) => {
    updateBalances();
    const { removePendingQuote, addToast } = useAppStore.getState();
    removePendingQuote(event.quoteId);

    // 스왑 quote는 토스트 억제 (use-payment.ts에서 swap 전용 토스트 표시)
    // delete는 하지 않음 — observer가 swap 여부 확인 후 정리
    if (swapQuoteIds.has(event.quoteId)) {
      console.log(`[Coco Bridge] Swap quote redeemed (toast suppressed): ${event.quoteId}`);
    } else {
      addToast({
        type: 'success',
        message: i18n.t('toast.lightningReceived', { unit: satUnit(), amount: event.quote.amount.toLocaleString() }),
        duration: 4000,
      });
    }

    // Mark associated ReceiveRequest as completed
    findByQuoteId(event.quoteId).then((req) => {
      if (req && req.status === 'pending') {
        completeReceiveRequest(req.id, 'lightning')
          .catch((err) => console.error('[Coco Bridge] Failed to complete ReceiveRequest:', err));
      }
    }).catch((err) => console.warn('[Coco Bridge] ReceiveRequest lookup failed:', err));

    broadcastSync('balance_changed');
    console.log(`[Coco Bridge] Quote redeemed: ${event.quoteId} (${event.quote.amount} sats from ${event.mintUrl})`);
  });
  unsubscribers.push(unsubMintQuoteRedeemed);

  // Melt quote 결제 시 잔액 업데이트
  const unsubMeltQuotePaid = manager.on('melt-quote:paid', () => {
    updateBalances();
  });
  unsubscribers.push(unsubMeltQuotePaid);

  // 초기 잔액 로드
  updateBalances();

  // Send token observer (send:finalized/rolled-back → Transaction DB 업데이트)
  connectSendTokenObserver(manager);

  // Mint quote observer (mint-quote:redeemed → Transaction DB 기록)
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
