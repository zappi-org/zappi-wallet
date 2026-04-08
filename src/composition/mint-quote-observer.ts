/**
 * Mint Quote Observer
 *
 * SDK의 mint-op:finalized 이벤트를 구독하여
 * Transaction DB에 Lightning receive 거래를 자동 기록한다.
 *
 * bridge.ts의 SRP를 유지하기 위해 별도 모듈로 분리:
 * - bridge.ts: Coco events → Zustand store (balance, toast)
 * - mintQuoteObserver.ts: mint-op:finalized → Transaction DB
 *
 * recordLightningReceive: observer + claimPayment 양쪽에서 호출 가능한
 * idempotent 거래 기록 함수.
 *
 * Phase 5: OperationMap이 주입되면 기존 pending TX를 settle하고,
 * 없으면(과도기) 기존대로 새 TX를 생성한다.
 */

import type { Manager } from 'coco-cashu-core';
import type { OperationMap } from '@/core/ports/driven/operation-map.port';
import type { TransactionRepository } from '@/core/ports/driven/transaction.repository.port';
import { settleAsDelivered } from '@/core/domain/transaction';
import { useAppStore } from '@/store';
import { broadcastSync } from '@/hooks/use-cross-tab-sync';
import { isSwapQuote, unmarkQuoteAsSwap } from '@/modules/cashu/internal/swap-quote-tracker';

let unsubscribers: (() => void)[] = [];

// ─── Phase 5 주입 대상 ───
let injectedOperationMap: OperationMap | null = null;
let injectedTxRepo: TransactionRepository | null = null;

/**
 * Phase 5: bootstrap에서 OperationMap + TransactionRepository 주입
 * connectMintQuoteObserver 호출 전에 실행해야 함.
 */
export function injectDependencies(operationMap: OperationMap, txRepo: TransactionRepository): void {
  injectedOperationMap = operationMap;
  injectedTxRepo = txRepo;
}

// ─── 공유 거래 기록 함수 (idempotent) ───

/**
 * Lightning receive 거래를 Transaction DB에 기록.
 *
 * Phase 5 경로: OperationMap에서 quoteId → txId 조회 →
 *   기존 pending TX가 있으면 settleAsDelivered로 전환.
 * Fallback 경로 (과도기): OperationMap 없거나 매핑 없으면 기존대로 새 TX 생성.
 */
export async function recordLightningReceive(params: {
  quoteId: string;
  mintUrl: string;
  amount: number;
  bolt11?: string;
}): Promise<boolean> {
  // Phase 5 경로: OperationMap → settle existing pending TX
  if (injectedOperationMap && injectedTxRepo) {
    const existingTxId = await injectedOperationMap.resolve(params.quoteId);
    if (existingTxId) {
      const existingTx = await injectedTxRepo.getById(existingTxId);
      if (existingTx) {
        if (existingTx.status === 'settled') return false; // 이미 처리됨
        const settled = settleAsDelivered(existingTx);
        await injectedTxRepo.update(existingTxId, {
          status: settled.status,
          outcome: settled.outcome,
          completedAt: settled.completedAt,
        });
        useAppStore.getState().triggerTxRefresh();
        broadcastSync('balance_changed');
        return true;
      }
    }
  }

  // Fallback 경로 (과도기): 기존대로 새 TX 생성
  const { getTransactionRepo } = await import('@/composition/legacy-transaction-repo');
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
 * SDK mint-op:finalized 이벤트를 Transaction DB에 연결
 */
export function connectMintQuoteObserver(manager: Manager): void {
  disconnectMintQuoteObserver();

  const unsubRedeemed = manager.on('mint-op:finalized', async (event) => {
    const { operation, mintUrl } = event;
    if (operation.state !== 'finalized') return;

    // 스왑 quote는 별도 swap 거래가 기록되므로 skip + Set 정리
    if (isSwapQuote(operation.quoteId)) {
      unmarkQuoteAsSwap(operation.quoteId);
      return;
    }

    try {
      const recorded = await recordLightningReceive({
        quoteId: operation.quoteId,
        mintUrl,
        amount: operation.amount,
        bolt11: operation.request,
      });
      if (recorded) {
        console.log(`[MintQuoteObserver] Recorded: ${operation.quoteId} (${operation.amount} sats from ${mintUrl})`);
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
