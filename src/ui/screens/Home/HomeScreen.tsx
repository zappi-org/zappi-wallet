import { useState, useEffect, useMemo, startTransition, useCallback, useRef } from "react";
import { User, ArrowDownLeft, ArrowUpRight, Plus, Eye, EyeOff } from "lucide-react";

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
  onCreateToken?: (mintUrl: string) => void;
  onSelectTransaction?: (tx: Transaction) => void;
  transactions?: Transaction[];
}

export function HomeScreen({
  onSettings,
  onTransactions,
  onAddMint,
  onMintDetails,
  onValidatedScan,
  onCreateToken,
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
  const updateSettings = useAppStore((state) => state.updateSettings);
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
  const mintUrls = settings.mints;
  const mints: MintInfo[] = useMemo(() => {
    return mintUrls.map((url) => {
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
  }, [mintUrls, balance.byMint, getCachedStatus, getDisplayName, getIconUrl]);

  const totalBalance = balance.total;

  // Carousel scroll tracking with real-time scale effect
  const carouselRef = useRef<HTMLDivElement>(null);
  const cardRefs = useRef<(HTMLDivElement | null)[]>([]);
  const rafRef = useRef<number>(0);

  const getCarouselGap = useCallback(() => {
    const el = carouselRef.current;
    if (!el) return 24; // gap-6 fallback
    return parseFloat(getComputedStyle(el).columnGap) || 24;
  }, []);

  const updateCardScales = useCallback(() => {
    const el = carouselRef.current;
    if (!el || mints.length === 0) return;
    const containerCenter = el.scrollLeft + el.clientWidth / 2;
    const gap = getCarouselGap();

    cardRefs.current.forEach((card) => {
      if (!card) return;
      const cardWidth = card.offsetWidth;
      const cardCenter = card.offsetLeft + cardWidth / 2;
      const distance = Math.abs(containerCenter - cardCenter);
      const maxDistance = cardWidth + gap;
      const progress = Math.min(distance / maxDistance, 1);
      const scale = 1 - progress * 0.12; // 1.0 → 0.88
      const opacity = 1 - progress * 0.4; // 1.0 → 0.6
      card.style.transform = `scale(${scale})`;
      card.style.opacity = `${opacity}`;
    });
  }, [mints.length, getCarouselGap]);

  const handleScroll = useCallback(() => {
    cancelAnimationFrame(rafRef.current);
    rafRef.current = requestAnimationFrame(() => {
      const el = carouselRef.current;
      if (!el || mints.length === 0) return;
      const scrollLeft = el.scrollLeft;
      const firstCard = cardRefs.current[0];
      const gap = getCarouselGap();
      const cardWidth = (firstCard?.offsetWidth || 300) + gap;
      const index = Math.round(scrollLeft / cardWidth);
      setActiveMintIndex(Math.max(0, Math.min(index, mints.length - 1)));
      updateCardScales();
    });
  }, [mints.length, updateCardScales, getCarouselGap]);

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
    <div className="h-dvh bg-[#faf9f6] text-gray-900 font-sans max-w-md mx-auto overflow-hidden flex flex-col pt-safe">
      {/* Header */}
      <header className="flex items-center justify-end px-3 shrink-0">
        <button
          onClick={onSettings}
          aria-label={t('common.settings')}
          className="w-10 h-10 rounded-full flex items-center justify-center overflow-hidden hover:bg-gray-100 transition-colors relative"
        >
          <User className="w-6 h-6 text-[#1d1d1f]" />
          {updateAvailable && (
            <div className="absolute top-0 right-0 w-2 h-2 bg-accent-primary rounded-full border border-white" aria-hidden="true" />
          )}
        </button>
      </header>

      {/* Scrollable content */}
      <main className="flex-1 flex flex-col overflow-y-auto min-h-0">
        {/* Balance */}
        <div className="flex flex-col items-center gap-1 shrink-0 pb-1.5 pt-4">
          <p className="font-['Amiri_Quran_Colored',sans-serif] text-sm text-[#86868b]">Total</p>
          <div className="flex items-center justify-center gap-3 py-0.5 w-full">
            <span className="font-['Montserrat'] font-bold text-[clamp(2rem,8vw,2.5rem)] text-[#9d817a] tracking-[-1px]">₿</span>
            <span className={`font-['Andika'] font-bold text-[clamp(2.25rem,9vw,2.75rem)] text-[#2e0f0f] tracking-[5px] ${isLoadingBalance ? 'animate-shimmer' : ''}`}>
              {settings.balanceHidden ? '••••' : isLoadingBalance ? "..." : totalBalance.toLocaleString()}
            </span>
            <button
              onClick={() => updateSettings({ balanceHidden: !settings.balanceHidden })}
              aria-label={settings.balanceHidden ? t('home.showBalance') : t('home.hideBalance')}
              className="p-1.5 rounded-full hover:bg-gray-100 transition-colors"
            >
              {settings.balanceHidden
                ? <EyeOff className="w-5 h-5 text-[#86868b]" />
                : <Eye className="w-5 h-5 text-[#86868b]" />
              }
            </button>
          </div>
        </div>

        {/* Card Carousel */}
        <div className="relative w-full overflow-hidden pt-6 pb-8">
          {mints.length === 0 ? (
            <div className="flex justify-center items-center px-5">
              <button
                onClick={onAddMint}
                className="w-[var(--card-w)] aspect-[280/176] rounded-[13px] border-2 border-dashed border-gray-300 flex flex-col items-center justify-center text-gray-400 gap-2"
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
                className="flex gap-6 px-[calc(50%-var(--card-w)/2)] overflow-x-auto snap-x snap-mandatory scrollbar-hide"
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
                      hideBalance={settings.balanceHidden}
                      onCreateToken={onCreateToken ? () => onCreateToken(mint.url) : undefined}
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
                      className={`w-1.5 h-1.5 rounded-full ${idx === clampedMintIndex ? "bg-[#1d1d1f]" : "bg-[#d9d9d9]"}`}
                    />
                  ))}
                </div>
              )}
            </>
          )}
        </div>

        {/* Transaction List — filtered by selected mint */}
        <div className="min-h-[110px] pb-4">
          <TransactionList
            transactions={filteredTransactions}
            onSeeAll={onTransactions}
            onTransactionClick={onSelectTransaction}
            maxItems={1}
          />
        </div>
      </main>

      {/* Action Row — always fixed at bottom */}
      <div className="shrink-0 flex items-start justify-center gap-4 pt-3 pb-3 bg-[#faf9f6] pb-safe">
        <button
          onClick={handleReceiveClick}
          className="flex flex-col items-center gap-1.5 w-20 active:scale-95 transition-transform"
        >
          <div className="w-12 h-12 bg-white rounded-2xl flex items-center justify-center">
            <ArrowDownLeft className="w-5.5 h-5.5 text-[#5B7A54]" strokeWidth={2} />
          </div>
          <span className="font-['Outfit'] font-bold text-xs text-[#1d1d1f] leading-normal">{t('common.receive')}</span>
        </button>
        <button
          onClick={handleSendClick}
          className="flex flex-col items-center gap-1.5 w-20 active:scale-95 transition-transform"
        >
          <div className="w-12 h-12 bg-white rounded-2xl flex items-center justify-center">
            <ArrowUpRight className="w-5.5 h-5.5 text-[#D4A03D]" strokeWidth={2} />
          </div>
          <span className="font-['Outfit'] font-bold text-xs text-[#1d1d1f] leading-normal">{t('common.send')}</span>
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
