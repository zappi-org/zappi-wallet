/**
 * Bootstrap piece — cold-start cache + EventBus→Store bridges.
 *
 * Runs the three assembly-time side effects (reflect cached balance into the store,
 * connect the event-store bridge, connect the transfer-tx bridge) in the original order.
 */

// ─── Core ───
import { toNumber } from "@/core/domain/amount";

// ─── Store (composition root only) ───
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

  // Cold-start cache → reflect into store immediately (sync)
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

  // EventBus → Store bridge
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

  // Transfer → Transaction bridge (persists tx history for the TLS path)
  connectTransferTxBridge({
    eventBus,
    txRepo,
    triggerTxRefresh: () => useAppStore.getState().triggerTxRefresh(),
  });

  return { balanceRefresh, disconnectBridge };
}
