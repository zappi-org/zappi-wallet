import { useState, useEffect, useMemo, startTransition, useCallback, useRef } from "react";
import { Bell, User, ArrowDown, ArrowUp, Plus } from "lucide-react";

import { useTranslation } from "react-i18next";
import { MintCard, getVariantByIndex } from "../../components/wallet/MintCard";
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
  onAddMint?: () => void;
  onMintDetails?: (mint: MintInfo) => void;
  onSend?: (mintUrl: string) => void;
  onReceive?: (mintUrl: string) => void;
  onValidatedScan?: (data: ValidatedData, mode: 'send' | 'receive') => void;
  onSelectTransaction?: (tx: Transaction) => void;
  transactions?: Transaction[];
}

export function HomeScreen({
  onSettings,
  onNotifications,
  onTransactions,
  onAddMint,
  onMintDetails,
  onSend,
  onReceive,
  onValidatedScan,
  onSelectTransaction,
  transactions: propTransactions,
}: HomeScreenProps) {
  const { t } = useTranslation();
  const [localTransactions, setLocalTransactions] = useState<Transaction[]>([]);
  const [isSendScannerOpen, setIsSendScannerOpen] = useState(false);
  const [isReceiveScannerOpen, setIsReceiveScannerOpen] = useState(false);
  const [activeMintIndex, setActiveMintIndex] = useState(0);

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
  useEffect(() => {
    if (propTransactions) return;
    const loadTransactions = async () => {
      const repo = getTransactionRepo();
      const txs = await repo.findAll({ limit: 20 });
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

  // Carousel scroll tracking with real-time scale effect
  const carouselRef = useRef<HTMLDivElement>(null);
  const cardRefs = useRef<(HTMLDivElement | null)[]>([]);
  const rafRef = useRef<number>(0);

  const updateCardScales = useCallback(() => {
    const el = carouselRef.current;
    if (!el || mints.length === 0) return;
    const containerCenter = el.scrollLeft + el.clientWidth / 2;
    const cardWidth = 288; // w-72
    const gap = 16; // gap-4

    cardRefs.current.forEach((card) => {
      if (!card) return;
      const cardCenter = card.offsetLeft + cardWidth / 2;
      const distance = Math.abs(containerCenter - cardCenter);
      const maxDistance = cardWidth + gap;
      const progress = Math.min(distance / maxDistance, 1);
      const scale = 1 - progress * 0.12; // 1.0 → 0.88
      const opacity = 1 - progress * 0.4; // 1.0 → 0.6
      card.style.transform = `scale(${scale})`;
      card.style.opacity = `${opacity}`;
    });
  }, [mints.length]);

  const handleScroll = useCallback(() => {
    // Real-time scale update via rAF (no CSS transition delay)
    cancelAnimationFrame(rafRef.current);
    rafRef.current = requestAnimationFrame(() => {
      const el = carouselRef.current;
      if (!el || mints.length === 0) return;
      const scrollLeft = el.scrollLeft;
      const cardWidth = 288 + 16;
      const index = Math.round(scrollLeft / cardWidth);
      setActiveMintIndex(Math.max(0, Math.min(index, mints.length - 1)));
      updateCardScales();
    });
  }, [mints.length, updateCardScales]);

  // Initial scale setup after mount/mints change
  useEffect(() => {
    const timer = setTimeout(updateCardScales, 50);
    return () => clearTimeout(timer);
  }, [mints.length, updateCardScales]);

  // Clamp activeMintIndex to valid range without effect setState
  const clampedMintIndex = mints.length === 0 ? 0 : Math.min(activeMintIndex, mints.length - 1);

  const getActiveMintUrl = useCallback(() => {
    if (mints.length === 0) return "";
    return mints[clampedMintIndex]?.url || mints[0].url;
  }, [mints, clampedMintIndex]);

  const handleMintClick = (index: number) => {
    onMintDetails?.(mints[index]);
  };

  const handleSendClick = useCallback(() => {
    const mintUrl = getActiveMintUrl();
    onSend?.(mintUrl);
    setIsSendScannerOpen(true);
  }, [getActiveMintUrl, onSend]);

  const handleReceiveClick = useCallback(() => {
    const mintUrl = getActiveMintUrl();
    onReceive?.(mintUrl);
    setIsReceiveScannerOpen(true);
  }, [getActiveMintUrl, onReceive]);

  const handleSendValidated = useCallback((data: ValidatedData) => {
    onValidatedScan?.(data, 'send');
  }, [onValidatedScan]);

  const handleReceiveValidated = useCallback((data: ValidatedData) => {
    onValidatedScan?.(data, 'receive');
  }, [onValidatedScan]);

  return (
    <div className="min-h-screen bg-white text-gray-900 font-sans max-w-md mx-auto overflow-hidden relative flex flex-col pt-safe">
      {/* Main Header */}
      <header className="flex items-center justify-between px-6 py-4">
        <button
          onClick={onSettings}
          aria-label={t('common.settings')}
          className="p-2 rounded-full hover:bg-gray-100 transition-colors relative"
        >
          <User className="w-6 h-6 text-gray-900" />
          {updateAvailable && (
            <div className="absolute top-0 right-0 w-2 h-2 bg-accent-primary rounded-full border border-white" aria-hidden="true" />
          )}
        </button>
        <h1 className="text-xl font-bold tracking-tight">Zappi</h1>
        <button
          onClick={handleNotificationsClick}
          aria-label={t('common.notifications')}
          className="p-2 rounded-full hover:bg-gray-100 transition-colors relative"
        >
          <Bell className="w-6 h-6 text-gray-900" />
          {hasNewNotifications && (
            <div className="absolute top-2 right-2.5 w-2 h-2 bg-red-500 rounded-full border border-white" aria-hidden="true" />
          )}
        </button>
      </header>

      <main className="flex-1 flex flex-col overflow-y-auto pb-10">
        {/* Total Balance */}
        <div className="flex flex-col items-center justify-center py-4">
          <div className="flex items-baseline gap-1">
            <span className="text-4xl font-bold tracking-tight">₿</span>
            <span className={`text-4xl font-bold tracking-tight ${isLoadingBalance ? 'animate-shimmer' : ''}`}>
              {isLoadingBalance ? "..." : totalBalance.toLocaleString()}
            </span>
          </div>
          <p className="text-gray-400 text-sm mt-1 font-medium">{t('home.totalBalance')}</p>
        </div>

        {/* Card Carousel */}
        <div className="relative w-full overflow-hidden py-4">
          {mints.length === 0 ? (
            /* Empty state */
            <div className="flex justify-center items-center px-4">
              <button
                onClick={onAddMint}
                className="w-72 h-44 rounded-[16px] border-2 border-dashed border-gray-300 flex flex-col items-center justify-center text-gray-400 gap-2"
              >
                <Plus className="w-6 h-6" />
                <span className="text-sm font-medium">{t('home.addFirstMint')}</span>
              </button>
            </div>
          ) : (
            <>
              <div
                ref={carouselRef}
                onScroll={handleScroll}
                className="flex gap-4 px-[calc(50%-144px)] overflow-x-auto snap-x snap-mandatory scrollbar-hide"
              >
                {mints.map((mint, idx) => (
                  <div
                    key={mint.url}
                    ref={(el) => { cardRefs.current[idx] = el; }}
                    className="snap-center shrink-0 will-change-transform"
                    onClick={() => handleMintClick(idx)}
                  >
                    <MintCard
                      mint={mint}
                      variant={getVariantByIndex(idx)}
                    />
                  </div>
                ))}
                {/* Add card button */}
                <div className="snap-center shrink-0 flex items-center justify-center px-4">
                  <button
                    onClick={onAddMint}
                    aria-label={t('settings.addMint')}
                    className="w-10 h-10 rounded-full border-2 border-dashed border-gray-300 flex items-center justify-center text-gray-400 hover:bg-gray-100 transition-all"
                  >
                    <Plus className="w-5 h-5" />
                  </button>
                </div>
              </div>

              {/* Below Card: Mint Name and Dots */}
              <div className="flex flex-col items-center mt-4 gap-3">
                <span className="text-sm font-semibold text-gray-700">
                  {mints[clampedMintIndex]?.name || ""}
                </span>

                {/* Pagination Dots */}
                {mints.length > 1 && (
                  <div className="flex gap-2">
                    {mints.map((_, idx) => (
                      <div
                        key={idx}
                        className={`w-1.5 h-1.5 rounded-full ${idx === clampedMintIndex ? "bg-black" : "bg-gray-300"}`}
                      />
                    ))}
                  </div>
                )}
              </div>
            </>
          )}
        </div>

        {/* Action Buttons */}
        <div className="grid grid-cols-2 gap-4 px-6 py-6">
          <button
            onClick={handleReceiveClick}
            className="flex items-center justify-center gap-2 bg-[#1e2634] text-white py-4 rounded-[12px] shadow-lg active:scale-95 transition-transform border border-white/5"
          >
            <ArrowDown className="w-5 h-5" />
            <span className="font-medium text-lg">{t('common.receive')}</span>
          </button>
          <button
            onClick={handleSendClick}
            className="flex items-center justify-center gap-2 bg-[#1e2634] text-white py-4 rounded-[12px] shadow-lg active:scale-95 transition-transform border border-white/5"
          >
            <span className="font-medium text-lg">{t('common.send')}</span>
            <ArrowUp className="w-5 h-5" />
          </button>
        </div>

        {/* Block Separator */}
        <div className="h-1.5 bg-[#F5F4F1] w-full"></div>

        {/* Transaction List */}
        <TransactionList
          transactions={transactions}
          onSeeAll={onTransactions}
          onTransactionClick={onSelectTransaction}
          maxItems={10}
        />
      </main>

      {/* Send Scanner Modal */}
      <UnifiedScanner
        isOpen={isSendScannerOpen}
        onClose={() => setIsSendScannerOpen(false)}
        onValidated={handleSendValidated}
        mode="send"
      />

      {/* Receive Scanner Modal */}
      <UnifiedScanner
        isOpen={isReceiveScannerOpen}
        onClose={() => setIsReceiveScannerOpen(false)}
        onValidated={handleReceiveValidated}
        mode="receive"
      />
    </div>
  );
}
