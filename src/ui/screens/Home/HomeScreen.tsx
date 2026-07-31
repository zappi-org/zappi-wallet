import { useState, useEffect, useMemo, useCallback } from "react";
import { useCarouselScroll } from "@/ui/hooks/use-carousel-scroll";
import { usePullToRefresh } from "@/ui/hooks/use-pull-to-refresh";
import { Plus, LoaderCircle, ArrowDown, Eye, EyeOff, User } from "lucide-react";
import { motion } from "motion/react";
import { HistoryDrawer } from "@/ui/components/common/HistoryDrawer";
import { useIsActivityTop } from "@/ui/navigation/use-is-activity-top";
import { tabGlassClass } from "@/ui/components/layout/TabToolbar/styles";

import { useTranslation } from "react-i18next";
import { hapticTap } from "@/ui/utils/haptic";
import { MintCard, resolveMintColor } from "../../components/wallet/MintCard";
import { HomeRecentCard } from "../../components/wallet/HomeRecentCard";
import {
  pendingItemToRecentRow,
  toRecentRow,
} from "../../components/wallet/homeRecentRow";
import { useWallet, useMintHealth, useMintMetadata } from "@/ui/hooks";
import { useAllPendingItems, type PendingItem } from "@/ui/hooks/usePendingItems";
import { useAppStore } from "@/store";
import { useSatUnit, useFormatFiat } from "@/utils/format";
import { getMintBalance, isSameMintUrl } from "@/utils/url";
import type { MintInfo } from "@/core/types";
import { isReclaimableSend } from "@/core/domain/transaction";
import type { Transaction } from "@/core/domain/transaction";
// Transaction loading via props or store — no direct repo access in UI

export interface HomeScreenProps {
  onSettings?: () => void;
  onProfile: () => void;
  onNotifications?: () => void;
  /** Kept for the mint-detail deep link; home itself now expands the drawer. */
  onTransactions?: (mintUrl?: string) => void;
  onAddMint?: () => void;
  onMintDetails?: (mint: MintInfo, index: number) => void;
  onSend?: (activeMintUrl?: string) => void;
  onReceive?: (activeMintUrl?: string) => void;
  onSelectTransaction?: (tx: Transaction) => void;
  onSelectPendingItem?: (item: PendingItem) => void;
  onSaveSettings?: (settings: Record<string, unknown>) => Promise<void>;
  onRefresh?: () => Promise<void>;
  transactions?: Transaction[];
}

