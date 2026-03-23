/**
 * Send Token Observer
 *
 * SDK의 send:finalized / send:rolled-back 이벤트를 구독하여
 * Transaction DB와 pendingSendTokens를 자동 업데이트한다.
 *
 * bridge.ts의 SRP를 유지하기 위해 별도 모듈로 분리:
 * - bridge.ts: Coco events → Zustand store (balance, toast)
 * - sendTokenObserver.ts: send events → Transaction DB + pendingSendTokens 정리
 *
 * markSendFinalized / markSendReclaimed: observer + UI 양쪽에서 호출 가능한
 * idempotent 상태 전이 함수. DB 업데이트를 한 곳에서 관리한다.
 */

import type { Manager } from 'coco-cashu-core';
import type { TokenState } from '@/core/types';
import { useAppStore } from '@/store';
import { broadcastSync } from '@/hooks/use-cross-tab-sync';

let unsubscribers: (() => void)[] = [];

// ─── 공유 상태 전이 함수 (idempotent) ───

/**
 * 토큰이 수령되어 spent 상태로 전이 (finalized)
 * observer의 send:finalized 이벤트 및 UI에서 직접 호출 가능
 */
export async function markSendFinalized(txId: string): Promise<boolean> {
  const { getDatabase } = await import('@/data/database/schema');
  const db = getDatabase();
  const tx = await db.transactions.get(txId);
  if (!tx || tx.status === 'completed') return false;

  await db.transactions.update(txId, {
    status: 'completed',
    tokenState: 'spent' as TokenState,
    completedAt: Date.now(),
  });
  await db.pendingSendTokens.delete(txId).catch(() => {});

  useAppStore.getState().triggerTxRefresh();
  broadcastSync('balance_changed');
  return true;
}

/**
 * 토큰이 회수되어 reclaimed 상태로 전이 (rolled-back)
 * observer의 send:rolled-back 이벤트 및 UI에서 직접 호출 가능
 *
 * 1. 원본 send 거래를 reclaimed로 마킹
 * 2. 별도의 receive 거래를 생성하여 회수 내역을 거래내역에 표시
 */
export async function markSendReclaimed(txId: string): Promise<boolean> {
  const { getDatabase } = await import('@/data/database/schema');
  const db = getDatabase();
  const tx = await db.transactions.get(txId);
  if (!tx) return false;
  // 이미 reclaimed 처리됨
  if (tx.status === 'completed' && tx.failureReason === 'reclaimed') return false;

  const now = Date.now();

  // 원본 send 거래 마킹
  await db.transactions.update(txId, {
    status: 'completed',
    failureReason: 'reclaimed',
    tokenState: 'spent' as TokenState,
    completedAt: now,
  });

  // 회수 receive 거래 생성
  const reclaimTxId = `${txId}-reclaim`;
  const existing = await db.transactions.get(reclaimTxId);
  if (!existing) {
    await db.transactions.put({
      id: reclaimTxId,
      direction: 'receive',
      type: tx.type,
      amount: tx.amount,
      mintUrl: tx.mintUrl,
      status: 'completed',
      createdAt: now,
      completedAt: now,
      metadata: { reclaimedFrom: txId },
    });
  }

  await db.pendingSendTokens.delete(txId).catch(() => {});

  useAppStore.getState().triggerTxRefresh();
  broadcastSync('balance_changed');
  return true;
}

// ─── Observer 연결 ───

async function findTxByOperationId(operationId: string) {
  const { getDatabase } = await import('@/data/database/schema');
  const db = getDatabase();
  return db.transactions.where('operationId').equals(operationId).first();
}

/**
 * SDK send 이벤트를 Transaction DB에 연결
 */
export function connectSendTokenObserver(manager: Manager): void {
  disconnectSendTokenObserver();

  // send:finalized — 수령자가 토큰을 수령하여 proof가 spent 확인됨
  const unsubFinalized = manager.on('send:finalized', async ({ operationId }) => {
    if (!operationId) return;
    try {
      const tx = await findTxByOperationId(operationId);
      if (!tx) return;
      const updated = await markSendFinalized(tx.id);
      if (updated) {
        console.log(`[SendTokenObserver] Finalized: ${operationId} → tx ${tx.id}`);
      }
    } catch (error) {
      console.error('[SendTokenObserver] Failed to handle send:finalized:', error);
    }
  });

  // send:rolled-back — 토큰 회수 완료 (proof reclaim swap 성공)
  const unsubRolledBack = manager.on('send:rolled-back', async ({ operationId }) => {
    if (!operationId) return;
    try {
      const tx = await findTxByOperationId(operationId);
      if (!tx) return;
      const updated = await markSendReclaimed(tx.id);
      if (updated) {
        console.log(`[SendTokenObserver] Rolled back: ${operationId} → tx ${tx.id}`);
      }
    } catch (error) {
      console.error('[SendTokenObserver] Failed to handle send:rolled-back:', error);
    }
  });

  unsubscribers = [unsubFinalized, unsubRolledBack];
  console.log('[SendTokenObserver] Connected');
}

/**
 * 이벤트 구독 해제
 */
export function disconnectSendTokenObserver(): void {
  for (const unsub of unsubscribers) {
    unsub();
  }
  unsubscribers = [];
}
