import type { Manager } from 'coco-cashu-core';
import { useAppStore } from '@/store';

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

  // Proof 저장 시 잔액 업데이트
  const unsubProofsSaved = manager.on('proofs:saved', () => {
    updateBalances();
  });
  unsubscribers.push(unsubProofsSaved);

  // Proof 상태 변경 시 잔액 업데이트
  const unsubProofsStateChanged = manager.on('proofs:state-changed', () => {
    updateBalances();
  });
  unsubscribers.push(unsubProofsStateChanged);

  // Proof 삭제 시 잔액 업데이트
  const unsubProofsDeleted = manager.on('proofs:deleted', () => {
    updateBalances();
  });
  unsubscribers.push(unsubProofsDeleted);

  // Proof 전체 삭제 시 잔액 업데이트
  const unsubProofsWiped = manager.on('proofs:wiped', () => {
    updateBalances();
  });
  unsubscribers.push(unsubProofsWiped);

  // Mint quote 상환 시 잔액 업데이트
  const unsubMintQuoteRedeemed = manager.on('mint-quote:redeemed', () => {
    updateBalances();
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
