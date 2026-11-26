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
import {
  beginSwapOutInFlightWrite,
  writeSwapOutInFlight,
} from "./swap-out-inflight";

import type { EventBus } from "@/core/events/event-bus";
import type { BalanceUseCase } from "@/core/ports/driving/balance.usecase";
import type { LocalStorageBalanceCache } from "@/adapters/cache/local-storage-balance-cache.adapter";
import type { DexieTransactionRepository } from "@/adapters/storage/dexie/dexie-transaction.repository";
import type { ReceiveRequestFacadeService } from "@/core/services/receive-request-facade.service";
import type { SwapOutUseCase } from "@/core/ports/driving/swap-out.usecase";

export function connectStoreBridges(deps: {
  balanceCache: LocalStorageBalanceCache;
  balance: BalanceUseCase;
  eventBus: EventBus;
  receiveRequest: ReceiveRequestFacadeService;
  txRepo: DexieTransactionRepository;
  getSwapOut?: () => SwapOutUseCase | null;
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
    getSwapOut: deps.getSwapOut,
  });

  const refreshSwapOutInFlight = async () => {
    const service = deps.getSwapOut?.();
    if (!service) return;
    const token = beginSwapOutInFlightWrite();
    try {
      const active = await service.listActive();
      const known = Object.keys(useAppStore.getState().swapOutInFlightByMint);
      const amounts: Record<string, number> = {};
      for (const mintUrl of known) amounts[mintUrl] = 0;
      for (const mintUrl of new Set(active.map((view) => view.mintUrl))) {
        amounts[mintUrl] = await service.inFlightAmount(mintUrl);
      }
      writeSwapOutInFlight(token, amounts);
    } catch {
      return;
    }
  };

  const seedSwapOuts = async () => {
    const service = deps.getSwapOut?.();
    if (!service) return;
    try {
      useAppStore.getState().setSwapOuts(await service.listActive());
    } catch {
      return;
    }
    await refreshSwapOutInFlight();
  };

  // Transfer → Transaction bridge (persists tx history for the TLS path)
  const disconnectTransferBridge = connectTransferTxBridge({
    eventBus,
    txRepo,
    triggerTxRefresh: () => useAppStore.getState().triggerTxRefresh(),
  });

  return {
    balanceRefresh,
    disconnectBridge,
    disconnectTransferBridge,
    seedSwapOuts,
    refreshSwapOutInFlight,
  };
}