export function HomeScreen({
  onProfile,
  onAddMint,
  onMintDetails,
  onSend,
  onReceive,
  onSelectTransaction,
  onSelectPendingItem,
  onSaveSettings,
  onRefresh,
  transactions: propTransactions,
}: HomeScreenProps) {
  const { t } = useTranslation();
  const unit = useSatUnit();
  const toFiat = useFormatFiat();
  const [activeMintIndex, setActiveMintIndex] = useState(0);

  const transactions = useMemo(
    () => propTransactions ?? [],
    [propTransactions]
  );

  const { balance, isLoadingBalance } = useWallet();
  const { checkAllMints, getCachedStatus } = useMintHealth();
  const settings = useAppStore((state) => state.settings);
  const updateSettings = useAppStore((state) => state.updateSettings);
  const { getDisplayName, getOriginalName, getIconUrl } = useMintMetadata(
    settings?.mints || []
  );

  // Pull-to-refresh
  const noopRefresh = useCallback(async () => {}, []);
  const { scrollContainerRef, indicatorRef, iconRef, isRefreshing } =
    usePullToRefresh({
      onRefresh: onRefresh ?? noopRefresh,
    });

  // Transactions are provided via props from MainApp
  // No fallback to direct repo access (hex architecture compliance);

  useEffect(() => {
    checkAllMints();
  }, [checkAllMints]);

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
  }, [
    mintUrls,
    balance.byMint,
    getCachedStatus,
    getDisplayName,
    getOriginalName,
    getIconUrl,
    mintAliases,
  ]);

  const totalBalance = balance.total;

  const { carouselRef, cardRefs, handleScroll } = useCarouselScroll({
    itemCount: mints.length,
    onIndexChange: setActiveMintIndex,
    scaleAnimation: true,
    fallbackGap: 24,
  });

  const clampedMintIndex =
    mints.length === 0 ? 0 : Math.min(activeMintIndex, mints.length - 1);

  // Pending items (open requests, unclaimed incoming tokens, unclaimed sent
  // tokens) for the selected card — same mint filter as the transaction list
  // below them. Sent-but-unclaimed money rides here instead of in the ledger
  // list (filteredTransactions excludes it once its pending row has loaded)
  // so it isn't shown twice.
  const { items: pendingItemsRaw } = useAllPendingItems(settings.mints);

  // The sent-token pending item's id equals the tx's id (composition/pending-items.ts) —
  // used below to gate the reclaimable-send exclusion on that row actually being loaded.
  const pendingItemIds = useMemo(
    () => new Set(pendingItemsRaw.map((item) => item.id)),
    [pendingItemsRaw]
  );

  const filteredTransactions = useMemo(() => {
    const selectedMint = mints[clampedMintIndex];
    if (!selectedMint) return transactions;
    const url = selectedMint.url;
    // Boolean-returning wrapper: isReclaimableSend's `tx is Transaction` type
    // guard would otherwise narrow tx to `never` in the branch below (its
    // input is already typed Transaction, so the false branch collapses).
    const isReclaimable = (tx: Transaction): boolean => isReclaimableSend(tx);
    return transactions.filter((tx) => {
      if (tx.status === "failed") return false;
      // Only hide once its pending row is actually loaded — the pending query
      // is async and independent, so hiding unconditionally would vanish this
      // money from both lists on first paint or if that query comes back empty.
      if (isReclaimable(tx) && pendingItemIds.has(tx.id)) return false;
      // Domain equality, not a slash strip: a row stored under any notation
      // variant (host case, :443) is still this mint's money and must show.
      return Boolean(tx.accountId) && isSameMintUrl(tx.accountId, url);
    });
  }, [transactions, mints, clampedMintIndex, pendingItemIds]);

  const pendingItems = useMemo(() => {
    const selectedMint = mints[clampedMintIndex];
    if (!selectedMint) return pendingItemsRaw;
    const url = selectedMint.url;
    return pendingItemsRaw.filter(
      (item) => Boolean(item.accountId) && isSameMintUrl(item.accountId, url)
    );
  }, [pendingItemsRaw, mints, clampedMintIndex]);

  const recentTransaction = useMemo(() => {
    return filteredTransactions.length > 0 ? filteredTransactions[0] : null
  }, [filteredTransactions]);

  // One history area, one row: money still in motion outranks the last settled
  // entry, so a pending item takes the card instead of stacking above it.
  const recent = useMemo(() => {
    const pending = pendingItems[0];
    if (pending) {
      return {
        row: pendingItemToRecentRow(pending, t),
        onPress: () => onSelectPendingItem?.(pending),
      };
    }
    if (recentTransaction) {
      return {
        row: toRecentRow(recentTransaction, t),
        onPress: () => onSelectTransaction?.(recentTransaction),
      };
    }
    return null;
  }, [pendingItems, recentTransaction, t, onSelectPendingItem, onSelectTransaction]);

  // The drawer owns the open gesture now — no pan recognizer on the screen.
  const [historyExpanded, setHistoryExpanded] = useState(false)
  const isTop = useIsActivityTop()

  // The drawer portals to document.body, so a covered home would keep it painted
  // over whatever activity was pushed on top (see MemoSheet). Collapse on cover —
  // render-phase adjustment, since an effect here would cascade renders.
  if (!isTop && historyExpanded) setHistoryExpanded(false)

  const handleBalanceVisibilityToggle = useCallback(() => {
    hapticTap();
    const updated = { balanceHidden: !settings.balanceHidden };
    updateSettings(updated);
    onSaveSettings?.({ ...settings, ...updated });
  }, [onSaveSettings, settings, updateSettings]);

  return (
    <motion.div
      ref={scrollContainerRef as React.RefObject<HTMLDivElement>}
      className="h-full bg-background text-foreground font-primary overflow-hidden flex flex-col pt-safe"
      style={{ overscrollBehaviorY: "contain" }}
    >
      {/* Pull-to-refresh indicator */}
      <div
        ref={indicatorRef}
        className="flex items-center justify-center shrink-0 overflow-hidden"
        style={{ height: 0, opacity: 0 }}
      >
        {isRefreshing ? (
          <LoaderCircle className="w-6 h-6 text-foreground-muted animate-spin" />
        ) : (
          <ArrowDown
            ref={iconRef}
            className="w-5 h-5 text-foreground-muted transition-transform duration-150"
          />
        )}
      </div>

      {/* Header — profile (scan moved to the bottom dock) */}
      <div className="shrink-0 h-14 px-5 flex items-center justify-between">
        {/* Same glass chip as the bottom dock's camera button, so the two
            corner icon-buttons read as one system. */}
        <div className={tabGlassClass}>
          <button
            type="button"
            onClick={() => {
              hapticTap();
              onProfile();
            }}
            aria-label={t("myAddress.title")}
            className="relative z-20 flex items-center justify-center w-11 h-11 rounded-full text-foreground/80 transition-colors active:bg-foreground/[0.05] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
          >
            <User className="w-[19px] h-[19px]" strokeWidth={2} />
          </button>
        </div>
      </div>

      {/* Fixed top: Balance + Cards */}
      <div className="shrink-0">
        {/* Total Balance — Hero */}
        <button
          type="button"
          onClick={handleBalanceVisibilityToggle}
          aria-label={
            settings.balanceHidden
              ? t("home.showBalance")
              : t("home.hideBalance")
          }
          className="group flex w-full flex-col items-center px-5 pt-4 pb-1 text-center transition-opacity active:opacity-80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50"
        >
          <div className="flex items-center justify-center gap-1.5">
            <span className="text-body font-medium text-foreground-muted tracking-wide uppercase">
              Total
            </span>
            {settings.balanceHidden ? (
              <EyeOff className="h-4 w-4 text-foreground-muted transition-colors group-hover:text-foreground" />
            ) : (
              <Eye className="h-4 w-4 text-foreground-muted transition-colors group-hover:text-foreground" />
            )}
          </div>
          <div className="flex items-baseline gap-1.5 mt-1">
            {settings.balanceHidden ? (
              <span className="text-display font-bold font-display text-foreground tracking-[2px]">
                ••••
              </span>
            ) : isLoadingBalance ? (
              <span className="text-display font-bold font-display text-foreground tracking-[2px] animate-shimmer">
                ...
              </span>
            ) : (
              <>
                {unit === "₿" && (
                  <span className="text-display font-bold font-display text-foreground">
                    {unit}
                  </span>
                )}
                <span className="text-display font-bold font-display text-foreground tracking-[-0.5px]">
                  {totalBalance.toLocaleString()}
                </span>
                {unit !== "₿" && (
                  <span className="text-display font-bold font-display text-foreground">
                    {unit}
                  </span>
                )}
              </>
            )}
          </div>
          {(() => {
            const fiatStr = !isLoadingBalance ? toFiat(totalBalance) : null;
            return fiatStr ? (
              <p
                className={`text-body text-foreground-muted mt-0.5 ${
                  settings.balanceHidden ? "invisible" : ""
                }`}
              >
                {fiatStr}
              </p>
            ) : (
              <p className="text-body mt-0.5 invisible">-</p>
            );
          })()}
        </button>

        {/* Card Carousel */}
        <div className="relative w-full pt-4 pb-2">
          {mints.length === 0 ? (
            <div className="flex justify-center items-center px-5">
              <button
                onClick={onAddMint}
                className="w-[var(--card-w)] aspect-[280/176] rounded-card border-2 border-dashed border-border flex flex-col items-center justify-center text-foreground-subtle gap-2"
              >
                <Plus className="w-6 h-6" />
                <span className="text-caption font-medium">
                  {t("home.addFirstMint")}
                </span>
              </button>
            </div>
          ) : (
            <>
              <div
                ref={carouselRef}
                onScroll={handleScroll}
                className="flex gap-1 px-[calc(50%-var(--card-w)/2)] overflow-x-auto overflow-y-visible snap-x snap-mandatory scrollbar-hide pb-2"
              >
                {mints.map((mint, idx) => (
                  <div
                    key={mint.url}
                    ref={(el) => {
                      cardRefs.current[idx] = el;
                    }}
                    className="snap-center snap-always shrink-0 will-change-transform"
                  >
                    <MintCard
                      mint={mint}
                      {...resolveMintColor(mint.url, idx, settings.mintColors)}
                      hideBalance={settings.balanceHidden}
                      onDetail={() => onMintDetails?.(mints[idx], idx)}
                      onSend={() => onSend?.(mint.url)}
                      onReceive={() => onReceive?.(mint.url)}
                    />
                  </div>
                ))}
                {/* Add card button */}
                <div className="snap-center shrink-0 flex items-center justify-center px-4">
                  <button
                    onClick={onAddMint}
                    aria-label={t("settings.addMint")}
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
                      className={`w-1.5 h-1.5 rounded-full ${
                        idx === clampedMintIndex ? "bg-foreground" : "bg-border"
                      }`}
                    />
                  ))}
                </div>
              )}
            </>
          )}
        </div>
      </div>

      {/* The newest ledger row stays home's own; the drawer only takes the
          gesture on it, and slides its sheet over the top. */}
      <HistoryDrawer
        expanded={historyExpanded}
        onExpandedChange={setHistoryExpanded}
        transactions={transactions}
        initialMintUrls={
          mints[clampedMintIndex] ? [mints[clampedMintIndex].url] : undefined
        }
        peek={
          recent ? (
            <HomeRecentCard
              row={recent.row}
              onPress={recent.onPress}
              onSeeAll={() => setHistoryExpanded(true)}
            />
          ) : (
            <div className="shrink-0 px-4 w-full max-w-sm mx-auto">
              <p className="text-caption text-foreground-muted text-center py-2">
                {t('home.noTransactions')}
              </p>
            </div>
          )
        }
      />
    </motion.div>
  );
}
