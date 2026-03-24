/**
 * Mint Quote Observer
 *
 * SDK의 mint-quote:redeemed 이벤트를 구독하여
 * Transaction DB에 Lightning receive 거래를 자동 기록한다.
 *
 * bridge.ts의 SRP를 유지하기 위해 별도 모듈로 분리:
 * - bridge.ts: Coco events → Zustand store (balance, toast)
 * - mintQuoteObserver.ts: mint-quote:redeemed → Transaction DB
 *
 * recordLightningReceive: observer + claimPayment 양쪽에서 호출 가능한
 * idempotent 거래 기록 함수. DB 기록을 한 곳에서 관리한다.
 */

import type { Manager } from 'coco-cashu-core';
import { useAppStore } from '@/store';
import { broadcastSync } from '@/hooks/use-cross-tab-sync';
import { isSwapQuote, unmarkQuoteAsSwap } from './bridge';

let unsubscribers: (() => void)[] = [];

// ─── 공유 거래 기록 함수 (idempotent) ───

/**
 * Lightning receive 거래를 Transaction DB에 기록
 * 이미 존재하면 skip (idempotent)
 */
export async function recordLightningReceive(params: {
  quoteId: string;
  mintUrl: string;
  amount: number;
  bolt11?: string;
}): Promise<boolean> {
  const { getTransactionRepo } = await import('@/data/repositories/transaction.repository');
  const repo = getTransactionRepo();
  const txId = `tx-${params.quoteId}`;

  const existing = await repo.findById(txId);
  if (existing) return false; // 이미 기록됨

  await repo.save({
    id: txId,
    direction: 'receive' as const,
    type: 'lightning' as const,
    amount: params.amount,
    mintUrl: params.mintUrl,
    status: 'completed' as const,
    createdAt: Date.now(),
    completedAt: Date.now(),
    bolt11: params.bolt11,
    metadata: { quoteId: params.quoteId },
  });

  useAppStore.getState().triggerTxRefresh();
  broadcastSync('balance_changed');
  return true;
}

// ─── Observer 연결 ───

/**
 * SDK mint-quote:redeemed 이벤트를 Transaction DB에 연결
 */
export function connectMintQuoteObserver(manager: Manager): void {
  disconnectMintQuoteObserver();

  const unsubRedeemed = manager.on('mint-quote:redeemed', async (event) => {
    // 스왑 quote는 별도 swap 거래가 기록되므로 skip + Set 정리
    if (isSwapQuote(event.quoteId)) {
      unmarkQuoteAsSwap(event.quoteId);
      return;
    }

    try {
      const recorded = await recordLightningReceive({
        quoteId: event.quoteId,
        mintUrl: event.mintUrl,
        amount: event.quote.amount,
        bolt11: event.quote.request,
      });
      if (recorded) {
        console.log(`[MintQuoteObserver] Recorded: ${event.quoteId} (${event.quote.amount} sats from ${event.mintUrl})`);
      }
    } catch (error) {
      console.error('[MintQuoteObserver] Failed to record transaction:', error);
    }
  });

  unsubscribers = [unsubRedeemed];
  console.log('[MintQuoteObserver] Connected');
}

/**
 * 이벤트 구독 해제
 */
export function disconnectMintQuoteObserver(): void {
  for (const unsub of unsubscribers) {
    unsub();
  }
  unsubscribers = [];
}
