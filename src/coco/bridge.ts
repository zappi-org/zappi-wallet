import type { Manager } from 'coco-cashu-core';
import { useAppStore } from '@/store';
import { broadcastSync } from '@/hooks/use-cross-tab-sync';
import i18n from '@/i18n';
import { satUnit } from '@/utils/format';

// Coco 이벤트 구독 해제 함수들
let unsubscribers: (() => void)[] = [];

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
    addToast({
      type: 'success',
      message: i18n.t('toast.lightningReceived', { unit: satUnit(), amount: event.quote.amount.toLocaleString() }),
      duration: 4000,
    });
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
  console.log('[Coco Bridge] Disconnected from store');
}
