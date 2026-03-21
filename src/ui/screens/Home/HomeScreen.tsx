import { useState, useEffect, useMemo, startTransition, useCallback } from "react";
import { useCarouselScroll } from "@/hooks/use-carousel-scroll";
import { User, ArrowDownLeft, ArrowUpRight, Plus } from "lucide-react";
import { hapticTap } from "@/utils/haptic";

import { useTranslation } from "react-i18next";
import { MintCard, getVariantByIndex } from "../../components/wallet/MintCard";
import { TransactionList } from "../../components/wallet/TransactionList";
import { UnifiedScanner, type ValidatedData } from "../../components/scanner";
import { useWallet, useMintHealth, useMintMetadata } from "@/hooks";
import { useAppStore } from "@/store";
import { useSatUnit, useFormatFiat } from "@/utils/format";
import { getMintBalance } from "@/utils/url";
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
  onMintDetails?: (mint: MintInfo, index: number) => void;
  onValidatedScan?: (data: ValidatedData, mode: 'send' | 'receive') => void;
  onSend?: (activeMintUrl?: string) => void;
  onReceive?: (activeMintUrl?: string) => void;
  onCreateToken?: (mintUrl: string) => void;
  onSelectTransaction?: (tx: Transaction) => void;
  onSaveSettings?: (settings: Record<string, unknown>) => Promise<void>;
  transactions?: Transaction[];
}

