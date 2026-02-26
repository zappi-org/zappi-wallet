import { useState, useEffect, useMemo, startTransition, useCallback } from "react";
import { Bell, User, Plus } from "lucide-react";

import { useTranslation } from "react-i18next";
import { MintCard, getVariantByIndex } from "../../components/wallet/MintCard";
import { ActionButtons } from "../../components/wallet/ActionButtons";
import { TransactionList } from "../../components/wallet/TransactionList";
import { UnifiedScanner, type ValidatedData } from "../../components/scanner";
import { useWallet, useMintHealth, useMintMetadata } from "@/hooks";
import { useAppStore } from "@/store";
import type { MintInfo, Transaction } from "@/core/types";
import { TransactionRepository } from "@/data/repositories/transaction.repository";

// Singleton repository instance to avoid recreation
let transactionRepoInstance: TransactionRepository | null = null;
const getTransactionRepo = () => {
  if (!transactionRepoInstance) {
    transactionRepoInstance = new TransactionRepository();
  }
  return transactionRepoInstance;
};

export interface HomeScreenProps {
  onSettings: () => void;
  onNotifications?: () => void;
  onTransactions?: () => void;
  onTransfer?: () => void;
  onAnalytics?: () => void;
  onAddMint?: () => void;
  onMintDetails?: (mint: MintInfo) => void;
  onValidatedScan?: (data: ValidatedData) => void;
  onSelectTransaction?: (tx: Transaction) => void;
  transactions?: Transaction[];
}

