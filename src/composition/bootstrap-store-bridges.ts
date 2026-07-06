/**
 * Bootstrap 조각 7 — 콜드스타트 캐시 + EventBus→Store 브리지 (bootstrap.ts 순수 이동)
 *
 * 조립 시점 부수효과 3건(캐시 잔액 store 반영, event-store 브리지 연결,
 * transfer-tx 브리지 연결)이 원본과 동일한 순서로 실행된다.
 */

// ─── Core ───
import { toNumber } from "@/core/domain/amount";

// ─── Store (composition root만 접근) ───
import { useAppStore } from "@/store";

import { connectEventStoreBridge } from "./event-store-bridge";
import { connectTransferTxBridge } from "./transfer-tx-bridge";

import type { EventBus } from "@/core/events/event-bus";
import type { BalanceUseCase } from "@/core/ports/driving/balance.usecase";
import type { LocalStorageBalanceCache } from "@/adapters/cache/local-storage-balance-cache.adapter";
import type { DexieTransactionRepository } from "@/adapters/storage/dexie/dexie-transaction.repository";
import type { ReceiveRequestFacadeService } from "@/core/services/receive-request-facade.service";

export function connectStoreBridges(deps: {
  balanceCache: LocalStorageBalanceCache;
  balance: BalanceUseCase;
  eventBus: EventBus;
  receiveRequest: ReceiveRequestFacadeService;
  txRepo: DexieTransactionRepository;
}) {
  const { balanceCache, balance, eventBus, receiveRequest, txRepo } = deps;

  // 7. Cold start cache → store 즉시 반영 (동기)
  const cached = balanceCache.load();
  if (cached) {
    const byMint: Record<string, number> = {};
    let total = 0;
    for (const mb of cached) {
      for (const account of mb.accounts) {
        byMint[account.id] = toNumber(account.amount);
        total += toNumber(account.amount);
      }
    }
    useAppStore.getState().setBalance({ total, byMint });
  }

  // 8. EventBus → Store bridge
  const balanceRefresh = async () => {
    const moduleBalances = await balance.getByModule();
    const byMint: Record<string, number> = {};
    let total = 0;
    for (const mb of moduleBalances) {
      for (const account of mb.accounts) {
        byMint[account.id] = toNumber(account.amount);
        total += toNumber(account.amount);
      }
    }
    useAppStore.getState().setBalance({ total, byMint });
    balanceCache.save(moduleBalances);
  };
  const disconnectBridge = connectEventStoreBridge(eventBus, {
    handleBalance: true,
    balanceRefresh,
    receiveRequest,
  });

  // Transfer → Transaction Bridge (TLS 경로의 거래내역 저장)
  connectTransferTxBridge({
    eventBus,
    txRepo,
    triggerTxRefresh: () => useAppStore.getState().triggerTxRefresh(),
  });

  return { balanceRefresh, disconnectBridge };
}