export function HomeScreen({
  onSettings,
  onTransactions,
  onAddMint,
  onMintDetails,
  onValidatedScan,
  onSend,
  onReceive,
  onCreateToken,
  onSelectTransaction,
  onSaveSettings,
  transactions: propTransactions,
}: HomeScreenProps) {
  const { t } = useTranslation();
  const unit = useSatUnit();
  const toFiat = useFormatFiat();
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
  const { getDisplayName, getOriginalName, getIconUrl } = useMintMetadata(settings?.mints || []);

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
  const mintAliases = settings.mintAliases;
  const mints: MintInfo[] = useMemo(() => {
    return mintUrls.map((url) => {
      const cachedStatus = getCachedStatus(url);
      const alias = mintAliases?.[url];
      return {
        url,
        name: getDisplayName(url),
        alias,
        mintName: getOriginalName(url),
        iconUrl: getIconUrl(url),
        balance: getMintBalance(url, balance.byMint),
        isOnline: cachedStatus?.isOnline ?? true,
        lastChecked: cachedStatus?.lastChecked,
      };
    });
  }, [mintUrls, balance.byMint, getCachedStatus, getDisplayName, getOriginalName, getIconUrl, mintAliases]);

  const totalBalance = balance.total;

  // Carousel scroll tracking with real-time scale effect
  const { carouselRef, cardRefs, handleScroll } = useCarouselScroll({
    itemCount: mints.length,
    onIndexChange: setActiveMintIndex,
    scaleAnimation: true,
    fallbackGap: 24,
  });

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
    onMintDetails?.(mints[index], index);
  };

  const handleSendClick = useCallback(() => {
    if (onSend) {
      const activeMint = mints[clampedMintIndex];
      onSend(activeMint?.url);
    } else {
      setScanMode('send');
      setIsScannerOpen(true);
    }
  }, [onSend, mints, clampedMintIndex]);

  const handleReceiveClick = useCallback(() => {
    if (onReceive) {
      const activeMint = mints[clampedMintIndex];
      onReceive(activeMint?.url);
    } else {
      setScanMode('receive');
      setIsScannerOpen(true);
    }
  }, [onReceive, mints, clampedMintIndex]);

  const handleValidated = useCallback((data: ValidatedData) => {
    onValidatedScan?.(data, scanMode);
  }, [onValidatedScan, scanMode]);

  return (
    <div className="h-dvh bg-background text-foreground font-primary overflow-hidden flex flex-col pt-safe">
      {/* Header */}
      <header className="flex items-center justify-end px-5 pt-4 pb-3 shrink-0">
        <button
          onClick={onSettings}
          aria-label={t('common.settings')}
          className="w-10 h-10 rounded-full flex items-center justify-center hover:bg-background-hover transition-colors relative"
        >
          <User className="w-6 h-6 text-foreground" />
          {updateAvailable && (
            <span className="absolute -top-0.5 -right-1 font-bold text-overline text-accent-danger leading-none">New</span>
          )}
        </button>
      </header>

      {/* Scrollable content */}
      <main className="flex-1 flex flex-col overflow-y-auto min-h-0">
        {/* Balance */}
        <div
          className="flex flex-col items-center gap-3 shrink-0 pb-1.5 pt-8 cursor-pointer"
          onClick={() => {
            const updated = { balanceHidden: !settings.balanceHidden }
            updateSettings(updated)
            onSaveSettings?.({ ...settings, ...updated })
          }}
          role="button"
          aria-label={settings.balanceHidden ? t('home.showBalance') : t('home.hideBalance')}
        >
          <p className="text-caption text-foreground-muted">Total</p>
          <div className="flex items-center gap-2 py-0.5">
            {settings.balanceHidden ? (
              <span className="text-display text-foreground tracking-[2px]">••••</span>
            ) : isLoadingBalance ? (
              <span className="text-display text-foreground tracking-[2px] animate-shimmer">...</span>
            ) : (
              <>
                {unit === '₿' && (
                  <span className="text-label text-foreground-muted tracking-[-1px]">{unit}</span>
                )}
                <span className="text-display font-display text-foreground tracking-[2px]">
                  {totalBalance.toLocaleString()}
                </span>
                {unit !== '₿' && (
                  <span className="text-label text-foreground-muted">{unit}</span>
                )}
              </>
            )}
          </div>
          {!settings.balanceHidden && !isLoadingBalance && (() => {
            const fiatStr = toFiat(totalBalance)
            return fiatStr ? (
              <p className="text-caption font-medium text-foreground-muted tracking-wide">
                ≈ {fiatStr}
              </p>
            ) : null
          })()}
        </div>

        {/* Card Carousel */}
        <div className="relative w-full pt-10 pb-8">
          {mints.length === 0 ? (
            <div className="flex justify-center items-center px-5">
              <button
                onClick={onAddMint}
                className="w-[var(--card-w)] aspect-[280/176] rounded-[13px] border-2 border-dashed border-border flex flex-col items-center justify-center text-foreground-subtle gap-2"
              >
                <Plus className="w-6 h-6" />
                <span className="text-caption font-medium">{t('home.addFirstMint')}</span>
              </button>
            </div>
          ) : (
            <>
              <div
                ref={carouselRef}
                onScroll={handleScroll}
                className="flex gap-4 px-[calc(50%-var(--card-w)/2)] overflow-x-auto overflow-y-visible snap-x snap-mandatory scrollbar-hide pb-2"
              >
                {mints.map((mint, idx) => (
                  <div
                    key={mint.url}
                    ref={(el) => { cardRefs.current[idx] = el; }}
                    className="snap-center snap-always shrink-0 will-change-transform"
                  >
                    <MintCard
                      mint={mint}
                      variant={getVariantByIndex(idx)}
                      hideBalance={settings.balanceHidden}
                      onDetail={() => handleMintClick(idx)}
                      onCreateToken={onCreateToken ? () => onCreateToken(mint.url) : undefined}
                    />
                  </div>
                ))}
                {/* Add card button */}
                <div className="snap-center shrink-0 flex items-center justify-center px-4">
                  <button
                    onClick={onAddMint}
                    aria-label={t('settings.addMint')}
                    className="w-10 h-10 rounded-full border-2 border-dashed border-border flex items-center justify-center text-foreground-subtle hover:bg-background-hover transition-all"
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
                      className={`w-1.5 h-1.5 rounded-full ${idx === clampedMintIndex ? "bg-foreground" : "bg-border"}`}
                    />
                  ))}
                </div>
              )}
            </>
          )}
        </div>

        {/* Transaction List — filtered by selected mint */}
        <div className="min-h-[110px] pb-6">
          <TransactionList
            transactions={filteredTransactions}
            onSeeAll={onTransactions}
            onTransactionClick={onSelectTransaction}
            maxItems={1}
          />
        </div>
      </main>

      {/* Action Row — always fixed at bottom */}
      <div className="shrink-0 flex items-start justify-evenly pt-3 pb-3 bg-background pb-safe">
        <button
          onClick={() => { hapticTap(); handleReceiveClick(); }}
          className="flex flex-col items-center gap-1.5 w-20 active:scale-95 transition-transform"
        >
          <div className="w-[60px] h-[60px] bg-accent-success/10 rounded-full flex items-center justify-center shadow-[0px_2px_1px_0px_rgba(0,0,0,0.25)]">
            <ArrowDownLeft className="w-6 h-6 text-accent-success" strokeWidth={2} />
          </div>
          <span className="text-label font-bold text-foreground leading-normal">{t('common.receive')}</span>
        </button>
        <button
          onClick={() => { hapticTap(); handleSendClick(); }}
          disabled={mints[clampedMintIndex]?.balance === 0}
          className="flex flex-col items-center gap-1.5 w-20 active:scale-95 transition-transform disabled:opacity-40"
        >
          <div className="w-[60px] h-[60px] bg-brand/10 rounded-full flex items-center justify-center shadow-[0px_2px_1px_0px_rgba(0,0,0,0.25)]">
            <ArrowUpRight className="w-6 h-6 text-accent-warning" strokeWidth={2} />
          </div>
          <span className="text-label font-bold text-foreground leading-normal">{t('common.send')}</span>
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