export function HomeScreen({
  onSettings,
  onNotifications,
  onTransactions,
  onTransfer,
  onAnalytics,
  onAddMint,
  onMintDetails,
  onValidatedScan,
  onSelectTransaction,
  transactions: propTransactions,
}: HomeScreenProps) {
  const { t } = useTranslation();
  const [localTransactions, setLocalTransactions] = useState<Transaction[]>([]);
  const [isScannerOpen, setIsScannerOpen] = useState(false);

  // Use prop transactions if provided, otherwise use local state
  const transactions = propTransactions ?? localTransactions;

  const { balance, isLoadingBalance } = useWallet();
  const { checkAllMints, getCachedStatus } = useMintHealth();
  const settings = useAppStore((state) => state.settings);
  const lastNotificationCheckedAt = useAppStore((state) => state.lastNotificationCheckedAt);
  const markNotificationsRead = useAppStore((state) => state.markNotificationsRead);
  const updateAvailable = useAppStore((state) => state.updateAvailable);
  const txRefreshTrigger = useAppStore((state) => state.txRefreshTrigger);
  const { getDisplayName, getIconUrl } = useMintMetadata(settings?.mints || []);

  const [now] = useState(() => Date.now());

  // Check if there are new transactions since last notification check
  const hasNewNotifications = useMemo(() => {
    if (transactions.length === 0) return false;
    if (lastNotificationCheckedAt === null) {
      // Never checked - show dot if there are any recent transactions (last 24h)
      const oneDayAgo = now - 24 * 60 * 60 * 1000;
      return transactions.some((tx) => tx.createdAt > oneDayAgo);
    }
    return transactions.some((tx) => tx.createdAt > lastNotificationCheckedAt);
  }, [transactions, lastNotificationCheckedAt, now]);

  const handleNotificationsClick = () => {
    markNotificationsRead();
    onNotifications?.();
  };

  // Load transactions from DB if not provided via props
  // Reload when balance changes (indicates a new payment was made)
  useEffect(() => {
    // Skip if transactions are provided via props
    if (propTransactions) return;

    const loadTransactions = async () => {
      const repo = getTransactionRepo();
      const txs = await repo.findAll({ limit: 20 });
      // Use startTransition to mark this as non-urgent update
      startTransition(() => {
        setLocalTransactions(txs);
      });
    };
    loadTransactions();
  }, [balance.total, propTransactions, txRefreshTrigger]);

  // Check mint health on mount
  useEffect(() => {
    checkAllMints();
  }, [checkAllMints]);

  // Build mint info from settings.mints with online status and metadata
  const mints: MintInfo[] = useMemo(() => {
    return (settings?.mints || []).map((url) => {
      const cachedStatus = getCachedStatus(url);
      // Normalize URL for balance lookup (remove trailing slash to match wallet.service.ts)
      const normalizedUrl = url.endsWith("/") ? url.slice(0, -1) : url;
      return {
        url,
        name: getDisplayName(url),
        iconUrl: getIconUrl(url),
        balance: balance.byMint[normalizedUrl] || balance.byMint[url] || 0,
        isOnline: cachedStatus?.isOnline ?? true,
        lastChecked: cachedStatus?.lastChecked,
      };
    });
  }, [settings?.mints, balance.byMint, getCachedStatus, getDisplayName, getIconUrl]);

  const totalBalance = balance.total;

  const handleMintClick = (index: number) => {
    onMintDetails?.(mints[index]);
  };

  const handleScanOpen = useCallback(() => {
    setIsScannerOpen(true);
  }, []);

  const handleScanClose = useCallback(() => {
    setIsScannerOpen(false);
  }, []);

  const handleValidatedScan = useCallback(
    (data: ValidatedData) => {
      // Don't close scanner here - HomeScreen will unmount when currentScreen changes,
      // which naturally removes the scanner without flashing the home screen
      onValidatedScan?.(data);
    },
    [onValidatedScan]
  );

  return (
    <div className="h-dvh bg-background text-foreground font-sans selection:bg-accent-primary/30 overflow-hidden flex flex-col pt-safe">
      <div className="animate-fadeIn flex flex-col h-full relative">
          {/* Top Section: Header + Balance + Cards */}
          <div className="flex-none flex flex-col gap-2 pb-2">
            {/* Header */}
            <header className="grid grid-cols-[1fr_auto_1fr] items-center px-4 pt-4 relative z-50">
              <div className="flex justify-start">
                <button
                  onClick={onSettings}
                  aria-label={t('common.settings')}
                  className="p-2.5 rounded-xl bg-[#EDEAE6] hover:bg-[#E5E2DD] transition-all text-foreground relative"
                >
                  <User className="w-[22px] h-[22px]" />
                  {updateAvailable && (
                    <div className="absolute top-2 right-2.5 w-1.5 h-1.5 bg-accent-primary rounded-full border border-white" aria-hidden="true" />
                  )}
                </button>
              </div>

              <div className="flex justify-center">
                <span className="font-semibold text-[15px] tracking-tight text-foreground">ZAPPI</span>
              </div>

              <div className="flex justify-end">
                <button
                  onClick={handleNotificationsClick}
                  aria-label={t('common.notifications')}
                  className="p-2.5 rounded-xl bg-[#EDEAE6] hover:bg-[#E5E2DD] transition-all text-foreground relative"
                >
                  <Bell className="w-[22px] h-[22px]" />
                  {/* Notification dot - show only if there are new notifications */}
                  {hasNewNotifications && (
                    <div className="absolute top-2 right-2.5 w-1.5 h-1.5 bg-accent-danger rounded-full border border-white" aria-hidden="true" />
                  )}
                </button>
              </div>
            </header>

            {/* Total Balance */}
            <div className="px-4 mt-1">
              <span className="text-foreground-subtle text-xs font-semibold tracking-wide">
                My Balance
              </span>
              <h1 className="text-4xl font-bold tracking-tighter text-foreground leading-tight">
                {isLoadingBalance ? "..." : `₿${totalBalance.toLocaleString()}`}
              </h1>
            </div>

            {/* Mints / Cards Scroll */}
            <div className="flex flex-col mt-2">

              {/* Card carousel */}
              <div className="flex overflow-visible overflow-x-auto pb-4 pt-1 px-4 gap-3 scrollbar-hide snap-x snap-mandatory justify-start md:justify-center">
                {mints.length === 0 ? (
                  // No mints yet - show placeholder
                  <div className="w-[55vw] max-w-[220px] shrink-0 snap-center">
                    <div className="aspect-[220/245] rounded-[20px] border-2 border-dashed border-primary/20 flex flex-col items-center justify-center text-foreground-muted gap-2">
                      <Plus className="w-6 h-6" />
                      <span className="text-xs font-medium text-center px-2">{t('home.addFirstMint')}</span>
                    </div>
                  </div>
                ) : (
                  mints.map((mint, idx) => (
                    <div
                      key={mint.url}
                      className="w-[55vw] max-w-[220px] shrink-0 snap-center transform transition-transform"
                      onClick={() => handleMintClick(idx)}
                    >
                      <MintCard
                        mint={mint}
                        variant={getVariantByIndex(idx)}
                      />
                    </div>
                  ))
                )}

                {/* Add card button */}
                {mints.length > 0 && (
                  <div className="min-w-[15%] flex items-center justify-center pt-3">
                    <button
                      onClick={onAddMint}
                      aria-label={t('settings.addMint')}
                      className="w-10 h-10 rounded-full border-2 border-dashed border-accent-primary/30 flex items-center justify-center text-accent-primary hover:bg-accent-primary hover:text-white transition-all group"
                    >
                      <Plus className="w-5 h-5 group-hover:rotate-90 transition-transform" />
                    </button>
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Bottom Section: Transactions + Actions */}
          <div className="flex-1 flex flex-col min-h-0 bg-background-card rounded-t-[28px] shadow-[0_-4px_20px_rgba(0,0,0,0.03)] relative z-10">
            {/* Transaction List - Scrollable Area */}
            <div className="flex-1 overflow-y-auto pb-36">
              <TransactionList
                transactions={transactions}
                onSeeAll={onTransactions}
                onTransactionClick={onSelectTransaction}
                maxItems={10}
              />
            </div>

            {/* Action Buttons - Fixed at Bottom */}
            <div className="absolute bottom-0 left-0 right-0 z-20">
              <div className="bg-background-card px-6 pb-safe pt-2">
                <ActionButtons
                  onScan={handleScanOpen}
                  onTransfer={onTransfer}
                  onAnalytics={onAnalytics}
                />
              </div>
            </div>
          </div>
        </div>

      {/* Unified Scanner Modal */}
      <UnifiedScanner
        isOpen={isScannerOpen}
        onClose={handleScanClose}
        onValidated={handleValidatedScan}
      />
    </div>
  );
}
