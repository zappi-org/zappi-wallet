import { useState, useEffect, useMemo, startTransition, useCallback, useRef } from "react";
import { Settings, ArrowDown, ArrowUp, Plus } from "lucide-react";

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
  onValidatedScan?: (data: ValidatedData, mode: 'send' | 'receive') => void;
  onSelectTransaction?: (tx: Transaction) => void;
  transactions?: Transaction[];
}

export function HomeScreen({
  onSettings,
  onTransactions,
  onAddMint,
  onMintDetails,
  onValidatedScan,
  onSelectTransaction,
  transactions: propTransactions,
}: HomeScreenProps) {
  const { t } = useTranslation();
  const [localTransactions, setLocalTransactions] = useState<Transaction[]>([]);
  const [isScannerOpen, setIsScannerOpen] = useState(false);
  const [scanMode, setScanMode] = useState<'send' | 'receive'>('send');
  const [activeMintIndex, setActiveMintIndex] = useState(0);

  // Use prop transactions if provided, otherwise use local state
  const transactions = propTransactions ?? localTransactions;

  const { balance, isLoadingBalance } = useWallet();
  const { checkAllMints, getCachedStatus } = useMintHealth();
  const settings = useAppStore((state) => state.settings);
  const updateAvailable = useAppStore((state) => state.updateAvailable);
  const txRefreshTrigger = useAppStore((state) => state.txRefreshTrigger);
  const { getDisplayName, getIconUrl } = useMintMetadata(settings?.mints || []);

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

  // Filter transactions by selected mint
  const filteredTransactions = useMemo(() => {
    const selectedMint = mints[clampedMintIndex];
    if (!selectedMint) return transactions;
    const url = selectedMint.url;
    const normalized = url.endsWith("/") ? url.slice(0, -1) : url;
    return transactions.filter((tx) => {
      const txUrl = tx.mintUrl?.endsWith("/") ? tx.mintUrl.slice(0, -1) : tx.mintUrl;
      return txUrl === normalized || txUrl === url;
    });
  }, [transactions, mints, clampedMintIndex]);

  const handleMintClick = (index: number) => {
    onMintDetails?.(mints[index]);
  };

  const handleSendClick = useCallback(() => {
    setScanMode('send');
    setIsScannerOpen(true);
  }, []);

  const handleReceiveClick = useCallback(() => {
    setScanMode('receive');
    setIsScannerOpen(true);
  }, []);

  const handleValidated = useCallback((data: ValidatedData) => {
    onValidatedScan?.(data, scanMode);
  }, [onValidatedScan, scanMode]);

  return (
    <div className="h-dvh bg-background text-gray-900 font-sans max-w-md mx-auto overflow-hidden flex flex-col pt-safe">
      {/* Main Header */}
      <header className="flex items-end justify-end px-5 shrink-0">
        <button
          onClick={onSettings}
          aria-label={t('common.settings')}
          className="w-10 h-10 rounded-full flex items-center justify-center hover:bg-gray-100 transition-colors relative"
        >
          <Settings className="w-6 h-6 text-gray-900" />
          {updateAvailable && (
            <div className="absolute top-0 right-0 w-2 h-2 bg-accent-primary rounded-full border border-white" aria-hidden="true" />
          )}
        </button>
      </header>

      <main className="flex-1 flex flex-col overflow-y-auto min-h-0">
        {/* Total Balance */}
        <div className="flex flex-col items-start pt-2 pb-4 px-5 gap-[11px]">
          <p className="text-[#86868B] text-[11px] font-medium">{t('home.totalBalance')}</p>
          <div className="flex items-baseline gap-3">
            <span className="text-4xl font-bold tracking-tight text-[#333340a3]">₿</span>
            <span className={`text-4xl font-bold tracking-tight ${isLoadingBalance ? 'animate-shimmer' : ''}`} style={{ letterSpacing: -1, color: '#0f0f2e' }}>
              {isLoadingBalance ? "..." : totalBalance.toLocaleString()}
            </span>
          </div>
        </div>

        {/* Card Carousel */}
        <div className="relative w-full overflow-hidden py-4 px-5">
          {mints.length === 0 ? (
            /* Empty state */
            <div className="flex justify-center items-center">
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
                className="flex gap-4 px-[calc(50%-144px-20px)] overflow-x-auto snap-x snap-mandatory scrollbar-hide -mx-5"
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

              {/* Pagination Dots */}
              {mints.length > 1 && (
                <div className="flex justify-center gap-2 mt-4">
                  {mints.map((_, idx) => (
                    <div
                      key={idx}
                      className={`w-1.5 h-1.5 rounded-full ${idx === clampedMintIndex ? "bg-gray-900" : "bg-gray-300"}`}
                    />
                  ))}
                </div>
              )}
            </>
          )}
        </div>

        {/* Block Separator */}
        <div className="h-1.5 bg-background w-full"></div>

        {/* Transaction List — filtered by selected mint, fills remaining space */}
        <div className="flex-1">
          <TransactionList
            transactions={filteredTransactions}
            onSeeAll={onTransactions}
            onTransactionClick={onSelectTransaction}
            maxItems={10}
          />
        </div>
      </main>

      {/* Send / Receive Buttons — fixed at bottom */}
      <div className="grid grid-cols-2 gap-4 px-5 py-4 shrink-0 pb-safe">
        <button
          onClick={handleReceiveClick}
          className="flex items-center justify-center gap-2 bg-accent-primary text-white h-14 rounded-[12px] active:scale-95 transition-transform w-full"
        >
          <ArrowDown className="w-5 h-5" />
          <span className="font-semibold text-lg">{t('common.receive')}</span>
        </button>
        <button
          onClick={handleSendClick}
          className="flex items-center justify-center gap-2 bg-[#1D1D1F] text-white h-14 rounded-[12px] active:scale-95 transition-transform w-full"
        >
          <span className="font-semibold text-lg">{t('common.send')}</span>
          <ArrowUp className="w-5 h-5" />
        </button>
      </div>

      {/* Unified Scanner */}
      <UnifiedScanner
        isOpen={isScannerOpen}
        onClose={() => setIsScannerOpen(false)}
        onValidated={handleValidated}
      />
    </div>
  );
}
